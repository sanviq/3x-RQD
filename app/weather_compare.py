
"""Native-resolution, independent weather experiments with explicit evidence provenance."""
import hashlib
import json
import math
import secrets
import shutil
import tempfile
import threading
import time
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from PIL import Image
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool
from app.features import MAX_BYTES, decode_image
from app.defects import parse_quad
from app import detection

router=APIRouter()
CONDITIONS=("rain","puddles","shadow","low_light","glare","blur","perspective")
COLORS={"Pothole":"#ed6c58","Crack":"#b68cde","Surface wear":"#d7a76a","Depression":"#e8b451","Patch":"#63b9b2","Uneven surface":"#63b9b2"}
_jobs={}
_jobs_lock=threading.Lock()
_slot=threading.BoundedSemaphore(1)
TEMP_ROOT=Path(tempfile.gettempdir()).resolve()
MAX_EVIDENCE=512*1024*1024
TTL=600


class GroundTruth(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)
    id:str=Field(min_length=1,max_length=80)
    kind:Literal["Pothole","Crack","Surface wear","Depression","Patch","Uneven surface"]
    polygon:list[list[float]]=Field(min_length=3,max_length=1000)
    detection_code:str|None=None

    @field_validator("polygon")
    @classmethod
    def valid(cls,value):
        if any(len(p)!=2 or not all(math.isfinite(v) and 0<=v<=1 for v in p) for p in value):
            raise ValueError("Ground truth requires normalized EXIF-oriented original polygon coordinates.")
        if abs(cv2.contourArea(np.asarray(value,np.float32)))<1e-10:
            raise ValueError("Ground truth polygons must have nonzero area.")
        return value


def points_mask(points,shape):
    mask=np.zeros(shape,np.uint8)
    pts=np.rint(np.asarray(points)).astype(np.int32)
    cv2.fillPoly(mask,[pts],255)
    return mask


def project(points,matrix):
    return cv2.perspectiveTransform(np.asarray(points,np.float32).reshape(-1,1,2),matrix).reshape(-1,2)


def preprocess(image):
    """Only an inference copy is filtered; the source and displayed pixels stay intact."""
    lab=cv2.cvtColor(image,cv2.COLOR_BGR2LAB)
    lab[:,:,0]=cv2.createCLAHE(clipLimit=2.,tileGridSize=(8,8)).apply(lab[:,:,0])
    normalized=cv2.cvtColor(lab,cv2.COLOR_LAB2BGR)
    return cv2.bilateralFilter(normalized,5,16,5)


def apply_condition(image,name,intensity,road):
    h,w=image.shape[:2];identity=np.eye(3,dtype=np.float64)
    effect=np.zeros((h,w),np.uint8);valid=np.full((h,w),255,np.uint8)
    if name=="original" or intensity==0:
        return image.copy(),identity,effect,valid
    frame=image.astype(np.float32);yy,xx=np.indices((h,w),dtype=np.float32)
    unit=min(w,h)/640
    if name=="shadow":
        cv2.fillPoly(effect,[np.rint(np.asarray([[0,0],[.3*w,0],[w,.8*h],[w,h],[.5*w,h]])).astype(np.int32)],255)
        frame[effect>0]*=1-.82*intensity
    elif name=="low_light":
        frame*=1-.85*intensity;effect[:]=round(255*intensity)
    elif name=="glare":
        glow=np.exp(-(((xx/w)-.65)**2+((yy/h)-.35)**2)/.075)
        frame+=glow[:,:,None]*(255*intensity);effect[glow*intensity>.15]=255
    elif name=="blur":
        sigma=max(.1,(.5+5*intensity)*max(.5,unit))
        frame=cv2.GaussianBlur(frame,(0,0),sigma);effect[:]=round(255*intensity)
    elif name=="rain":
        frame*=1-.22*intensity
        rng=np.random.default_rng(42)
        for x,y in rng.uniform(0,1,(round(700*intensity),2)):
            start=(round(x*(w-1)),round(y*(h-1)))
            end=(round(start[0]-4*max(.5,unit)),min(h-1,round(start[1]+16*max(.5,unit))))
            cv2.line(frame,start,end,(180,190,195),max(1,round(unit)))
            cv2.line(effect,start,end,255,max(1,round(unit)))
    elif name=="puddles":
        # Synthetic occlusions, never synthetic defect annotations.
        q=road.astype(np.float32)
        plane=cv2.getPerspectiveTransform(np.asarray([[0,0],[1,0],[1,1],[0,1]],np.float32),q)
        for cx,cy,rx,ry in ((.32,.73,.21,.065),(.71,.48,.19,.055)):
            theta=np.linspace(0,2*np.pi,64,endpoint=False)
            unit_points=np.stack([cx+rx*np.cos(theta),cy+ry*np.sin(theta)],axis=1)
            contour=project(unit_points,plane)
            cv2.fillPoly(effect,[np.rint(contour).astype(np.int32)],255)
        reflected=cv2.flip(image,0).astype(float)*.6+np.asarray([55,40,25])
        alpha=(effect.astype(float)/255*intensity*.8)[:,:,None]
        frame=frame*(1-alpha)+reflected*alpha
    elif name=="perspective":
        src=np.asarray([[0,0],[w-1,0],[w-1,h-1],[0,h-1]],np.float32)
        dst=np.asarray([[w*.18*intensity,h*.04*intensity],[w-1-w*.18*intensity,h*.04*intensity],[w-1,h-1],[0,h-1]],np.float32)
        matrix=cv2.getPerspectiveTransform(src,dst)
        frame=cv2.warpPerspective(image,matrix,(w,h),flags=cv2.INTER_LINEAR)
        valid=cv2.warpPerspective(valid,matrix,(w,h),flags=cv2.INTER_NEAREST)
        effect[valid==0]=255
        return frame,matrix,effect,valid
    else:
        raise ValueError("Unsupported condition.")
    return np.clip(frame,0,255).astype(np.uint8),identity,effect,valid


