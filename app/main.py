import base64
from typing import Literal
from contextlib import asynccontextmanager
from pickle import UnpicklingError
from importlib.metadata import version

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.features import MAX_BYTES, FEATURE_VERSION, decode_image, extract_features
from app.scoring import load_model, score
from app.defects import parse_surface_polygon, DETECTOR_VERSION, parse_quad
from app.integrated_detector import detect_defects
from app.calibration import calibration_metadata
from app.road_region import identify_road
from app.road_quality_score import attach_score, router as quality_score_router


@asynccontextmanager
async def lifespan(app):
    app.state.model_error = None
    try:
        app.state.model = load_model()
    except (ValueError,OSError,TypeError,KeyError,AttributeError,EOFError,ImportError,UnpicklingError) as exc:
        app.state.model = None
        app.state.model_error = str(exc)[:250]
    yield


app = FastAPI(title="Road Health", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def fresh_frontend(request, call_next):
    response = await call_next(request)
    if response.headers.get("content-type", "").startswith("text/html"):
        # HTML selects the hashed bundle. Reusing old HTML mixed old road-boundary
        # handling with a newer backend after deployment.
        response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": getattr(app.state, "model", None) is not None,
            "feature_version": FEATURE_VERSION, "defect_version": DETECTOR_VERSION,
            "surface_model_error": getattr(app.state,"model_error",None),
            "processing_runtime":{"opencv":cv2.__version__,**{name:version(name) for name in ('numpy','scipy','scikit-image','Pillow')}}}


def scored_detection(decoded,data,road_quad=None,confidence=None,resolution=None,detector_mode='auto',road_polygon=None):
    region=identify_road(decoded,road_quad=road_quad)
    coverage=parse_surface_polygon(road_polygon or region.get('road_polygon'),region['road_quad'])
    detected=detect_defects(decoded,region["road_quad"],confidence,resolution,mode=detector_mode,road_polygon=coverage)
    region["road_polygon"]=[{"x":x,"y":y} for x,y in coverage]
    detected["road_region"]=region
    h,w=decoded.shape[:2]
    roi=np.zeros((h,w),np.uint8)
    cv2.fillConvexPoly(roi,np.rint([[p["x"]*(w-1),p["y"]*(h-1)] for p in [{"x":x,"y":y} for x,y in coverage]]).astype(np.int32),1)
    pixels=cv2.cvtColor(decoded,cv2.COLOR_BGR2GRAY)[roi>0]
    if not len(pixels) or pixels.std()<2 or np.mean(pixels<5)>.98 or np.mean(pixels>250)>.98:
        return {**detected,"road_quality_score":None,"score_error":"No condition score: the selected road has no usable tonal detail. Refocus, correct exposure and use the original camera image. Pixel brightness and area descriptors remain available."}
    return attach_score(detected,decoded,data)


def analyze(data, mm_per_pixel, pitch_degrees, include_overlay, capture_type="road_scene", road_quad=None, scale_uncertainty_percent=None, detector_mode='auto', confidence=None, resolution=None, road_polygon=None):
    if capture_type != "surface_crop":
        mm_per_pixel = None
    decoded = decode_image(data)
    region=identify_road(decoded,capture_type,road_quad)
    road_quad=region["road_quad"]
    coverage=parse_surface_polygon(road_polygon or region.get("road_polygon"),road_quad)
    region["road_polygon"]=[{"x":x,"y":y} for x,y in coverage]
    result, overlay = extract_features(decoded, mm_per_pixel, road_quad, coverage)
    result["road_region"]=region
    result['calibration']=calibration_metadata(result['physical_measurements'],mm_per_pixel,scale_uncertainty_percent)
    try:
        result["defect_detection"] = scored_detection(decoded, data, road_quad, confidence, resolution, detector_mode, coverage)
    except ValueError as exc:
        # Keep real texture measurements when the explicitly selected detector fails.
        # Do not substitute a different detector or a condition score.
        result["warnings"].append(str(exc))
    result["assessment"] = score(result["features"], getattr(app.state, "model", None), capture_type)
    result["capture_type"] = capture_type
    result["warnings"].extend(result["assessment"]["reasons"])
    if capture_type=="road_scene":
        result["surface_quality"]["issues"].append({"code":"perspective_scale","message":"This scene has changing perspective scale.","guidance":"Pixel statistics describe the selected image region. Use an already rectified, uniformly scaled surface crop for physical chip measurements.","affects":["physical_measurements"]})
    if getattr(app.state,"model_error",None):
        result["warnings"].append("The optional texture regressor was not loaded: "+app.state.model_error+". Texture descriptors and the separate provisional defect score remain available.")
    result["warnings"].append(region["message"])
    result["feature_version"] = FEATURE_VERSION
    result["inclination"] = {"degrees": pitch_degrees,
                             "source": "user_supplied_sensor" if pitch_degrees is not None else "unavailable"}
    result["warnings"].append("Inclination is not inferred from the image and does not affect this surface score.")
    if include_overlay:
        success, encoded = cv2.imencode(".png", overlay)
        if not success:
            raise ValueError("Could not encode diagnostic overlay.")
        result["overlay_png_base64"] = base64.b64encode(encoded).decode("ascii")
    result["warnings"]=list(dict.fromkeys(result["warnings"]))
    return result


