import type {RoadQualityScore} from '../api/qualityScore';
export const featureNames = [
  'chip_count_per_megapixel', 'chip_coverage_fraction', 'chip_diameter_mean_px',
  'chip_diameter_cv', 'chip_circularity_mean', 'chip_spacing_mean_px',
  'packing_uniformity', 'boundary_edge_fraction', 'boundary_contrast',
  'dark_linear_fraction', 'dark_region_fraction', 'texture_contrast',
  'texture_homogeneity', 'texture_entropy', 'brightness_mean', 'brightness_std',
  'laplacian_variance',
] as const;
export type FeatureName = typeof featureNames[number];
export interface HealthResponse { status: string; model_loaded: boolean; feature_version: string }
export type CaptureType = 'road_scene' | 'surface_crop';
export interface AnalysisResponse {
  calibration?:{source:string;mm_per_original_pixel:number|null;scale_uncertainty_percent:number|null;validated:false;bounds:Record<string,{lower:number;upper:number}|null>;notice:string};
  analysis_region?:{road_quad:DefectPoint[]|null;processed_pixel_count:number;image_fraction:number;scope:string};
  defect_detection?:DefectDetection;
  capture_type?: CaptureType;
  reported_assessment?: AnalysisResponse['assessment'];
  features: Record<FeatureName, number>;
  physical_measurements: {
    area_sq_ft: number | null;
    chip_candidates_per_sq_ft: number | null;
    mean_chip_diameter_mm: number | null;
    mean_chip_gap_mm_proxy: number | null;
  };
  chip_candidate_count: number;
  large_gap_fraction_proxy?: number | null;
  warnings: string[];
  image: { original_width: number; original_height: number; processed_width: number; processed_height: number };
  assessment: {
    road_quality_index: number | null; scale: string;
    band: 'good' | 'fair' | 'poor' | 'unassessable';
    method: 'experimental_heuristic' | 'trained_random_forest' | 'insufficient_visual_detail' | 'unsuitable_capture' | 'no_trained_model' | 'invalid_model_output';
    validated: boolean; interpretation: string; visual_proxy_index?: number | null; reasons?: string[];
  };
  feature_version: string;
  inclination: { degrees: number | null; source: 'user_supplied_sensor' | 'unavailable' };
  overlay_png_base64?: string;
}
export interface AnalysisInput { image: File; captureType?: CaptureType; roadQuad?:[DefectPoint,DefectPoint,DefectPoint,DefectPoint]; mmPerPixel?: number; scaleUncertaintyPercent?:number; pitchDegrees?: number; includeOverlay: boolean }
export type Page = 'overview' | 'inspection' | 'network' | 'planner' | 'lab' | 'evaluation' | 'materials';
export type Weights = [number, number, number, number];
export interface DefectPoint {x:number;y:number}
export type DetectedKind='Pothole'|'Crack'|'Depression'|'Uneven surface';
export interface RoadDefect {
  id:string;kind:DetectedKind;confidence:number;severity:number;severity_label:'Low'|'Moderate'|'High';
  polygon:DefectPoint[];road_polygon:DefectPoint[];
  bbox:{x:number;y:number;width:number;height:number};
  bbox_normalized:{x:number;y:number;width:number;height:number};
  area_fraction:number;provenance:'opencv_candidate'|'yolo_prediction';depth_mm:null;physical_dimensions:null;
  detection_code?:string;detection_label?:string;geometry_source?:'bounding_box_schematic';
  evidence:{local_contrast?:number;boundary_strength?:number;solidity?:number;detection_code?:string;detection_label?:string};
}
export interface DefectDetection {
  road_quality_score?:RoadQualityScore|null;score_token?:string;score_expires_seconds?:number;score_error?:string;
  version:string;method:'opencv_multiscale_contours'|'yolo_rdd_detection';coordinate_system:'normalized_exif_oriented_original';
  road_quad:[DefectPoint,DefectPoint,DefectPoint,DefectPoint];image:{width:number;height:number};
  defects:RoadDefect[];warnings:string[];confidence_calibrated:false;requires_review:true;
}
