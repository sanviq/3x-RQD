import base64
from typing import Literal
from contextlib import asynccontextmanager

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.features import MAX_BYTES, FEATURE_VERSION, decode_image, extract_features
from app.scoring import load_model, score
from app.defects import DETECTOR_VERSION, parse_quad
from app.integrated_detector import detect_defects
from app.calibration import calibration_metadata


@asynccontextmanager
async def lifespan(app):
    app.state.model = load_model()
    yield


app = FastAPI(title="Road Health", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": getattr(app.state, "model", None) is not None,
            "feature_version": FEATURE_VERSION, "defect_version": DETECTOR_VERSION}


def analyze(data, mm_per_pixel, pitch_degrees, include_overlay, capture_type="road_scene", road_quad=None, scale_uncertainty_percent=None):
    if capture_type != "surface_crop":
        mm_per_pixel = None
    decoded = decode_image(data)
    result, overlay = extract_features(decoded, mm_per_pixel, road_quad)
    result['calibration']=calibration_metadata(result['physical_measurements'],mm_per_pixel,scale_uncertainty_percent)
    result["defect_detection"] = detect_defects(decoded, road_quad)
    result["assessment"] = score(result["features"], getattr(app.state, "model", None), capture_type)
    result["capture_type"] = capture_type
    result["warnings"].extend(result["assessment"]["reasons"])
    result["warnings"].append("Capture type is user-declared; road content is not automatically verified.")
    result["feature_version"] = FEATURE_VERSION
    result["inclination"] = {"degrees": pitch_degrees,
                             "source": "user_supplied_sensor" if pitch_degrees is not None else "unavailable"}
    result["warnings"].append("Inclination is not inferred from the image and does not affect this surface score.")
    if include_overlay:
        success, encoded = cv2.imencode(".png", overlay)
        if not success:
            raise ValueError("Could not encode diagnostic overlay.")
        result["overlay_png_base64"] = base64.b64encode(encoded).decode("ascii")
    return result


@app.post("/analyze")
async def analyze_road(
    image: UploadFile = File(...),
    mm_per_pixel: float | None = Form(None, gt=0, le=1000),
    pitch_degrees: float | None = Form(None, ge=-90, le=90),
    include_overlay: bool = Form(False),
    capture_type: Literal["road_scene", "surface_crop"] = Form("road_scene"),
    road_quad: str | None = Form(None),
    scale_uncertainty_percent: float | None = Form(None, ge=0, lt=100),
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
        return await run_in_threadpool(analyze, data, mm_per_pixel, pitch_degrees, include_overlay, capture_type, parse_quad(road_quad),scale_uncertainty_percent)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/detect-defects")
async def detect_uploaded_defects(
    image: UploadFile = File(...),
    road_quad: str | None = Form(None),
    confidence: float | None = Form(None, ge=0, le=1),
    resolution: int | None = Form(None, ge=320, le=1280),
):
    """Fast candidate detection; no score or metric depth is inferred."""
    try:
        data = await image.read(MAX_BYTES + 1)
    finally:
        await image.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image exceeds the 12 MiB upload limit.")
    try:
        quad = parse_quad(road_quad)
        return await run_in_threadpool(lambda: detect_defects(decode_image(data), quad, confidence, resolution))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


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
app.add_api_route("/api/health", health, methods=["GET"])
app.add_api_route("/api/analyze", analyze_road, methods=["POST"])
app.add_api_route("/api/detect-defects", detect_uploaded_defects, methods=["POST"])
_frontend = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if _frontend.exists():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="road-health")
