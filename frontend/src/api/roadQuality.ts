import {isRoadRegion} from './roadRegion';
import { isDefectDetection } from './defects';
import { featureNames } from '../types/api';
import type { AnalysisInput, AnalysisResponse, HealthResponse } from '../types/api';
import { request, ApiError, isRecord, finiteNumber } from './client';

export function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  if (!isRecord(value)) return false;
  if(value.road_region!==undefined&&!isRoadRegion(value.road_region))return false;
  if(value.surface_measurements!==undefined){
    const m=value.surface_measurements;
    if(!isRecord(m)||!['native_road_area','candidate_density','equivalent_diameter','inter_chip_gap'].every(k=>{const v=m[k];return isRecord(v)&&(v.value===null||finiteNumber(v.value)&&v.value>=0)&&typeof v.unit==='string'&&['estimated','limited','unavailable'].includes(String(v.status))&&(v.reason===null||typeof v.reason==='string')&&(v.value!==null||v.status==='unavailable')}))return false;
  }
  if(value.surface_quality!==undefined){
    const q=value.surface_quality;
    if(!isRecord(q)||!['measured','limited'].includes(String(q.status))||!Array.isArray(q.issues)||!q.issues.every(i=>isRecord(i)&&typeof i.code==='string'&&typeof i.message==='string'&&typeof i.guidance==='string'&&Array.isArray(i.affects)&&i.affects.every(v=>typeof v==='string'))||typeof q.method!=='string')return false;
  }
  if(value.calibration!==undefined){
    const c=value.calibration;
    if(!isRecord(c)||c.validated!==false||typeof c.source!=='string'||typeof c.notice!=='string'||!isRecord(c.bounds)||
      !(c.mm_per_original_pixel===null||(finiteNumber(c.mm_per_original_pixel)&&c.mm_per_original_pixel>0))||
      !(c.scale_uncertainty_percent===null||(finiteNumber(c.scale_uncertainty_percent)&&c.scale_uncertainty_percent>=0&&c.scale_uncertainty_percent<100)))return false;
    if(!Object.values(c.bounds).every(b=>b===null||(isRecord(b)&&finiteNumber(b.lower)&&finiteNumber(b.upper)&&b.lower>=0&&b.upper>=b.lower)))return false;
  }
  if(value.defect_detection!==undefined&&!isDefectDetection(value.defect_detection))return false;
  if(value.analysis_region!==undefined){
    const r=value.analysis_region;
    if(!isRecord(r)||!Number.isInteger(r.processed_pixel_count)||Number(r.processed_pixel_count)<=0||!finiteNumber(r.image_fraction)||r.image_fraction<=0||r.image_fraction>1||!['selected_road','full_image'].includes(String(r.scope)))return false;
    if(r.road_quad!==null&&(!Array.isArray(r.road_quad)||r.road_quad.length!==4||!r.road_quad.every(p=>isRecord(p)&&finiteNumber(p.x)&&finiteNumber(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)))return false;
  }
  const { features, physical_measurements: physical, image, assessment, inclination } = value;
  if (!isRecord(features) || !featureNames.every(key => finiteNumber(features[key]))) return false;
  if (!isRecord(physical) || !['area_sq_ft', 'chip_candidates_per_sq_ft', 'mean_chip_diameter_mm', 'mean_chip_gap_mm_proxy']
    .every(key => physical[key] === null || finiteNumber(physical[key]))) return false;
  if (!isRecord(image) || !['original_width', 'original_height', 'processed_width', 'processed_height']
    .every(key => finiteNumber(image[key]) && (image[key] as number) > 0)) return false;
  if (!isRecord(assessment) || !(assessment.road_quality_index === null ||
    (finiteNumber(assessment.road_quality_index) && assessment.road_quality_index >= 0 && assessment.road_quality_index <= 100))) return false;
  if (!['good', 'fair', 'poor', 'unassessable'].includes(String(assessment.band)) ||
    !['experimental_heuristic', 'trained_random_forest', 'insufficient_visual_detail', 'unsuitable_capture', 'no_trained_model', 'invalid_model_output'].includes(String(assessment.method)) ||
    typeof assessment.scale !== 'string' || typeof assessment.validated !== 'boolean' || typeof assessment.interpretation !== 'string') return false;
  if (value.capture_type !== undefined && !['road_scene', 'surface_crop'].includes(String(value.capture_type))) return false;
  if (assessment.visual_proxy_index !== undefined && assessment.visual_proxy_index !== null &&
    !(finiteNumber(assessment.visual_proxy_index) && assessment.visual_proxy_index >= 0 && assessment.visual_proxy_index <= 100)) return false;
  if (assessment.reasons !== undefined && !(Array.isArray(assessment.reasons) && assessment.reasons.every(x => typeof x === 'string'))) return false;
  if (!isRecord(inclination) || !(inclination.degrees === null || finiteNumber(inclination.degrees)) ||
    !['user_supplied_sensor', 'unavailable'].includes(String(inclination.source))) return false;
  return Number.isInteger(value.chip_candidate_count) && Number(value.chip_candidate_count) >= 0 &&
    Array.isArray(value.warnings) && value.warnings.every(x => typeof x === 'string') &&
    typeof value.feature_version === 'string' &&
    (value.overlay_png_base64 === undefined || typeof value.overlay_png_base64 === 'string');
}
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const value = await request('/health', { signal }, 8000);
  if (!isRecord(value) || typeof value.status !== 'string' || typeof value.model_loaded !== 'boolean' || typeof value.feature_version !== 'string') {
    throw new ApiError('The service returned an unexpected health response.');
  }
  if (value.status !== 'ok') throw new ApiError('The analysis service is reachable but is not ready.');
  return { status: value.status, model_loaded: value.model_loaded, feature_version: value.feature_version };
}
export async function analyzeRoad(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisResponse> {
  const body = new FormData();
  body.append('image', input.image);
  body.append('capture_type', input.captureType ?? 'road_scene');
  if(input.roadQuad)body.append('road_quad',JSON.stringify(input.roadQuad));
  if (input.mmPerPixel !== undefined) body.append('mm_per_pixel', String(input.mmPerPixel));
  if(input.scaleUncertaintyPercent!==undefined)body.append('scale_uncertainty_percent',String(input.scaleUncertaintyPercent));
  if (input.pitchDegrees !== undefined) body.append('pitch_degrees', String(input.pitchDegrees));
  body.append('include_overlay', String(input.includeOverlay));
  const value = await request('/analyze', { method: 'POST', body, signal });
  if (!isAnalysisResponse(value)) throw new ApiError('The service returned an incomplete or incompatible analysis result. Check the backend version.');
  value.capture_type ??= input.captureType ?? 'road_scene';
  // Never present an unvalidated proxy from an older server as a health grade.
  if (!value.assessment.validated && value.assessment.road_quality_index !== null) {
    value.reported_assessment = { ...value.assessment };
    value.warnings = [...value.warnings, 'The server reported an unvalidated condition grade. Its original assessment is retained in reported_assessment; the grade is withheld from the interface.'];
    value.assessment = { ...value.assessment, visual_proxy_index: value.assessment.road_quality_index,
      road_quality_index: null, band: 'unassessable',
      interpretation: 'Unvalidated diagnostic index only. No supported road-health verdict or confidence is available.' };
  }
  return value;
}
