/** Additive detection-service client. The existing granular surface API stays intact. */
import { request, ApiError, isRecord, finiteNumber } from './client';
export interface Defect {
  id:string; class_name:string; confidence:number; bbox:[number,number,number,number]; polygon:[number,number][];
  detection_code?:'D00'|'D10'|'D20'|'D40'|null; detection_label?:string|null;
  severity:number; track_id:number|null; depth_mm:number|null; depth_source:'depth_sensor'|'validated_reconstruction'|null;
  area_fraction?:number; area_m2?:number|null; width_mm?:number|null; height_mm?:number|null; area_method?:string;
}
export interface DefectAssessment {
  score:number|null; candidate_score?:number; band:string; penalties:Record<string,number>;
  defects:Defect[]; defect_count:number; density_per_megapixel:number; density_per_100m2:number|null;
  damaged_area_percent:number; distribution_grid:number[][]; average_confidence:number|null;
  inclination:{pitch:number|null;roll:number|null;source:string;label:string;approximate:boolean};
  configuration:Record<string,number>; explanation:string; limitations:string[]; validated:false;
}
export interface DetectionResult {
  provenance:'demo'|'model'; notice:string; assessment:DefectAssessment;
  quality:{flags:string[];repeat_capture:boolean;laplacian_variance:number;overexposed_fraction:number;dark_fraction:number};
  images:{original:string;detections:string;segmentation:string;heatmap:string;previews:Record<string,string>};
  width:number;height:number;processed_width:number;processed_height:number;
  timing:{inference_ms:number;pipeline_ms:number;pipeline_fps:number;includes:string};
  unique_tracks:number; assessment_confidence:number|null; repeat_capture:boolean;
  frame_index?:number;timestamp_s?:number|null;effect:string;synthetic_stress_test:boolean;
}
export interface AssessmentInput {
  defects:Defect[];width:number;height:number;mm_per_pixel:number|null;
  inclination:Record<string,unknown>;config:Record<string,number>;repaired:string[];
}
export interface DetectionSettings {mode:'demo'|'model';confidence:number;resolution:number;scale?:string;pitch?:string;roll?:string;inclination?:Record<string,unknown>}
export interface DetectorStatus {model:{configured:boolean;loaded:boolean;mode:string;requires:string;supported_classes:string[]};edge:string;storage:string}
export interface VideoReport {frames:DetectionResult[];unique_tracks:number;source_fps:number|null;processing_s:number;sample_every:number;sample_limit:number;notice:string;provenance:string}
export interface SavedRoad {id:string;name:string;latitude:number;longitude:number;distance_start_m:number;length_m:number;width_m:number;assessment:AssessmentInput;provenance:'demo'|'model'|'manual';evidence:Partial<DetectionResult['images']>;capture_notes:string;result:DefectAssessment}
export interface SavedSurvey {segments:SavedRoad[];summary:{distance_m:number;segment_count:number;average_quality:number|null;defects:number;bad_segments:number;low_confidence_segments:string[]};notice:string}
export interface BackendEvaluation {
  precision:number;recall:number;f1:number;map50:number|null;map50_95:number|null;images:number;labels:string[];confusion_matrix:number[][];
  classes:{name:string;ground_truth:number;precision:number;recall:number;f1:number;ap50:number|null;pr_curve:{precision:number;recall:number}[]}[];
  notice:string;method:string;
}
function validateResult(value:unknown):DetectionResult {
  if(!isRecord(value)||!isRecord(value.assessment)||!isRecord(value.images)||!isRecord(value.timing)||
    !Array.isArray(value.assessment.defects)||!Array.isArray(value.quality&&isRecord(value.quality)?value.quality.flags:null)||
    !['demo','model'].includes(String(value.provenance))||!finiteNumber(value.width)||!finiteNumber(value.height)||
    !(value.assessment.score===null||finiteNumber(value.assessment.score)))throw new ApiError('The detector returned an incompatible response.');
  for(const key of ['original','detections','segmentation','heatmap'])if(typeof value.images[key]!=='string')throw new ApiError('Detector evidence is incomplete.');
  return value as unknown as DetectionResult;
}
export async function detectorStatus(signal?:AbortSignal){return await request('/status',{signal}) as DetectorStatus}
export function detectionForm(settings:DetectionSettings,image?:Blob){
  const body=new FormData();if(image)body.append('image',image);
  body.append('mode',settings.mode);body.append('confidence',String(settings.confidence));body.append('resolution',String(settings.resolution));
  if(settings.scale?.trim())body.append('mm_per_pixel',settings.scale);
  if(settings.inclination)body.append('inclination_json',JSON.stringify(settings.inclination));
  else if(settings.pitch?.trim())body.append('inclination_json',JSON.stringify({source:'imu',pitch:Number(settings.pitch),roll:settings.roll?.trim()?Number(settings.roll):null}));
  return body;
}
export async function inspectDefects(body:FormData,signal?:AbortSignal){return validateResult(await request('/inspect',{method:'POST',body,signal}))}
export async function analyzeVideo(file:File,settings:DetectionSettings,sampleEvery:number,maxFrames:number,signal?:AbortSignal){
  const body=detectionForm(settings);body.append('video',file);body.append('sample_every',String(sampleEvery));body.append('max_frames',String(maxFrames));
  const value=await request('/video',{method:'POST',body,signal},300_000);
  if(!isRecord(value)||!Array.isArray(value.frames)||!value.frames.length)throw new ApiError('The video returned no readable frames.');
  value.frames.forEach(validateResult);return value as unknown as VideoReport;
}
export async function startTracking(){return await request('/streams',{method:'POST'}) as {session_id:string}}
export async function stopTracking(id:string){return request('/streams/'+encodeURIComponent(id),{method:'DELETE'})}
export function baselineFor(result:DetectionResult,scale='',pitch='',roll='',inclination?:Record<string,unknown>):AssessmentInput {
  const defects=result.assessment.defects.map(d=>({id:d.id,class_name:d.class_name,confidence:d.confidence,bbox:d.bbox,polygon:d.polygon,
    detection_code:d.detection_code??null,detection_label:d.detection_label??null,
    severity:d.severity,track_id:d.track_id,depth_mm:d.depth_mm,depth_source:d.depth_source}));
  return {defects,width:result.width,height:result.height,mm_per_pixel:scale.trim()?Number(scale):null,
    inclination:inclination??(pitch.trim()?{source:'imu',pitch:Number(pitch),roll:roll.trim()?Number(roll):null}:{source:'unavailable'}),config:result.assessment.configuration,repaired:[]};
}
export async function calculateScenario(body:unknown,signal?:AbortSignal){return await request('/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}) as {before:DefectAssessment;after:DefectAssessment;gain:number;assumptions:string;repaired_ids:string[]}}
export async function runDriving(body:unknown,signal?:AbortSignal){return await request('/simulation/drive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal},300_000) as {before:{score:number;speed_kmh:number;remaining_defects:number;vibration_rms_proxy:number;frames:DetectionResult[]};after:{score:number;speed_kmh:number;remaining_defects:number;vibration_rms_proxy:number;frames:DetectionResult[]};notice:string}}
export async function saveRoad(record:Omit<SavedRoad,'result'>){return request('/segments/'+encodeURIComponent(record.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)})}
export async function loadRoads(signal?:AbortSignal){return await request('/segments',{signal}) as SavedSurvey}
export async function evaluatePredictions(body:unknown,signal?:AbortSignal){return await request('/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}) as BackendEvaluation}
