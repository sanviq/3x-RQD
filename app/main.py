import base64
from typing import Literal
from contextlib import asynccontextmanager

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.features import MAX_BYTES, FEATURE_VERSION, decode_image, extract_features
from app.scoring import load_model, score
from app.defects import DETECTOR_VERSION, detect_defects, parse_quad


@asynccontextmanager
async def lifespan(app):
    app.state.model = load_model()
    yield


app = FastAPI(title="Road Health", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": getattr(app.state, "model", None) is not None,
            "feature_version": FEATURE_VERSION, "defect_version": DETECTOR_VERSION}


def analyze(data, mm_per_pixel, pitch_degrees, include_overlay, capture_type="road_scene", road_quad=None):
    if capture_type != "surface_crop":
        mm_per_pixel = None
    decoded = decode_image(data)
    result, overlay = extract_features(decoded, mm_per_pixel, road_quad)
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
):
    try:
        data = await image.read(MAX_BYTES + 1)
    finally:
        await image.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image exceeds the 12 MiB upload limit.")
    try:
        return await run_in_threadpool(analyze, data, mm_per_pixel, pitch_degrees, include_overlay, capture_type, parse_quad(road_quad))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/detect-defects")
async def detect_uploaded_defects(
    image: UploadFile = File(...),
    road_quad: str | None = Form(None),
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
        return await run_in_threadpool(lambda: detect_defects(decode_image(data), quad))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# Keep the teammates' /api client and Vite's prefix-stripping proxy compatible.
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from app.road_api import router
app.include_router(router, prefix="/api")
app.include_router(router, include_in_schema=False)
app.add_api_route("/api/health", health, methods=["GET"])
app.add_api_route("/api/analyze", analyze_road, methods=["POST"])
_frontend = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if _frontend.exists():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="road-health")
