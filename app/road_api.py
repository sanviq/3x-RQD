"""Local Road Health API. No uploaded media are persisted after processing."""
import json
import secrets
import tempfile
import threading
import time
from pathlib import Path
from typing import Literal

import cv2
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from pydantic import Field
from app.assessment import (AssessmentRequest, Inclination, OptimizeRequest, SafeModel, ScoreConfig, assess, inclination_result, optimize)
from app.detection import Tracker, demo_defects, demo_image, survey_defects, inspect, model_status
from app.evaluation import EvaluationRequest, evaluate
from app.features import MAX_BYTES, decode_image

router = APIRouter()
_sessions = {}
_sessions_lock = threading.Lock()


def safe_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (ValueError, TypeError, cv2.error) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/status')
def status():
    return {'name': 'Road Health', 'model': model_status(), 'storage': 'Media processed in memory or temporary files; video temporary files deleted after analysis.',
            'edge': 'CPU inference supported. Start at 320/640 px and low sample rates on Raspberry Pi 5; displayed FPS is measured on this host, not a Pi benchmark.'}


@router.get('/demo')
def demo():
    segments = []
    for i in range(12):
        ds = survey_defects(i+1)
        # Deliberately missing sensor readings in demo: no synthetic reading masquerades as measured IMU.
        request = AssessmentRequest(defects=ds)
        segments.append({'id': f'RH-{i+1:03}', 'name': ['University Road', 'Civil Lines', 'Station Link'][i//4] + f' · {i%4+1:02}',
                         'latitude': 18.519 + i*.0011, 'longitude': 73.842 + i*.0014 + (i%3)*.0004,
                         'distance_start_m': i*250, 'length_m': 250, 'width_m': 7,
                         'assessment': request.model_dump(), 'result': assess(**{**request.model_dump(), 'defects': ds, 'inclination': request.inclination, 'config': request.config}),
                         'provenance': 'demo', 'seed': i+1})
    return {'segments': segments, 'notice': 'Synthetic demonstration survey near Pune. Coordinates, images, annotations and route distance are illustrative; not an inspected government asset.'}


@router.get('/demo/image/{seed}')
def demo_photo(seed: int, survey: bool = False):
    from fastapi.responses import Response
    ok, encoded = cv2.imencode('.jpg', demo_image(seed % 10000, survey_defects(seed % 10000) if survey else None))
    return Response(encoded.tobytes(), media_type='image/jpeg')


@router.post('/assess')
def assessment(req: AssessmentRequest):
    return safe_call(assess, **{**req.model_dump(), 'defects': req.defects, 'inclination': req.inclination, 'config': req.config})


@router.post('/inclination')
def inclination(req: Inclination):
    return safe_call(inclination_result, req)


@router.post('/optimize')
def optimization(req: OptimizeRequest):
    return safe_call(optimize, req)


@router.post('/evaluate')
def evaluation(req: EvaluationRequest):
    return safe_call(evaluate, req)


@router.post('/streams')
def create_stream():
    now = time.monotonic()
    with _sessions_lock:
        for key in list(_sessions):
            if now - _sessions[key]['used'] > 900:
                del _sessions[key]
        if len(_sessions) >= 16:
            raise HTTPException(429, 'Close an active camera session first (limit 16).')
        key = secrets.token_urlsafe(20)
        _sessions[key] = {'tracker': Tracker(), 'used': now, 'lock': threading.Lock()}
    return {'session_id': key}


@router.delete('/streams/{key}')
def close_stream(key: str):
    with _sessions_lock:
        _sessions.pop(key, None)
    return {'closed': True}


@router.post('/inspect')
async def inspect_upload(
    image: UploadFile | None = File(None), mode: Literal['demo', 'model'] = Form('demo'),
    confidence: float = Form(.35, ge=0, le=1), resolution: int = Form(640, ge=320, le=1280),
    mm_per_pixel: float | None = Form(None, gt=0, le=1000), inclination_json: str = Form('{}'),
    config_json: str = Form('{}'), seed: int = Form(1, ge=0, le=10000), session_id: str | None = Form(None),
    demo_profile: Literal['full', 'survey'] = Form('full'),
    effect: Literal['none', 'low_light', 'brightness', 'shadow', 'glare', 'blur', 'perspective', 'rain'] = Form('none'),
    strength: float = Form(.5, ge=0, le=1),
):
    if resolution not in (320, 640, 960, 1280):
        raise HTTPException(422, 'Resolution must be 320, 640, 960 or 1280.')
    try:
        inclination = Inclination.model_validate_json(inclination_json)
        config = ScoreConfig.model_validate_json(config_json)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    data = None
    if image:
        try:
            data = await image.read(MAX_BYTES + 1)
        finally:
            await image.close()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, 'Image exceeds 12 MiB.')
    if mode == 'model' and not data:
        raise HTTPException(422, 'Upload an image for model inference.')
    session = None
    if session_id:
        with _sessions_lock:
            session = _sessions.get(session_id)
            if session and time.monotonic() - session['used'] > 900:
                del _sessions[session_id]
                session = None
            if session:
                session['used'] = time.monotonic()
        if not session:
            raise HTTPException(422, 'Stream expired; start a new session.')
    def run():
        fixtures = survey_defects(seed) if demo_profile == 'survey' and mode == 'demo' and not data else None
        source = decode_image(data) if data else demo_image(seed, fixtures)
        kwargs = dict(mode=mode, confidence=confidence, resolution=resolution, mm_per_pixel=mm_per_pixel,
                      inclination=inclination, seed=seed, effect=effect, strength=strength, config=config, fixture_defects=fixtures)
        if session:
            with session['lock']:
                return inspect(source, tracker=session['tracker'], **kwargs)
        return inspect(source, **kwargs)
    return await run_in_threadpool(safe_call, run)


