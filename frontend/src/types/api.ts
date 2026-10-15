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
export interface AnalysisResponse {
  features: Record<FeatureName, number>;
  physical_measurements: {
    area_sq_ft: number | null;
    chip_candidates_per_sq_ft: number | null;
    mean_chip_diameter_mm: number | null;
    mean_chip_gap_mm_proxy: number | null;
  };
  chip_candidate_count: number;
  warnings: string[];
  image: { original_width: number; original_height: number; processed_width: number; processed_height: number };
  assessment: {
    road_quality_index: number | null; scale: string;
    band: 'good' | 'fair' | 'poor' | 'unassessable';
    method: 'experimental_heuristic' | 'trained_random_forest' | 'insufficient_visual_detail';
    validated: boolean; interpretation: string;
  };
  feature_version: string;
  inclination: { degrees: number | null; source: 'user_supplied_sensor' | 'unavailable' };
  overlay_png_base64?: string;
}
export interface AnalysisInput { image: File; mmPerPixel?: number; pitchDegrees?: number; includeOverlay: boolean }
export type Page = 'overview' | 'inspection' | 'network' | 'planner' | 'lab' | 'evaluation' | 'materials';
export type Weights = [number, number, number, number];
