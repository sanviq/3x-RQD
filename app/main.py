import base64
from contextlib import asynccontextmanager

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.features import MAX_BYTES, FEATURE_VERSION, decode_image, extract_features
from app.scoring import load_model, score


@asynccontextmanager
async def lifespan(app):
    app.state.model = load_model()
    yield


app = FastAPI(title="Road Quality Assessment", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": getattr(app.state, "model", None) is not None,
            "feature_version": FEATURE_VERSION}


def analyze(data, mm_per_pixel, pitch_degrees, include_overlay):
    result, overlay = extract_features(decode_image(data), mm_per_pixel)
    result["assessment"] = score(result["features"], getattr(app.state, "model", None))
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
):
    try:
        data = await image.read(MAX_BYTES + 1)
    finally:
        await image.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image exceeds the 12 MiB upload limit.")
    try:
        return await run_in_threadpool(analyze, data, mm_per_pixel, pitch_degrees, include_overlay)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