@app.post("/road-region")
async def road_region(image:UploadFile=File(...),capture_type:Literal["road_scene","surface_crop"]=Form("road_scene")):
    try:
        data=await image.read(MAX_BYTES+1)
    finally:
        await image.close()
    if len(data)>MAX_BYTES:raise HTTPException(413,"Image exceeds the 12 MiB upload limit.")
    try:
        return await run_in_threadpool(lambda:identify_road(decode_image(data),capture_type))
    except (ValueError,cv2.error) as exc:raise HTTPException(422,"Road region could not be prepared: "+str(exc)[:250]) from exc


@app.post("/analyze")
async def analyze_road(
    image: UploadFile = File(...),
    mm_per_pixel: float | None = Form(None, gt=0, le=1000),
    pitch_degrees: float | None = Form(None, ge=-90, le=90),
    include_overlay: bool = Form(False),
    capture_type: Literal["road_scene", "surface_crop"] = Form("road_scene"),
    road_quad: str | None = Form(None),
    road_polygon: str | None = Form(None),
    scale_uncertainty_percent: float | None = Form(None, ge=0, lt=100),
    detector_mode: Literal['auto','model','opencv'] = Form('auto'),
    confidence: float | None = Form(None, ge=0, le=1),
    resolution: int | None = Form(None, ge=320, le=1280),
):
    try:
        data = await image.read(MAX_BYTES + 1)
    finally:
        await image.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image exceeds the 12 MiB upload limit.")
    try:
        if scale_uncertainty_percent is not None and (capture_type!='surface_crop' or mm_per_pixel is None):
            raise ValueError('Scale uncertainty requires a surface crop with mm_per_pixel.')
        return await run_in_threadpool(analyze, data, mm_per_pixel, pitch_degrees, include_overlay, capture_type, parse_quad(road_quad) if road_quad is not None else None,scale_uncertainty_percent,detector_mode,confidence,resolution,road_polygon)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/detect-defects")
async def detect_uploaded_defects(
    image: UploadFile = File(...),
    road_quad: str | None = Form(None),
    road_polygon: str | None = Form(None),
    confidence: float | None = Form(None, ge=0, le=1),
    resolution: int | None = Form(None, ge=320, le=1280),
    detector_mode: Literal['auto','model','opencv'] = Form('auto'),
):
    """Detect actual candidates and attach an explicitly provisional defect-area score."""
    try:
        data = await image.read(MAX_BYTES + 1)
    finally:
        await image.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image exceeds the 12 MiB upload limit.")
    try:
        quad = parse_quad(road_quad) if road_quad is not None else None
        return await run_in_threadpool(lambda: scored_detection(decode_image(data), data, quad, confidence, resolution, detector_mode,road_polygon))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


from app.map_api import router as map_router
app.include_router(map_router, prefix="/api")
app.include_router(map_router, include_in_schema=False)

app.include_router(quality_score_router, prefix="/api")
app.include_router(quality_score_router, include_in_schema=False)

from app.weather_compare import router as weather_router
app.include_router(weather_router, prefix="/api")
app.include_router(weather_router, include_in_schema=False)

# Photo-grounded repair views; register before the optional static frontend.
from app.repair_views import router as repair_router
app.include_router(repair_router, prefix="/api")
app.include_router(repair_router, include_in_schema=False)

# Keep the teammates' /api client and Vite's prefix-stripping proxy compatible.
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from app.road_api import router
app.include_router(router, prefix="/api")
app.include_router(router, include_in_schema=False)
app.add_api_route("/api/road-region", road_region, methods=["POST"])
app.add_api_route("/api/health", health, methods=["GET"])
app.add_api_route("/api/analyze", analyze_road, methods=["POST"])
app.add_api_route("/api/detect-defects", detect_uploaded_defects, methods=["POST"])
_frontend = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if _frontend.exists():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="road-health")
