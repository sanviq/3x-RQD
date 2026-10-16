
"""Masked, image-space repair and conditional aging; never a measured forecast."""
import base64
import hashlib
import importlib.util
import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.defects import detect_defects as opencv_candidates, parse_quad
from app.features import MAX_BYTES, decode_image

router = APIRouter()
TRAFFIC = {"light": .65, "normal": 1., "heavy": 1.6}
WEATHER = {"dry": .8, "seasonal": 1.15, "wet": 1.55, "freeze_thaw": 1.8}
_pipeline = None
_pipeline_key = None
_pipeline_lock = threading.Lock()
_render_slots = threading.BoundedSemaphore(2)
_cache = {}  # At most two generated repairs, in memory for three minutes.
_cache_lock = threading.Lock()


class PhotoDefect(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["Pothole", "Crack", "Depression", "Ravelling", "Uneven surface"]
    polygon: list[dict[str, float]] = Field(min_length=3, max_length=512)
    severity: float = Field(ge=0, le=1)
    geometry_source: Literal["contour", "bounding_box", "manual"] = "contour"

    @field_validator("polygon")
    @classmethod
    def points(cls, value):
        for p in value:
            if set(p) != {"x", "y"} or not all(math.isfinite(v) and 0 <= v <= 1 for v in p.values()):
                raise ValueError("Polygon points must be normalized finite x/y pairs.")
        return value


class PhotoSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    months: int = Field(default=6, ge=0, le=24)
    repair_quality: float = Field(default=.8, ge=0, le=1)
    traffic: Literal["light", "normal", "heavy"] = "normal"
    weather: Literal["dry", "seasonal", "wet", "freeze_thaw"] = "seasonal"
    size_growth_per_month: float = Field(default=.015, ge=0, le=.05)
    severity_growth_per_month: float = Field(default=.03, ge=0, le=.1)
    patch_decay_per_month: float = Field(default=.035, ge=0, le=.2)
    engine: Literal["auto", "opencv", "diffusers"] = "auto"
    inpaint_method: Literal["telea", "ns"] = "telea"


def inpainting_status():
    path = os.environ.get("ROAD_HEALTH_INPAINT_MODEL", "").strip()
    configured = bool(path and Path(path).is_dir() and (Path(path) / "model_index.json").is_file())
    installed = all(importlib.util.find_spec(m) is not None for m in ("diffusers", "torch", "transformers"))
    return {"diffusers_configured": configured, "diffusers_installed": installed,
            "preferred_engine": "diffusers" if configured and installed else "opencv",
            "notice": "Only a trusted local Diffusers inpainting directory is loaded. No model downloads occur on upload."}


def png(image):
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("Could not encode the repair preview.")
    return "data:image/png;base64," + base64.b64encode(encoded).decode("ascii")


def raster(points, shape):
    mask = np.zeros(shape, np.uint8)
    p = np.rint(np.asarray([[v["x"], v["y"]] for v in points]) * [shape[1]-1, shape[0]-1]).astype(np.int32)
    cv2.fillPoly(mask, [p], 255)
    return mask


def blend(base, pixels, mask, feather=2.):
    """Feather inward only: pixels outside the edit mask remain byte-identical."""
    alpha = np.minimum(1., cv2.distanceTransform(mask, cv2.DIST_L2, 3) / max(.1, feather))[:, :, None]
    result = base.copy()
    inside = mask > 0
    result[inside] = np.clip(np.rint(base * (1-alpha) + pixels * alpha), 0, 255).astype(np.uint8)[inside]
    return result


def growth(severity, settings):
    load = TRAFFIC[settings.traffic] * WEATHER[settings.weather]
    scale = 1 + settings.months * settings.size_growth_per_month * (.5 + severity) * load
    future = min(1., severity + settings.months * settings.severity_growth_per_month * (.5 + .5*severity) * load)
    decay = 1 - math.exp(-settings.months * settings.patch_decay_per_month * load *
                        (1.25 - .95*settings.repair_quality) * (.5 + .5*severity))
    return {"linear_scale": scale, "severity": future, "patch_degradation": decay}


def _diffusers_repair(image, mask, key):
    global _pipeline, _pipeline_key
    status = inpainting_status()
    if not status["diffusers_configured"] or not status["diffusers_installed"]:
        raise RuntimeError("Local inpainting weights or optional Diffusers dependencies are unavailable.")
    path = os.environ["ROAD_HEALTH_INPAINT_MODEL"]
    now = time.monotonic()
    with _cache_lock:
        for old in list(_cache):
            if now-_cache[old][0] > 180:
                del _cache[old]
        if key in _cache:
            return _cache[key][1].copy()
    if not _pipeline_lock.acquire(blocking=False):
        raise RuntimeError("The inpainting model is busy; OpenCV was used for this preview.")
    try:
        import torch
        from diffusers import AutoPipelineForInpainting
        from PIL import Image
        device = "cuda" if torch.cuda.is_available() else "cpu"
        stamp = (path, (Path(path)/"model_index.json").stat().st_mtime_ns, device)
        if _pipeline is None or _pipeline_key != stamp:
            candidate = AutoPipelineForInpainting.from_pretrained(path, local_files_only=True,
                        use_safetensors=True, torch_dtype=torch.float16 if device == "cuda" else torch.float32)
            candidate.to(device)
            candidate.enable_attention_slicing()
            _pipeline, _pipeline_key = candidate, stamp
            with _cache_lock:
                _cache.clear()
        result = _pipeline(
            prompt="Documentary road photograph, professionally filled potholes, compacted fresh asphalt patches, fine coarse aggregate, level road, same road perspective and natural lighting, preserve surroundings",
            negative_prompt="pothole, hole, puddle, car, changed road layout, text, illustration, plastic, smooth painted surface",
            image=Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)),
            mask_image=Image.fromarray(mask), padding_mask_crop=32,
            num_inference_steps=25, guidance_scale=6.5, strength=.92,
            generator=torch.Generator(device=device).manual_seed(2718))
        if any(getattr(result, "nsfw_content_detected", None) or []):
            raise RuntimeError("The inpainting model did not return a usable road patch.")
        generated = cv2.cvtColor(np.asarray(result.images[0].convert("RGB")), cv2.COLOR_RGB2BGR)
        generated = cv2.resize(generated, (image.shape[1], image.shape[0]))
        repaired = blend(image, generated, mask)
        if np.mean(np.abs(repaired[mask>0].astype(float)-image[mask>0])) < 1:
            raise RuntimeError("The generated repair did not visibly change the selected region.")
        with _cache_lock:
            if len(_cache) >= 2:
                del _cache[min(_cache, key=lambda k:_cache[k][0])]
            _cache[key] = (now, repaired.copy())
        return repaired
    finally:
        _pipeline_lock.release()