def native_candidates(image,road):
    """Reuse the application's adaptive multi-evidence CV pipeline without its preview resize."""
    from app.defects import detect_defects, FULL_QUAD
    h,w=image.shape[:2]
    contours,_=cv2.findContours(road,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    if not contours: return []
    hull=cv2.convexHull(max(contours,key=cv2.contourArea),clockwise=False)
    q=cv2.approxPolyDP(hull,max(.5,cv2.arcLength(hull,True)*.002),True).reshape(-1,2)
    quad=(q/[w-1,h-1]).tolist() if len(q)==4 else FULL_QUAD
    candidates=detect_defects(image,quad,native_resolution=True)
    return [{"kind":d["kind"],"polygon":[[p["x"]*(w-1),p["y"]*(h-1)] for p in d["polygon"]],
             "confidence":d["confidence"],"severity":d["severity"],"geometry":"candidate_contour",
             "detection_code":None,"appearance":d["appearance"]} for d in candidates["defects"]]


def infer(image,road,confidence,resolution):
    status=detection.model_status()
    if status["configured"]:
        outputs=detection.predict(image,"model",confidence,resolution)
        h,w=image.shape[:2];items=[]
        mapping={"pothole":"Pothole","crack":"Crack","ravelling":"Surface wear","repair_patch":"Patch","uneven_surface":"Uneven surface"}
        for d in outputs:
            if d.class_name not in mapping:
                continue
            if d.polygon:
                poly=np.asarray(d.polygon)*[w,h];geometry="model_segmentation"
            else:
                x1,y1,x2,y2=np.asarray(d.bbox)*[w,h,w,h]
                poly=np.asarray([[x1,y1],[x2,y1],[x2,y2],[x1,y2]]);geometry="bounding_box_estimate"
            label=(d.detection_label or "").lower()
            kind="Depression" if "depression" in label else mapping[d.class_name]
            items.append({"kind":kind,"polygon":poly.tolist(),"confidence":d.confidence,"severity":d.severity,
                          "geometry":geometry,"detection_code":d.detection_code})
        model_status=detection.model_status()
        names=getattr(detection._model,"names",{})
        labels=names.values() if isinstance(names,dict) else names
        coverage=set()
        for raw in labels:
            raw=str(raw).lower().replace(" ","_").replace("-","_")
            category=detection.ALIASES.get(raw,raw)
            if "depression" in raw: coverage.add("Depression")
            elif category in mapping: coverage.add(mapping[category])
        model_status["weather_class_coverage"]=sorted(coverage)
        return items,"trained_yolo",model_status
    status["weather_class_coverage"]=["Pothole","Crack","Depression","Uneven surface"]
    return [d for d in native_candidates(image,road) if d["confidence"]>=confidence],"opencv_candidates",status


def box(poly):
    p=np.asarray(poly)
    return [float(p[:,0].min()),float(p[:,1].min()),float(p[:,0].max()),float(p[:,1].max())]


def iou(a,b):
    ax,ay,bx,by=box(a);cx,cy,dx,dy=box(b)
    common=max(0,min(bx,dx)-max(ax,cx))*max(0,min(by,dy)-max(ay,cy))
    return common/max(1e-9,(bx-ax)*(by-ay)+(dx-cx)*(dy-cy)-common)


def associate(reference,other,threshold=.3):
    pairs=[]
    for i,a in enumerate(reference):
        for j,b in enumerate(other):
            if a["kind"]!=b["kind"]:
                continue
            if a.get("detection_code") and b.get("detection_code") and a["detection_code"]!=b["detection_code"]:
                continue
            overlap=iou(a["reference_polygon"],b["reference_polygon"])
            if overlap>=threshold:
                pairs.append((overlap,i,j))
    used_a=set();used_b=set();matched=[]
    for overlap,i,j in sorted(pairs,reverse=True):
        if i not in used_a and j not in used_b:
            used_a.add(i);used_b.add(j);matched.append((i,j,overlap))
    return matched,[i for i in range(len(reference)) if i not in used_a],[j for j in range(len(other)) if j not in used_b]


def evaluate(records,annotations,evaluation_kinds=None):
    if annotations is None:
        return {"available":False,"precision":None,"recall":None,"f1":None,"reason":"No known annotations were supplied."}
    excluded=sum(d["kind"] not in evaluation_kinds for d in records) if evaluation_kinds else 0
    if evaluation_kinds: records=[d for d in records if d["kind"] in evaluation_kinds]
    matched,missed,added=associate(annotations,records,.5)
    tp,fn,fp=len(matched),len(missed),len(added)
    return {"available":True,"tp":tp,"fp":fp,"fn":fn,
            "precision":tp/(tp+fp) if tp+fp else None,"recall":tp/(tp+fn) if tp+fn else None,
            "f1":2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,"iou_threshold":.5,
            "annotation_count":len(annotations),"evaluated_kinds":evaluation_kinds or list(COLORS),"excluded_prediction_count":excluded,"area_matching":"Class-aware bounding-box IoU; not segmentation IoU.",
            "missed_annotation_ids":[annotations[i]["id"] for i in missed]}


def prepare_records(raw,matrix,road_source,road_frame,valid,effect,frame_name,quality):
    h,w=road_source.shape
    inverse=np.linalg.inv(matrix);records=[];union=np.zeros((h,w),np.uint8)
    for item in raw:
        frame=np.clip(np.asarray(item["polygon"],np.float32),[0,0],[w-1,h-1])
        fm=points_mask(frame,(h,w))
        fm=cv2.bitwise_and(fm,cv2.bitwise_and(road_frame,valid))
        contours,_=cv2.findContours(fm,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        largest=max(contours,key=cv2.contourArea)
        contour=cv2.approxPolyDP(largest,max(.6,cv2.arcLength(largest,True)*.002),True).reshape(-1,2)
        if len(contour)<3:
            continue
        reference=np.clip(project(contour,inverse),[0,0],[w-1,h-1])
        rm=cv2.bitwise_and(points_mask(reference,(h,w)),road_source)
        count=int(np.count_nonzero(rm))
        if count<3:
            continue
        fraction=float(np.mean(effect[fm>0]>0))
        union=cv2.bitwise_or(union,rm)
        records.append({**item,"id":frame_name+"-"+str(len(records)+1),
                        "frame_polygon":contour.astype(float).tolist(),"reference_polygon":reference.tolist(),
                        "bbox_reference_px":box(reference),"pixel_area":count,
                        "visible_road_percent":count/max(1,np.count_nonzero(road_source))*100,
                        "effect_overlap_fraction":round(fraction,4),
                        "uncertainty":(["Untrained appearance candidate; class and severity require visual review."] if item["geometry"]=="candidate_contour" else [])+
                                      ([item["appearance"]+"; cavity not confirmed."] if "water" in item.get("appearance","") else [])+
                                      (["Synthetic effect overlaps this region."] if fraction>.1 else [])+
                                      (["Image-quality checks request repeat capture."] if quality["repeat_capture"] else []),
                        "physical_dimensions":None})
        records[-1].pop("polygon",None)
    return records,{"count":len(records),"by_type":{k:sum(d["kind"]==k for d in records) for k in COLORS},
                    "affected_pixel_area":int(np.count_nonzero(union)),
                    "visible_road_pixel_area":int(np.count_nonzero(road_source)),
                    "visible_road_affected_percent":np.count_nonzero(union)/max(1,np.count_nonzero(road_source))*100,
                    "area_interpretation":"Union of mapped detection regions; boxes/candidate contours are not verified damaged area."}


def _remove(path):
    p=Path(path).resolve()
    if p.parent==TEMP_ROOT and p.name.startswith("road-weather-"):
        shutil.rmtree(p,ignore_errors=True)


def cleanup():
    now=time.monotonic()
    for token in list(_jobs):
        if now-_jobs[token]["time"]>TTL:
            _remove(_jobs.pop(token)["dir"])


def write_png(folder,name,image):
    path=folder/(name+".png")
    if not cv2.imwrite(str(path),image):
        raise ValueError("Could not write native-resolution evidence.")
    return path.stat().st_size


@lru_cache(maxsize=1)
def bundled_index():
    root=Path(__file__).resolve().parent.parent/"data"/"examples"/"rdd2022"
    return {hashlib.sha256(p.read_bytes()).hexdigest():p for p in root.glob("*.jpg") if p.with_suffix(".txt").exists()}


def bundled_annotations(digest,w,h,orientation):
    # Exact bytes only: an unrelated image with the same filename must never inherit labels.
    path=bundled_index().get(digest) if orientation==1 else None
    if path is None:
        return None
    output=[]
    codes=("D00","D10","D20","D40")
    for i,line in enumerate(path.with_suffix(".txt").read_text().splitlines()):
        if not line.strip(): continue
        cls,cx,cy,bw,bh=map(float,line.split());category=int(cls)
        if category not in range(4): continue
        x1=max(0,(cx-bw/2)*w/(w-1));x2=min(1,(cx+bw/2)*w/(w-1))
        y1=max(0,(cy-bh/2)*h/(h-1));y2=min(1,(cy+bh/2)*h/(h-1))
        output.append(GroundTruth(id="rdd-"+str(i+1),kind="Pothole" if category==3 else "Crack",
            detection_code=codes[category],polygon=[[x1,y1],[x2,y1],[x2,y2],[x1,y2]]))
    return output


def compare_weather(data,filename,conditions,intensity,quad,preprocessing,confidence,resolution,annotations):
    selection=detection.model_status()
    confidence=float(selection.get("confidence",.35)) if confidence is None else confidence
    resolution=int(selection.get("imgsz",640)) if resolution is None else resolution
    source=decode_image(data);h,w=source.shape[:2]
    with Image.open(BytesIO(data)) as im:
        metadata={"filename":filename,"format":im.format,"original_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),
                  "raw_width":im.width,"raw_height":im.height,"exif_orientation":int(im.getexif().get(274,1)),
                  "exif_bytes":len(im.info.get("exif",b"")),"icc_profile_bytes":len(im.info.get("icc_profile",b"")),
                  "width":w,"height":h,"coordinate_system":"EXIF-oriented original pixels",
                  "source_file_unchanged":True,"source_metadata_preserved_in_original_file":True,
                  "preview_metadata":"Lossless PNG evidence is an upright derivative; the uploaded original remains unchanged."}
    annotation_source="User-supplied known annotations" if annotations is not None else None
    if annotations is None:
        annotations=bundled_annotations(metadata["sha256"],w,h,metadata["exif_orientation"])
        if annotations is not None: annotation_source="Bundled RDD2022 exact SHA-256 match"
    q=np.asarray(parse_quad(quad),np.float32)*[w-1,h-1]
    road=points_mask(q,(h,w))
    gt=None
    if annotations is not None:
        gt=[{"id":a.id,"kind":a.kind,"detection_code":a.detection_code,
             "reference_polygon":(np.asarray(a.polygon)*[w-1,h-1]).tolist()} for a in annotations]
        clipped=[]
        for a in gt:
            mask=cv2.bitwise_and(points_mask(a["reference_polygon"],(h,w)),road)
            contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                contour=max(contours,key=cv2.contourArea).reshape(-1,2)
                if len(contour)>=3: clipped.append({**a,"reference_polygon":contour.tolist()})
        gt=clipped
    folder=Path(tempfile.mkdtemp(prefix="road-weather-",dir=TEMP_ROOT));token=secrets.token_urlsafe(24)
    frames=[];size=0;baseline=None
    try:
        for name in ["original"]+conditions:
            started=time.perf_counter()
            frame,matrix,effect,valid=apply_condition(source,name,intensity,q)
            road_frame=cv2.warpPerspective(road,matrix,(w,h),flags=cv2.INTER_NEAREST)
            quality=detection.image_quality(frame)
            work=preprocess(frame) if preprocessing else frame.copy()
            # Independent inference for each frame; no original detections are reused.
            raw,engine,status=infer(work,road_frame,confidence,resolution)
            records,summary=prepare_records(raw,matrix,road,road_frame,valid,effect,name,quality)
            summary["not_assessed"]=[kind for kind in COLORS if kind not in status["weather_class_coverage"]]
            for kind in summary["not_assessed"]: summary["by_type"][kind]=None
            audit={"enabled":preprocessing,"raw_count":None,"preprocessing_only":[],"raw_only":[]}
            if preprocessing:
                untouched,_,_=infer(frame,road_frame,confidence,resolution)
                raw_records,_=prepare_records(untouched,matrix,road,road_frame,valid,effect,name+"-raw",quality)
                supported,raw_only,processed_only=associate(raw_records,records)
                audit.update(raw_count=len(raw_records),preprocessing_only=[records[j]["id"] for j in processed_only],
                             raw_only=[raw_records[j]["id"] for j in raw_only],
                             raw_only_regions=[{key:raw_records[j][key] for key in ("id","kind","reference_polygon","pixel_area","severity","confidence","geometry")} for j in raw_only])
                for j in processed_only:
                    records[j]["uncertainty"].append("Detected only after preprocessing; review against the raw image.")
                for i,j,_ in supported:
                    records[j]["raw_support"]=raw_records[i]["id"]
            if baseline is None:
                baseline=records
                changes={"matched":[],"missed":[],"added":[]}
            else:
                matched,missed,added=associate(baseline,records)
                changes={"matched":[{"original_id":baseline[i]["id"],"condition_id":records[j]["id"],"iou":overlap,
                           "pixel_area_change":records[j]["pixel_area"]-baseline[i]["pixel_area"],
                           "severity_change":records[j]["severity"]-baseline[i]["severity"],
                           "confidence_change":records[j]["confidence"]-baseline[i]["confidence"]} for i,j,overlap in matched],
                         "missed":[baseline[i]["id"] for i in missed],"added":[records[j]["id"] for j in added]}
                for j in added:
                    records[j]["uncertainty"].append("Additional condition detection; may be a weather artifact or baseline miss, not new physical damage.")
            for d in records:
                d["uncertain"]=bool(d["uncertainty"])
                d["severity_label"]="High" if d["severity"]>=.67 else "Moderate" if d["severity"]>=.34 else "Low"
                d["confidence_calibrated"]=False
            size+=write_png(folder,name,frame)+write_png(folder,name+"-effect",effect)
            if size>MAX_EVIDENCE:
                raise ValueError("Native evidence exceeds the 512 MiB comparison limit. Analyze fewer conditions per batch; source resolution will not be reduced.")
            frames.append({"condition":name,"width":w,"height":h,"image_path":"/weather-evidence/"+token+"/"+name+".png",
                           "effect_mask_path":"/weather-evidence/"+token+"/"+name+"-effect.png",
                           "to_condition":matrix.tolist(),"to_reference":np.linalg.inv(matrix).tolist(),
                           "defects":records,"summary":summary,"changes":changes,"preprocessing":audit,
                           "quality":quality,"engine":engine,"model_status":status,"metrics":evaluate(records,gt,["Pothole","Crack"] if annotation_source=="Bundled RDD2022 exact SHA-256 match" else None),
                           "pipeline_ms":round((time.perf_counter()-started)*1000,1)})
        with _jobs_lock:
            cleanup()
            while _jobs and sum(j["bytes"] for j in _jobs.values())+size>MAX_EVIDENCE:
                oldest=min(_jobs,key=lambda k:_jobs[k]["time"]);_remove(_jobs.pop(oldest)["dir"])
            _jobs[token]={"dir":folder,"time":time.monotonic(),"bytes":size}
        return {"version":"native-weather-v1","metadata":metadata,"intensity":intensity,"frames":frames,
                "ground_truth_supplied":annotations is not None,"ground_truth_source":annotation_source,"configuration":{"confidence":confidence,"model_imgsz":resolution,"preprocessing":preprocessing,"road_quad":parse_quad(quad)},"evidence_expires_seconds":TTL,
                "notice":["All displayed frames retain the EXIF-oriented source width, height and aspect ratio. Synthetic transformations never replace the original file.",
                          "Every condition is independently analyzed. Added/missed detections show instability, not proof of genuine defects or real-weather accuracy.",
                          "Preprocessing cannot recover information hidden by glare, blur or puddles. Artifact overlap and raw/preprocessed disagreement remain uncertain.",
                          "No road-health score, calibrated confidence, metric depth or physical dimensions are inferred. Areas use the user-selected road outline, not automatic road segmentation.",
                          "OpenCV returns at most 80 reviewed candidates and the model at most 100 detections per frame. Counts reaching these limits may be truncated.",
                          "Without active weights these are unvalidated OpenCV candidates. RDD2022 weights cover cracks/potholes only; wear, depressions and patches need suitable labeled model classes.",
                          "Precision/recall/F1 require supplied known annotations and use class-aware box IoU at 0.5, not mask IoU. A single synthetic experiment does not establish deployment robustness.",
                          "Native PNG evidence is temporary and expires after 10 minutes. Download the original file and reports to retain them."]}
    except Exception:
        _remove(folder)
        raise


@router.get("/weather-evidence/{token}/{name}")
def evidence(token:str,name:str):
    if not token or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in token):
        raise HTTPException(404,"Evidence not found.")
    permitted={n+".png" for n in ("original",)+CONDITIONS}|{n+"-effect.png" for n in ("original",)+CONDITIONS}
    with _jobs_lock:
        cleanup();job=_jobs.get(token)
        if job is None or name not in permitted:
            raise HTTPException(404,"Evidence expired. Run the comparison again.")
        path=job["dir"]/name
        if not path.is_file():
            raise HTTPException(404,"Evidence not found.")
    return FileResponse(path,media_type="image/png",headers={"Cache-Control":"private, max-age=60"})


@router.post("/weather-compare")
async def weather_compare(image:UploadFile=File(...),conditions_json:str=Form('["rain"]'),
                          intensity:float=Form(.5,ge=0,le=1),road_quad:str|None=Form(None),
                          preprocessing:bool=Form(True),confidence:float|None=Form(None,ge=0,le=1),
                          resolution:int|None=Form(None,ge=320,le=1280),annotations_json:str|None=Form(None)):
    filename=image.filename or "capture"
    try:
        data=await image.read(MAX_BYTES+1)
    finally:
        await image.close()
    if len(data)>MAX_BYTES:
        raise HTTPException(413,"Image exceeds the 12 MiB upload limit.")
    try:
        conditions=json.loads(conditions_json)
        if not isinstance(conditions,list) or not 1<=len(conditions)<=7 or any(c not in CONDITIONS for c in conditions) or len(set(conditions))!=len(conditions):
            raise ValueError("Choose one to seven unique supported conditions.")
        quad=parse_quad(road_quad)
        if annotations_json is not None and len(annotations_json)>1_000_000:
            raise ValueError("Annotation geometry exceeds 1 MiB.")
        a=json.loads(annotations_json) if annotations_json is not None else None
        if a is not None and (not isinstance(a,list) or len(a)>200):
            raise ValueError("Supply at most 200 known annotation polygons.")
        annotations=[GroundTruth.model_validate(v) for v in a] if a is not None else None
        if annotations is not None and len({v.id for v in annotations})!=len(annotations):
            raise ValueError("Ground-truth IDs must be unique.")
    except (ValueError,TypeError) as exc:
        raise HTTPException(422,str(exc)[:500]) from exc
    if not _slot.acquire(blocking=False):
        raise HTTPException(429,"A native weather comparison is already running. Retry after it finishes.")
    try:
        return await run_in_threadpool(compare_weather,data,filename,conditions,intensity,quad,preprocessing,confidence,resolution,annotations)
    except (ValueError,cv2.error) as exc:
        raise HTTPException(422,str(exc)[:500]) from exc
    finally:
        _slot.release()
