import type { Weights, AnalysisResponse } from '../types/api';
export const defaultWeights: Weights = [35, 30, 25, 10];
export const factorNames = ['Potholes & major cracks', 'Ravelling & granular loss', 'Roughness & loose chips', 'Other visible defects'];
export interface Defect {
  id: string; kind: 'Pothole' | 'Crack' | 'Ravelling' | 'Repair patch';
  severity: 'High' | 'Moderate' | 'Low'; confidence: number;
  x: number; y: number; area: number; width: number; height: number;
}
export interface Segment {
  id: string; name: string; locality: string; length: number; distance: number; pitch: number;
  burdens: [number, number, number, number]; cost: number;
  points: string; label: [number, number]; defects: Defect[];
}
export const segments: Segment[] = [
  { id:'RH-001', name:'Outer Ring Road', locality:'Mahadevapura', length:2.4, distance:0, pitch:2.1,
    burdens:[0.8,0.65,0.7,0.4],cost:420000, points:'82,218 178,192 242,208 328,164',label:[174,179],
    defects:[{id:'D-01',kind:'Pothole',severity:'High',confidence:0.94,x:37,y:55,area:1.4,width:1.4,height:1},{id:'D-02',kind:'Crack',severity:'Moderate',confidence:0.87,x:61,y:38,area:0.5,width:2,height:0.25},{id:'D-03',kind:'Ravelling',severity:'High',confidence:0.82,x:74,y:69,area:2.2,width:2,height:1.1}] },
  { id:'RH-002', name:'Old Airport Road', locality:'Domlur', length:1.8, distance:2.4, pitch:1.4,
    burdens:[0.25,0.35,0.3,0.1],cost:160000, points:'328,164 402,190 482,152 560,170',label:[428,172],
    defects:[{id:'D-04',kind:'Crack',severity:'Moderate',confidence:0.89,x:47,y:48,area:0.6,width:2,height:0.3},{id:'D-05',kind:'Repair patch',severity:'Low',confidence:0.91,x:67,y:66,area:0.8,width:1,height:0.8}] },
  { id:'RH-003', name:'Indiranagar 100 Ft Road', locality:'Indiranagar', length:2.1, distance:4.2, pitch:0.8,
    burdens:[0.08,0.12,0.2,0.05],cost:85000, points:'242,208 274,282 358,312 426,288',label:[315,300],
    defects:[{id:'D-06',kind:'Repair patch',severity:'Low',confidence:0.95,x:58,y:52,area:0.3,width:0.6,height:0.5}] },
  { id:'RH-004', name:'Whitefield Main Road', locality:'Whitefield', length:3.2, distance:6.3, pitch:3.6,
    burdens:[0.7,0.85,0.65,0.5],cost:580000, points:'560,170 598,232 568,292 638,334',label:[600,270],
    defects:[{id:'D-07',kind:'Pothole',severity:'High',confidence:0.93,x:43,y:62,area:1.8,width:1.5,height:1.2},{id:'D-08',kind:'Ravelling',severity:'High',confidence:0.84,x:69,y:39,area:2.9,width:2.9,height:1},{id:'D-09',kind:'Crack',severity:'Moderate',confidence:0.79,x:28,y:36,area:0.7,width:2,height:0.35}] },
  { id:'RH-005', name:'HAL Old Township Road', locality:'HAL', length:1.4, distance:9.5, pitch:-0.4,
    burdens:[0.2,0.45,0.4,0.15],cost:140000, points:'426,288 484,324 568,292',label:[481,310],
    defects:[{id:'D-10',kind:'Ravelling',severity:'Moderate',confidence:0.86,x:55,y:50,area:1.1,width:1.1,height:1}] },
  { id:'RH-006', name:'CV Raman Nagar Road', locality:'CV Raman Nagar', length:1.7, distance:10.9, pitch:1.2,
    burdens:[0.1,0.18,0.15,0.1],cost:95000, points:'328,164 344,96 438,78 510,103',label:[413,64],
    defects:[] },
];
export function score(segment: Segment, weights: Weights = defaultWeights, repaired = false, deterioration = 0) {
  const total = weights.reduce((sum, x) => sum + x, 0) || 1;
  const burden = segment.burdens.reduce((sum, x, i) => sum + Math.min(1, x + deterioration) * weights[i], 0) / total;
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - burden * (repaired ? 0.25 : 1)))));
}
export const band = (value: number) => value >= 75 ? 'Good' : value >= 50 ? 'Moderate' : 'Bad';
export const conditionClass = (value: number) => value >= 75 ? 'good' : value >= 50 ? 'fair' : 'poor';
export function summary(weights: Weights = defaultWeights, repaired: string[] = []) {
  const length = segments.reduce((sum, x) => sum + x.length, 0);
  return {
    length,
    average: Math.round(segments.reduce((sum, x) => sum + score(x, weights, repaired.includes(x.id)) * x.length, 0) / length),
    defects: segments.reduce((sum, x) => sum + (repaired.includes(x.id) ? 0 : x.defects.length), 0),
    bad: segments.filter(x => score(x, weights, repaired.includes(x.id)) < 50).length,
  };
}
export function optimize(budget: number, weights: Weights): string[] {
  const ranked = [...segments].sort((a,b) => ((score(b,weights,true)-score(b,weights))*b.length/b.cost)-((score(a,weights,true)-score(a,weights))*a.length/a.cost));
  let spent = 0;
  return ranked.filter(x => { if(spent+x.cost > budget) return false; spent += x.cost; return true; }).map(x=>x.id);
}
export const demoResult: AnalysisResponse = {
  features: {
    chip_count_per_megapixel:426.5,chip_coverage_fraction:0.384,chip_diameter_mean_px:12.4,chip_diameter_cv:0.41,
    chip_circularity_mean:0.68,chip_spacing_mean_px:3.8,packing_uniformity:0.72,boundary_edge_fraction:0.21,
    boundary_contrast:1.24,dark_linear_fraction:0.063,dark_region_fraction:0.12,texture_contrast:0.18,
    texture_homogeneity:0.64,texture_entropy:5.42,brightness_mean:0.48,brightness_std:0.16,laplacian_variance:184.7,
  },
  physical_measurements:{area_sq_ft:null,chip_candidates_per_sq_ft:null,mean_chip_diameter_mm:null,mean_chip_gap_mm_proxy:null},
  chip_candidate_count:286,
  warnings:['Synthetic sample: these values demonstrate the response layout and are not measurements of a real road.','No scale calibration was supplied. Physical measurements are unavailable.','Potential dark linear regions may include shadows, joints, or aggregate boundaries.'],
  image:{original_width:1200,original_height:800,processed_width:1024,processed_height:683},
  assessment:{road_quality_index:64,scale:'0–100',band:'fair',method:'experimental_heuristic',validated:false,
    interpretation:'Illustrative response only. A real assessment is returned by the surface analysis backend after an image is submitted.'},
  feature_version:'surface-v1',inclination:{degrees:null,source:'unavailable'},
};