def _donor(image, mask, exclusion, road):
    """Sample intact asphalt at a nearby image height, preserving local grain scale."""
    x, y, w, h = cv2.boundingRect(mask)
    safe = ((road > 0) & (exclusion == 0) & (cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[:, :, 1] < 100)).astype(np.uint8)
    integral = cv2.integral(safe)
    center = (x+w/2, y+h/2)
    ih, iw = mask.shape
    for reduction in (1., .6, .35):
        dw, dh = max(4, round(min(w, 180)*reduction)), max(4, round(min(h, 100)*reduction))
        if dw >= iw or dh >= ih:
            continue
        best = None
        for yy in range(0, ih-dh+1, max(4, dh//3)):
            for xx in range(0, iw-dw+1, max(4, dw//3)):
                count = integral[yy+dh,xx+dw]-integral[yy,xx+dw]-integral[yy+dh,xx]+integral[yy,xx]
                if count < dw*dh*.97:
                    continue
                score = ((xx+dw/2-center[0])/iw)**2 + 4*((yy+dh/2-center[1])/ih)**2
                if best is None or score < best[0]:
                    best = (score, xx, yy)
        if best is not None:
            _, xx, yy = best
            return cv2.resize(image[yy:yy+dh,xx:xx+dw], (w,h), interpolation=cv2.INTER_LINEAR)
    return None


def opencv_repair(image, masks, road, method, all_damage=None):
    union = np.maximum.reduce(masks)
    flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
    cleaned = cv2.inpaint(image, union, 4, flag)
    result = image.copy()
    exclusion = cv2.dilate(all_damage if all_damage is not None else union, np.ones((5,5), np.uint8))
    for mask in masks:
        x,y,w,h = cv2.boundingRect(mask)
        donor = _donor(image, mask, exclusion, road)
        patch = cleaned.copy()
        if donor is not None:
            # Fresh compacted asphalt differs from weathered surroundings without
            # replacing the photo's geometry. Its stone texture comes from this road.
            donor = donor.astype(np.float32)
            low = cv2.GaussianBlur(donor, (0,0), 3)
            grain = donor-low
            ring = (cv2.dilate(mask,np.ones((19,19),np.uint8))>0) & (exclusion==0) & (road>0)
            base_color = np.median(image[ring],axis=0) if np.count_nonzero(ring)>12 else np.median(donor.reshape(-1,3),axis=0)
            # A filled patch is level: do not retain the cavity shadow as a bowl.
            illumination = np.broadcast_to(base_color,(h,w,3))
            patch[y:y+h,x:x+w] = np.clip(.76*illumination + .85*grain,0,255).astype(np.uint8)
        else:
            # Inpainting alone can blur broad cavities. Keep its illumination,
            # adding repeatable aggregate-like microtexture only inside the patch.
            yy,xx = np.indices((h,w))
            grain = 5*np.sin(xx*2.17+yy*1.31) + 3*np.sin(xx*4.43-yy*2.77)
            patch[y:y+h,x:x+w] = np.clip(cleaned[y:y+h,x:x+w].astype(float)*.74+grain[:,:,None],0,255).astype(np.uint8)
        result = blend(result, patch, mask)
    return result


def render_views(image, quad, reviewed, repair_ids, settings):
    oh,ow = image.shape[:2]
    ratio = min(1.,1280/max(oh,ow))
    image = cv2.resize(image,(round(ow*ratio),round(oh*ratio)),interpolation=cv2.INTER_AREA)
    h,w = image.shape[:2]
    quad = parse_quad(quad)
    road = raster([{"x":p[0],"y":p[1]} for p in quad],(h,w))
    detected = opencv_candidates(image,quad)
    notes = ["Conditional visual simulation, not a guaranteed forecast. Single-view imagery does not establish depth or physical dimensions.",
             "Edits are restricted to road-clipped masks. Background and road geometry are preserved outside those masks."]
    if reviewed is None:
        defects = [PhotoDefect(id=d["id"],kind=d["kind"],polygon=d["polygon"],severity=d["severity"]) for d in detected["defects"]]
    else:
        defects = reviewed
    if len({d.id for d in defects}) != len(defects):
        raise ValueError("Defect IDs must be unique.")
    ids = {d.id for d in defects}
    if repair_ids is not None and not set(repair_ids).issubset(ids):
        raise ValueError("Repair selection refers to an absent or excluded defect.")
    selected = set(repair_ids) if repair_ids is not None else {d.id for d in defects if d.kind in ("Pothole","Depression")}
    records = []
    for d in defects:
        mask = cv2.bitwise_and(raster(d.polygon,(h,w)),road)
        source = d.geometry_source
        if source == "bounding_box":
            intersecting = [cv2.bitwise_and(raster(c["polygon"],(h,w)),mask) for c in detected["defects"]
                            if c["kind"] in ("Pothole","Depression")]
            refined = np.maximum.reduce(intersecting) if intersecting else np.zeros_like(mask)
            if np.count_nonzero(refined) >= max(8,.08*np.count_nonzero(mask)):
                mask,source = refined,"opencv_refined_box"
            else:
                notes.append(d.id+": no reliable contour inside detector box; its reviewed region is an approximate edit mask.")
        if np.count_nonzero(mask) < 4:
            continue
        # Cover cavity lips, but never extend edits into surroundings outside road.
        mx,my,mw,mh = cv2.boundingRect(mask)
        rx = min(10,max(2,round(mw*.10))) if d.kind in ("Pothole","Depression") else 1
        ry = min(9,max(2,round(mh*.20))) if d.kind in ("Pothole","Depression") else 1
        lip = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*rx+1,2*ry+1))
        patch_mask = cv2.bitwise_and(cv2.dilate(mask,lip),road)
        records.append((d,mask,patch_mask,source))
    valid_ids = {d.id for d,_,_,_ in records}
    selected &= valid_ids
    repair_masks = [p for d,_,p,_ in records if d.id in selected]
    repair_mask = np.maximum.reduce(repair_masks) if repair_masks else np.zeros((h,w),np.uint8)
    original = image.copy()
    for d,mask,_,_ in records:
        contours,_ = cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        color = (70,85,240) if d.severity>=.67 else (60,183,240) if d.severity>=.34 else (150,190,90)
        cv2.drawContours(original,contours,-1,color,1,cv2.LINE_AA)
    used = "opencv_"+settings.inpaint_method
    repaired = image.copy()
    fallback = None
    if repair_masks:
        if settings.engine != "opencv":
            try:
                key = hashlib.sha256(image.tobytes()+repair_mask.tobytes()+os.environ.get("ROAD_HEALTH_INPAINT_MODEL","").encode()).hexdigest()
                repaired = _diffusers_repair(image,repair_mask,key)
                used = "diffusers_inpainting"
            except (ImportError, OSError, RuntimeError, ValueError, TypeError) as exc:
                fallback = str(exc).splitlines()[0][:220]
        if used != "diffusers_inpainting":
            repaired = opencv_repair(image,repair_masks,road,settings.inpaint_method,np.maximum.reduce([m for _,m,_,_ in records]))
    elif not records:
        notes.append("No usable visual defect masks were found. No repairs or deterioration have been invented.")
    else:
        notes.append("No repairs selected: Repaired is intentionally unchanged. Select at least one defect to fill.")
    if fallback:
        notes.append("OpenCV fallback: "+fallback)
    predicted = repaired.copy()
    prediction_mask = repair_mask.copy()
    transform = cv2.getPerspectiveTransform((np.asarray(quad,np.float32)*[w-1,h-1]).astype(np.float32),
                                            np.asarray([[0,0],[1,0],[1,1],[0,1]],np.float32))
    inverse = np.linalg.inv(transform)
    metrics = []
    yy,xx = np.indices((h,w))
    for d,mask,patch_mask,source in records:
        model = growth(d.severity,settings)
        area = int(np.count_nonzero(mask))
        future_area = area
        if settings.months and d.id not in selected:
            pts = cv2.findNonZero(mask).reshape(-1,2).astype(np.float32)
            center = cv2.perspectiveTransform(pts.reshape(-1,1,2),transform).reshape(-1,2).mean(axis=0)
            scale = model["linear_scale"]
            expand = np.asarray([[scale,0,center[0]*(1-scale)],[0,scale,center[1]*(1-scale)],[0,0,1.]])
            warp = inverse @ expand @ transform
            grown = cv2.warpPerspective(mask,warp,(w,h),flags=cv2.INTER_NEAREST)
            grown = cv2.bitwise_and(grown,road)
            # Selected repairs take precedence when neighboring masks overlap.
            grown[repair_mask>0] = 0
            pixels = cv2.warpPerspective(image,warp,(w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
            pixels = np.clip(pixels.astype(float)*(1-.2*(model["severity"]-d.severity)),0,255).astype(np.uint8)
            predicted = blend(predicted,pixels,grown)
            prediction_mask = np.maximum(prediction_mask,grown)
            future_area = int(np.count_nonzero(grown))
        elif settings.months and d.id in selected:
            decay = model["patch_degradation"]
            # Sun/traffic weather the fresh patch; cracks follow its actual edge.
            worn = repaired.astype(float)*(1+decay*.48)
            edge = cv2.morphologyEx(patch_mask,cv2.MORPH_GRADIENT,np.ones((3,3),np.uint8))>0
            fragmented = (np.sin(xx*.29+yy*.17)+np.sin(yy*.13-xx*.11)) > (.95-2*decay)
            worn[edge & fragmented] *= max(.25,1-1.5*decay)
            exposure = max(0.,(decay-.25)/.75)
            inside = cv2.distanceTransform(mask,cv2.DIST_L2,3)
            exposed = np.clip((inside/max(1,float(inside.max()))-.25)*1.5,0,1)*exposure
            worn = worn*(1-exposed[:,:,None])+image*exposed[:,:,None]
            predicted = blend(predicted,np.clip(worn,0,255).astype(np.uint8),patch_mask,1)
        metrics.append({"id":d.id,"kind":d.kind,"mask_source":source,"repaired":d.id in selected,
                        "original_area_px":area,"predicted_area_px":future_area,
                        "visual_severity":d.severity,"simulated_severity":model["severity"] if d.id not in selected else d.severity*model["patch_degradation"],
                        "patch_degradation":model["patch_degradation"] if d.id in selected else None,
                        "linear_growth_factor":model["linear_scale"] if d.id not in selected else 1.})
    return {"version":"repair-photo-v1","images":{"source":png(image),"original":png(original),"repaired":png(repaired),"predicted":png(predicted)},
            "masks":{"repair":png(repair_mask),"prediction":png(prediction_mask)},
            "image":{"original_width":ow,"original_height":oh,"width":w,"height":h},
            "settings":settings.model_dump(),"engine_used":used,"fallback_reason":fallback,
            "inpainting_status":inpainting_status(),"defects":metrics,"repair_count":len(repair_masks),
            "detection_method":"opencv_multiscale_contours" if reviewed is None else "reviewed_contours_with_opencv_box_refinement",
            "simulated":True,"forecast_validated":False,"warnings":list(dict.fromkeys(notes)),
            "model":{"traffic_multiplier":TRAFFIC[settings.traffic],"weather_multiplier":WEATHER[settings.weather],
                     "formula_version":"conditional-aging-v1","measured_depth":False}}


@router.get("/repair-views/status")
def repair_status():
    return inpainting_status()


@router.post("/repair-views")
async def photo_views(image: UploadFile=File(...), road_quad: str|None=Form(None),
                      defects_json: str|None=Form(None), repair_ids_json: str|None=Form(None),
                      settings_json: str=Form("{}")):
    try:
        data = await image.read(MAX_BYTES+1)
    finally:
        await image.close()
    if len(data)>MAX_BYTES:
        raise HTTPException(413,"Image exceeds the 12 MiB upload limit.")
    try:
        settings = PhotoSettings.model_validate_json(settings_json)
        if defects_json is not None and len(defects_json)>1_000_000:
            raise ValueError("Defect geometry is too large.")
        raw = json.loads(defects_json) if defects_json is not None else None
        if raw is not None and (not isinstance(raw,list) or len(raw)>80):
            raise ValueError("Supply at most 80 reviewed defect polygons.")
        defects = [PhotoDefect.model_validate(d) for d in raw] if raw is not None else None
        ids = json.loads(repair_ids_json) if repair_ids_json is not None else None
        if ids is not None and (not isinstance(ids,list) or len(ids)>80 or any(not isinstance(i,str) for i in ids)):
            raise ValueError("Repair IDs must be a list of up to 80 strings.")
        quad = parse_quad(road_quad)
        decoded = decode_image(data)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422,str(exc)[:500]) from exc
    if not _render_slots.acquire(blocking=False):
        raise HTTPException(429,"Two photo simulations are already rendering. Retry in a moment.")
    try:
        return await run_in_threadpool(render_views,decoded,quad,defects,ids,settings)
    except (ValueError,cv2.error) as exc:
        raise HTTPException(422,str(exc)[:500]) from exc
    finally:
        _render_slots.release()
