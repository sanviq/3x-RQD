"""Transparent prototype scoring, repair assumptions and sensor provenance."""
import math
from typing import Literal

import cv2
import numpy as np
from pydantic import BaseModel, Field, ConfigDict, model_validator

CLASSES = ['pothole', 'crack', 'repair_patch', 'ravelling', 'loose_chips', 'metallic_debris', 'uneven_surface', 'other']
GROUPS = {'pothole': 'major', 'crack': 'major', 'ravelling': 'granular',
          'loose_chips': 'roughness', 'uneven_surface': 'roughness',
          'repair_patch': 'other', 'metallic_debris': 'other', 'other': 'other'}


class SafeModel(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')


class Defect(SafeModel):
    id: str = Field(max_length=80)
    class_name: Literal['pothole', 'crack', 'repair_patch', 'ravelling', 'loose_chips', 'metallic_debris', 'uneven_surface', 'other']
    confidence: float = Field(ge=0, le=1)
    detection_code: Literal['D00', 'D10', 'D20', 'D40'] | None = None
    detection_label: str | None = Field(default=None, max_length=80)
    bbox: tuple[float, float, float, float]
    polygon: list[tuple[float, float]] = Field(default_factory=list, max_length=4096)
    severity: float = Field(default=.6, ge=0, le=1)
    track_id: int | None = None
    depth_mm: float | None = Field(default=None, ge=0, le=2000)
    depth_source: Literal['depth_sensor', 'validated_reconstruction'] | None = None

    @model_validator(mode='after')
    def valid_geometry(self):
        if self.detection_code and self.class_name != ('pothole' if self.detection_code == 'D40' else 'crack'):
            raise ValueError('RDD damage code does not match the compatible road-health class.')
        x1, y1, x2, y2 = self.bbox
        if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
            raise ValueError('Boxes use normalized x1,y1,x2,y2 coordinates in [0,1].')
        if self.polygon and (len(self.polygon) < 3 or any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in self.polygon)):
            raise ValueError('A polygon needs at least three normalized points.')
        if (self.depth_mm is None) != (self.depth_source is None):
            raise ValueError('Depth requires a sensor or validated reconstruction source.')
        return self


class ScoreConfig(SafeModel):
    major: float = Field(default=35, ge=0, le=100)
    granular: float = Field(default=30, ge=0, le=100)
    roughness: float = Field(default=25, ge=0, le=100)
    other: float = Field(default=10, ge=0, le=100)
    severity_points: float = Field(default=65, ge=0, le=100)
    density_points: float = Field(default=15, ge=0, le=100)
    area_points: float = Field(default=15, ge=0, le=100)
    inclination_points: float = Field(default=5, ge=0, le=100)
    good_threshold: float = Field(default=75, ge=1, le=100)
    moderate_threshold: float = Field(default=50, ge=0, le=99)

    @model_validator(mode='after')
    def valid_weights(self):
        if self.major + self.granular + self.roughness + self.other <= 0:
            raise ValueError('At least one defect group weight must be positive.')
        if self.severity_points + self.density_points + self.area_points + self.inclination_points <= 0:
            raise ValueError('At least one score component weight must be positive.')
        if self.moderate_threshold >= self.good_threshold:
            raise ValueError('Moderate threshold must be below Good threshold.')
        return self


class Inclination(SafeModel):
    source: Literal['unavailable', 'imu', 'elevation', 'camera_geometry'] = 'unavailable'
    pitch: float | None = Field(default=None, ge=-90, le=90)
    roll: float | None = Field(default=None, ge=-90, le=90)
    elevation_start_m: float | None = None
    elevation_end_m: float | None = None
    horizontal_distance_m: float | None = Field(default=None, gt=0, le=100000)
    # Calibrated camera-to-world rotation is required to turn a plane normal into road inclination.
    camera_matrix: list[list[float]] | None = None
    camera_to_world: list[list[float]] | None = None
    image_points: list[tuple[float, float]] | None = Field(default=None, max_length=50)
    world_points: list[tuple[float, float, float]] | None = Field(default=None, max_length=50)


