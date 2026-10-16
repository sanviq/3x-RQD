"""Explicit, reproducible condition scenarios and a schematic driving experiment."""
import math
import cv2
import numpy as np
from pydantic import Field, model_validator
from app.assessment import AssessmentRequest, Defect, SafeModel, assess
from app.detection import Tracker, demo_image, inspect

class DefectEdit(SafeModel):
    id: str = Field(min_length=1, max_length=80)
    severity: float | None = Field(default=None, ge=0, le=1)
    size_multiplier: float = Field(default=1, gt=0, le=5)

class ScenarioRequest(SafeModel):
    baseline: AssessmentRequest
    repaired: list[str] = Field(default_factory=list, max_length=500)
    edits: list[DefectEdit] = Field(default_factory=list, max_length=500)
    added: list[Defect] = Field(default_factory=list, max_length=100)
    months: float = Field(default=0, ge=0, le=120)
    monthly_severity_growth: float = Field(default=.02, ge=0, le=1)


def assessment_args(req):
    return {**req.model_dump(), 'defects': req.defects, 'inclination': req.inclination, 'config': req.config}


def simulate(req):
    baseline = req.baseline
    ids = [d.id for d in baseline.defects]
    added_ids = [d.id for d in req.added]
    if len(ids + added_ids) != len(set(ids + added_ids)):
        raise ValueError('Defect identifiers must be unique, including added defects.')
    if len(ids + added_ids) > 500:
        raise ValueError('A scenario supports at most 500 defects.')
    known = set(ids + added_ids)
    if any(key not in known for key in req.repaired + [edit.id for edit in req.edits]):
        raise ValueError('A repair or edit references an unknown defect.')
    if len({edit.id for edit in req.edits}) != len(req.edits):
        raise ValueError('Provide at most one edit per defect.')
    edits = {e.id: e for e in req.edits}
    ds = []
    for original in baseline.defects + req.added:
        d = original.model_copy(deep=True)
        if d.id in edits:
            edit = edits[d.id]
            if edit.severity is not None:
                d.severity = edit.severity
            x1,y1,x2,y2 = d.bbox
            cx,cy = (x1+x2)/2,(y1+y2)/2
            factor = edit.size_multiplier
            d.bbox = tuple(float(np.clip(v,0,1)) for v in (cx+(x1-cx)*factor,cy+(y1-cy)*factor,cx+(x2-cx)*factor,cy+(y2-cy)*factor))
            d.polygon = [(float(np.clip(cx+(x-cx)*factor,0,1)),float(np.clip(cy+(y-cy)*factor,0,1))) for x,y in d.polygon]
        d.severity = min(1,d.severity*(1+req.months*req.monthly_severity_growth))
        ds.append(d)
    args = assessment_args(baseline)
    before = assess(**args)
    repairs = sorted(set(baseline.repaired + req.repaired))
    after = assess(**{**args,'defects':ds,'repaired':repairs})
    return {'provenance':'simulation', 'validated':False, 'before':before, 'after':after,
            'gain':round(after['score']-before['score'],2), 'repaired_ids':repairs,
            'scenario_defects':[d.model_dump() for d in ds], 'months':req.months,
            'assumptions':f'User-defined scenario. Severity grows by {req.monthly_severity_growth:.1%} of baseline per illustrative month, capped at 1. Size scales about the defect center; geometry is clipped to the frame. Only selected repairs remove defects; untreated properties stay unchanged unless explicitly edited or deteriorated. This is not a validated forecast.'}


class DrivingRequest(SafeModel):
    baseline: AssessmentRequest
    repaired: list[str] = Field(default_factory=list, max_length=500)
    speed_kmh: float = Field(default=35, ge=5, le=100)
    lateral_position: float = Field(default=.3, ge=0, le=1)
    frames: int = Field(default=8, ge=2, le=16)
    mode: str = Field(default='demo', pattern='^(demo|model)$')


def drive(req):
    """A deterministic unitless response; no suspension/road-depth physics is claimed."""
    if any(key not in {d.id for d in req.baseline.defects} for key in req.repaired):
        raise ValueError('A selected repair references an unknown defect.')
    baseline = req.baseline
    results = {}
    paths = np.linspace(.98,.02,req.frames)
    for name, repairs in (('before',baseline.repaired),('after',list(set(baseline.repaired+req.repaired)))):
        defects = [d.model_copy(deep=True) for d in baseline.defects if d.id not in repairs]
        tracker = Tracker()
        frames, responses = [], []
        for index, progress in enumerate(paths):
            impact = sum(d.severity for d in defects if d.bbox[0]-.04 <= req.lateral_position <= d.bbox[2]+.04 and d.bbox[1]-.06 <= progress <= d.bbox[3]+.06)
            vibration = impact*(req.speed_kmh/35)**2
            responses.append(vibration)
            image = demo_image(100,defects)
            # Draw a schematic car and its path on the synthetic road-frame fixture.
            x,y = int(req.lateral_position*960),int(progress*640)
            cv2.line(image,(x,640),(x,0),(125,160,140),2)
            cv2.rectangle(image,(x-15,y-26),(x+15,y+26),(60,180,215),-1)
            result = inspect(image, mode=req.mode, resolution=320, tracker=tracker,
                             config=baseline.config, fixture_defects=defects)
            frames.append({'frame_index':index,'distance_fraction':round(index/(req.frames-1),3),
                           'synthetic_vibration':round(vibration,4),**result})
        assessed = assess(**{**assessment_args(baseline),'repaired':repairs})
        results[name] = {'score':assessed['score'],'speed_kmh':req.speed_kmh,'remaining_defects':len(defects),
                         'vibration_rms_proxy':round(math.sqrt(np.mean(np.square(responses))),4),
                         'frames':frames,'unique_track_estimate':len(tracker.seen)}
    return {**results,'path':req.lateral_position,'provenance':'synthetic_driving_experiment','validated':False,
            'notice':'Schematic top-down camera frames are sent through the inspection pipeline. Demo mode uses scenario annotations, not AI detections. The same route, seed, lane and speed are used before and after. Vibration is a dimensionless severity/overlap/speed proxy; it is not measured acceleration, suspension dynamics, IRI, or ride comfort. No depth is assumed to be measured.'}