@router.post('/video')
async def video_upload(
    video: UploadFile = File(...), mode: Literal['demo', 'model'] = Form('demo'),
    confidence: float = Form(.35, ge=0, le=1), resolution: int = Form(640, ge=320, le=1280),
    sample_every: int = Form(10, ge=1, le=300), max_frames: int = Form(24, ge=1, le=48), config_json: str = Form('{}'),
    mm_per_pixel: float | None = Form(None, gt=0, le=1000), inclination_json: str = Form('{}'),
):
    if resolution not in (320, 640, 960, 1280):
        raise HTTPException(422, 'Resolution must be 320, 640, 960 or 1280.')
    try:
        config = ScoreConfig.model_validate_json(config_json)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        inclination = Inclination.model_validate_json(inclination_json)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.video', delete=False) as tmp:
            path = Path(tmp.name)
            size = 0
            while chunk := await video.read(1024*1024):
                size += len(chunk)
                if size > 100*1024*1024:
                    raise HTTPException(413, 'Video limit is 100 MiB.')
                tmp.write(chunk)
        def run():
            cap = cv2.VideoCapture(str(path))
            try:
                if not cap.isOpened():
                    raise ValueError('Cannot decode video. Try an MP4/H.264 or WebM supported by your OpenCV installation.')
                fps = float(cap.get(cv2.CAP_PROP_FPS))
                tracker = Tracker()
                frames = []
                start = time.perf_counter()
                for frame_index in range(max_frames * sample_every):
                    ok = cap.grab()
                    if not ok:
                        break
                    if frame_index % sample_every:
                        continue
                    ok, frame = cap.retrieve()
                    if not ok:
                        continue
                    if frame.shape[0]*frame.shape[1] > 20_000_000:
                        raise ValueError('Video frames exceed 20 MP.')
                    result = inspect(frame, mode, confidence, resolution, mm_per_pixel=mm_per_pixel, inclination=inclination, tracker=tracker, config=config)
                    frames.append({'frame_index': frame_index, 'timestamp_s': round(frame_index/fps, 3) if fps > 0 else None, **result})
                if not frames:
                    raise ValueError('No readable frames in video.')
                return {'frames': frames, 'unique_tracks': len(tracker.seen), 'sample_every': sample_every,
                        'sample_limit': max_frames, 'source_fps': fps if fps > 0 else None, 'processing_s': round(time.perf_counter()-start, 2),
                        'provenance': mode, 'notice': 'Bounded sample, not the complete video. Class-aware IoU tracking can split tracks during camera motion or long gaps; count is an estimate. Demo tracks are fixed fixtures.'}
            finally:
                cap.release()
        return await run_in_threadpool(safe_call, run)
    finally:
        await video.close()
        if path:
            path.unlink(missing_ok=True)


class MaterialSample(SafeModel):
    sample_id: str = Field(min_length=1, max_length=120)
    dry_mass_g: float = Field(gt=0, le=1000000)
    loose_mass_g: float = Field(ge=0, le=1000000)
    recovered_metal_g: float = Field(ge=0, le=1000000)
    oversized_mass_g: float = Field(ge=0, le=1000000)
    sieve_mm: float = Field(default=10, gt=0, le=1000)
    method: str = Field(min_length=3, max_length=300)


@router.post('/material')
def material(req: MaterialSample):
    if any(v > req.dry_mass_g for v in (req.loose_mass_g, req.recovered_metal_g, req.oversized_mass_g)):
        raise HTTPException(422, 'Each recovered fraction must not exceed dry sample mass.')
    return {'sample_id': req.sample_id, 'provenance': 'user_supplied_sample_measurements',
            'loose_fraction_percent': round(req.loose_mass_g/req.dry_mass_g*100, 3),
            'recovered_metal_percent': round(req.recovered_metal_g/req.dry_mass_g*100, 3),
            'retained_above_sieve_percent': round(req.oversized_mass_g/req.dry_mass_g*100, 3),
            'sieve_mm': req.sieve_mm, 'method': req.method, 'validated': False,
            'notice': 'Mass ratios calculated from user-supplied measurements, not image inference. Recovery does not verify elemental composition. Fractions can overlap; they are not summed. Friction, binder adhesion and water resistance require appropriate laboratory/field tests.'}


from app.simulation import ScenarioRequest, DrivingRequest, simulate, drive


@router.post('/simulate')
def simulation(req: ScenarioRequest):
    return safe_call(simulate, req)


@router.post('/simulation/drive')
def driving(req: DrivingRequest):
    return safe_call(drive, req)


from app.storage import SavedSegment, save_segment, list_segments


@router.get('/segments')
def saved_segments():
    return safe_call(list_segments)


@router.put('/segments/{segment_id}')
def persist_segment(segment_id: str, req: SavedSegment):
    if segment_id != req.id:
        raise HTTPException(422, 'URL and body segment identifiers must match.')
    return safe_call(save_segment, req)


from app.twin import build_twin


@router.post('/twin')
def digital_twin(req: AssessmentRequest):
    return safe_call(build_twin, req)