def inclination_result(reading: Inclination):
    r = reading
    if r.source == 'imu':
        if r.pitch is None:
            raise ValueError('IMU source requires pitch; supply a calibrated, road-aligned sensor reading.')
        return {'pitch': r.pitch, 'roll': r.roll, 'source': 'imu', 'label': 'Measured input · user-supplied road-aligned IMU', 'approximate': False}
    if r.source == 'elevation':
        if any(v is None for v in (r.elevation_start_m, r.elevation_end_m, r.horizontal_distance_m)):
            raise ValueError('Elevation estimate needs start/end elevations and horizontal distance.')
        pitch = math.degrees(math.atan2(r.elevation_end_m - r.elevation_start_m, r.horizontal_distance_m))
        return {'pitch': round(pitch, 3), 'roll': None, 'source': 'elevation', 'label': 'Approximate · elevation-derived segment grade', 'approximate': True}
    if r.source == 'camera_geometry':
        if not all((r.camera_matrix, r.camera_to_world, r.image_points, r.world_points)):
            raise ValueError('Camera geometry requires intrinsics, camera-to-world rotation and matched road-plane coordinates.')
        k = np.asarray(r.camera_matrix, dtype=np.float64)
        rotation = np.asarray(r.camera_to_world, dtype=np.float64)
        obj = np.asarray(r.world_points, dtype=np.float64)
        img = np.asarray(r.image_points, dtype=np.float64)
        if k.shape != (3, 3) or rotation.shape != (3, 3) or len(obj) != len(img) or len(obj) < 4:
            raise ValueError('Provide 3×3 matrices and at least four matching points.')
        if not np.allclose(rotation.T @ rotation, np.eye(3), atol=.01) or not np.isclose(np.linalg.det(rotation), 1, atol=.01):
            raise ValueError('camera_to_world must be a valid rotation matrix.')
        if k[0, 0] <= 0 or k[1, 1] <= 0 or not np.allclose(k[2], [0, 0, 1]):
            raise ValueError('Invalid camera intrinsics.')
        if not np.allclose(obj[:, 2], 0) or np.linalg.matrix_rank(obj[:, :2] - obj[:, :2].mean(0)) < 2:
            raise ValueError('Reference points must span a plane with local Z=0.')
        ok, rv, tv = cv2.solvePnP(obj, img, k, None, flags=cv2.SOLVEPNP_ITERATIVE)
        if not ok:
            raise ValueError('Camera pose could not be solved.')
        rot, _ = cv2.Rodrigues(rv)
        normal = rotation @ rot[:, 2]
        if normal[2] < 0:
            normal = -normal
        projected, _ = cv2.projectPoints(obj, rv, tv, k, None)
        error = float(np.sqrt(np.mean((projected.reshape(-1, 2) - img) ** 2)))
        return {'pitch': round(math.degrees(math.atan2(-normal[0], normal[2])), 3),
                'roll': round(math.degrees(math.atan2(normal[1], normal[2])), 3),
                'source': 'camera_geometry', 'label': 'Estimated · calibrated road-plane reconstruction',
                'approximate': True, 'reprojection_rmse_px': round(error, 2)}
    return {'pitch': None, 'roll': None, 'source': 'unavailable', 'label': 'Not measured', 'approximate': True}


def mask_for(defect: Defect, side=512):
    mask = np.zeros((side, side), dtype=np.uint8)
    if defect.polygon:
        pts = np.clip(np.array(defect.polygon) * (side - 1), 0, side - 1).astype(np.int32)
        cv2.fillPoly(mask, [pts], 1)
    else:
        x1, y1, x2, y2 = [round(v * side) for v in defect.bbox]
        mask[y1:y2, x1:x2] = 1
    return mask


def assess(defects: list[Defect], width=960, height=640, mm_per_pixel=None,
           inclination=None, config=None, repaired=None):
    config = config or ScoreConfig()
    inc = inclination_result(inclination or Inclination())
    repaired = set(repaired or [])
    active = [d for d in defects if d.id not in repaired]
    union = np.zeros((512, 512), np.uint8)
    loads = {g: 0.0 for g in ('major', 'granular', 'roughness', 'other')}
    distribution = np.zeros((4, 4), dtype=int)
    details = []
    for d in active:
        mask = mask_for(d)
        area = float(mask.mean())
        union |= mask
        loads[GROUPS[d.class_name]] += d.severity * (0.12 + area / .08)
        x1, y1, x2, y2 = d.bbox
        distribution[min(3, int((y1+y2)*2)), min(3, int((x1+x2)*2))] += 1
        details.append({**d.model_dump(), 'area_fraction': round(area, 6),
                        'area_m2': round(area * width * height * mm_per_pixel ** 2 / 1e6, 5) if mm_per_pixel else None,
                        'width_mm': round((x2-x1) * width * mm_per_pixel, 1) if mm_per_pixel else None,
                        'height_mm': round((y2-y1) * height * mm_per_pixel, 1) if mm_per_pixel else None,
                        'area_method': 'segmentation_polygon' if d.polygon else 'bounding_box_estimate'})
    density = len(active) / (width * height / 1e6)
    weight_sum = sum(getattr(config, g) for g in loads)
    group_load = sum(getattr(config, g)/weight_sum * min(1, load) for g, load in loads.items())
    total_points = config.severity_points + config.density_points + config.area_points + config.inclination_points
    factors = {'severity': group_load, 'density': min(1, density / 20),
               'damaged_area': min(1, float(union.mean()) / .25),
               'inclination': min(1, max(abs(inc['pitch'] or 0), abs(inc['roll'] or 0)) / 15)}
    penalties = {name: round(100 * points / total_points * factors[name], 3) for name, points in (
        ('severity', config.severity_points), ('density', config.density_points),
        ('damaged_area', config.area_points), ('inclination', config.inclination_points))}
    value = round(max(0, 100 - sum(penalties.values())), 2)
    confidence = round(float(np.mean([d.confidence for d in active])), 3) if active else None
    area_m2 = width * height * mm_per_pixel ** 2 / 1e6 if mm_per_pixel else None
    return {'score': value, 'band': 'Good' if value >= config.good_threshold else 'Moderate' if value >= config.moderate_threshold else 'Bad',
            'penalties': penalties, 'group_loads': {k: round(v, 4) for k, v in loads.items()},
            'defect_count': len(active), 'defects': details, 'density_per_megapixel': round(density, 2),
            'density_per_100m2': round(len(active) / area_m2 * 100, 2) if area_m2 else None,
            'damaged_area_percent': round(float(union.mean()) * 100, 2), 'distribution_grid': distribution.tolist(),
            'average_confidence': confidence, 'inclination': inc, 'validated': False,
            'scoring_method': 'configurable_prototype_v1', 'configuration': config.model_dump(),
            'explanation': 'Weighted severity grows with defect area; count density and union area add penalties. Inclination is an optional policy penalty, not evidence of poor engineering. Missing inclination adds zero penalty; assessment is incomplete.',
            'limitations': ['Image-space density and coverage refer to the entire frame; use a rectified road-only crop.',
                           'Box-only damaged area overestimates irregular defects.',
                           'Policy weights, thresholds and severity estimates require engineering validation.']}


