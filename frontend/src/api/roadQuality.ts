import { featureNames } from '../types/api';
import type { AnalysisInput, AnalysisResponse, HealthResponse } from '../types/api';
import { request, ApiError, isRecord, finiteNumber } from './client';

export function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  if (!isRecord(value)) return false;
  const { features, physical_measurements: physical, image, assessment, inclination } = value;
  if (!isRecord(features) || !featureNames.every(key => finiteNumber(features[key]))) return false;
  if (!isRecord(physical) || !['area_sq_ft', 'chip_candidates_per_sq_ft', 'mean_chip_diameter_mm', 'mean_chip_gap_mm_proxy']
    .every(key => physical[key] === null || finiteNumber(physical[key]))) return false;
  if (!isRecord(image) || !['original_width', 'original_height', 'processed_width', 'processed_height']
    .every(key => finiteNumber(image[key]) && (image[key] as number) > 0)) return false;
  if (!isRecord(assessment) || !(assessment.road_quality_index === null ||
    (finiteNumber(assessment.road_quality_index) && assessment.road_quality_index >= 0 && assessment.road_quality_index <= 100))) return false;
  if (!['good', 'fair', 'poor', 'unassessable'].includes(String(assessment.band)) ||
    !['experimental_heuristic', 'trained_random_forest', 'insufficient_visual_detail'].includes(String(assessment.method)) ||
    typeof assessment.scale !== 'string' || typeof assessment.validated !== 'boolean' || typeof assessment.interpretation !== 'string') return false;
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
  if (input.mmPerPixel !== undefined) body.append('mm_per_pixel', String(input.mmPerPixel));
  if (input.pitchDegrees !== undefined) body.append('pitch_degrees', String(input.pitchDegrees));
  body.append('include_overlay', String(input.includeOverlay));
  const value = await request('/analyze', { method: 'POST', body, signal });
  if (!isAnalysisResponse(value)) throw new ApiError('The service returned an incomplete or incompatible analysis result. Check the backend version.');
  return value;
}