class AssessmentRequest(SafeModel):
    defects: list[Defect] = Field(max_length=500)
    width: int = Field(default=960, ge=64, le=20000)
    height: int = Field(default=640, ge=64, le=20000)
    mm_per_pixel: float | None = Field(default=None, gt=0, le=1000)
    inclination: Inclination = Field(default_factory=Inclination)
    config: ScoreConfig = Field(default_factory=ScoreConfig)
    repaired: list[str] = Field(default_factory=list, max_length=500)


class Segment(SafeModel):
    id: str = Field(max_length=80)
    name: str = Field(max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    distance_start_m: float = Field(ge=0, le=10000000)
    length_m: float = Field(gt=0, le=1000000)
    width_m: float = Field(default=7, gt=0, le=100)
    assessment: AssessmentRequest
    provenance: Literal['demo', 'model', 'manual'] = 'manual'


class OptimizeRequest(SafeModel):
    segments: list[Segment] = Field(min_length=1, max_length=200)
    budget: float = Field(ge=0, le=1e12)
    unit_cost_per_m2: float = Field(default=1800, gt=0, le=1e7)
    mobilization_cost: float = Field(default=5000, ge=0, le=1e8)
    minimum_treatment_fraction: float = Field(default=.01, gt=0, le=1)


def withhold_insufficient_model_score(result):
    """Detection validation does not validate the engineering condition formula."""
    insufficient=result['defect_count'] == 0 or (result['average_confidence'] or 0) < .6
    result['candidate_score'] = result['score']
    result['score'] = None
    result['band'] = 'Unassessable'
    result['evidence_status'] = 'insufficient' if insufficient else 'detections_available'
    result['explanation'] = ('Insufficient model evidence; repeat capture and review. No detected damage does not establish a healthy road. ' if insufficient else 'Model detections require review. The road-health scoring formula is unvalidated, so its candidate index is not a condition grade. ') + result['explanation']
    return result


def optimize(req: OptimizeRequest):
    items = []
    excluded = []
    for s in req.segments:
        args = s.assessment.model_dump()
        args['defects'] = s.assessment.defects
        args['inclination'] = s.assessment.inclination
        args['config'] = s.assessment.config
        before = assess(**args)
        if s.provenance == 'model' and withhold_insufficient_model_score(before)['score'] is None:
            excluded.append({'id': s.id, 'reason': 'Model observations do not validate road-health scores or repair benefits. Review and supply explicit scenario assumptions before estimating benefit.'})
            continue
        args['repaired'] = [d.id for d in s.assessment.defects]
        after = assess(**args)
        # Image coverage is used as an explicit, unvalidated extrapolation to full segment area.
        cost = round(req.mobilization_cost + s.length_m * s.width_m * max(req.minimum_treatment_fraction, before['damaged_area_percent']/100) * req.unit_cost_per_m2)
        gain = round(after['score'] - before['score'], 2)
        items.append({'id': s.id, 'name': s.name, 'cost': cost, 'before': before['score'], 'after': after['score'],
                      'gain': gain, 'benefit_per_1000': round(gain*s.length_m/cost*1000, 4), 'selected': False})
    items.sort(key=lambda x: x['benefit_per_1000'], reverse=True)
    remaining = req.budget
    for item in items:
        if item['gain'] > 0 and item['cost'] <= remaining:
            item['selected'] = True
            remaining -= item['cost']
    return {'recommendations': items, 'excluded_segments': excluded, 'spent': req.budget-remaining, 'remaining': remaining,
            'method': 'greedy score-gain × segment-length / cost', 'validated': False,
            'assumptions': 'Illustrative INR costs. Image coverage extrapolated to segment area. Full selected treatment removes annotated defects; durability, traffic management, hidden damage and structural work excluded. Not a procurement estimate.'}
