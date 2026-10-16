
import {request,isRecord,finiteNumber,ApiError,apiBaseUrl} from './client';
import type {RoadQuad} from '../simulation/projection';
export const weatherConditions={rain:'Rain',puddles:'Puddles',shadow:'Shadow',low_light:'Low light',glare:'Glare',blur:'Blur',perspective:'Perspective'} as const;
export type WeatherCondition=keyof typeof weatherConditions;
export interface WeatherDefect {
 id:string;kind:string;detection_code:string|null;geometry:string;frame_polygon:number[][];reference_polygon:number[][];
 bbox_reference_px:number[];confidence:number;confidence_calibrated:false;severity:number;severity_label:string;pixel_area:number;
 visible_road_percent:number;effect_overlap_fraction:number;uncertainty:string[];uncertain:boolean;physical_dimensions:null;
}
export interface WeatherFrame {
 condition:'original'|WeatherCondition;width:number;height:number;image_path:string;effect_mask_path:string;
 to_condition:number[][];to_reference:number[][];defects:WeatherDefect[];
 summary:{count:number;by_type:Record<string,number|null>;not_assessed:string[];affected_pixel_area:number;visible_road_pixel_area:number;visible_road_affected_percent:number;area_interpretation:string};
 changes:{matched:{original_id:string;condition_id:string;iou:number;pixel_area_change:number;severity_change:number;confidence_change:number}[];missed:string[];added:string[]};
 preprocessing:{enabled:boolean;raw_count:number|null;preprocessing_only:string[];raw_only:string[]};
 quality:{flags:string[];repeat_capture:boolean};engine:string;model_status:{configured:boolean;weather_class_coverage:string[]};
 metrics:{available:boolean;precision:number|null;recall:number|null;f1:number|null;tp?:number;fp?:number;fn?:number;annotation_count?:number;area_matching?:string};
 pipeline_ms:number;
}
export interface WeatherComparison {
 version:'native-weather-v1';metadata:{filename:string;width:number;height:number;raw_width:number;raw_height:number;format:string;sha256:string;source_file_unchanged:true;exif_orientation:number;original_bytes:number;exif_bytes:number;icc_profile_bytes:number};
 frames:WeatherFrame[];ground_truth_supplied:boolean;ground_truth_source?:string|null;intensity:number;evidence_expires_seconds:number;notice:string[];
}
export function evidenceUrl(path:string){return apiBaseUrl+path}
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const count=(v:unknown)=>finiteNumber(v)&&v>=0;
const unit=(v:unknown)=>finiteNumber(v)&&v>=0&&v<=1;
const matrix=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(row=>Array.isArray(row)&&row.length===3&&row.every(finiteNumber));
export function isWeatherComparison(v:unknown):v is WeatherComparison{
 if(!isRecord(v)||v.version!=='native-weather-v1'||!isRecord(v.metadata)||!Array.isArray(v.frames)||!v.frames.length||!strings(v.notice)||typeof v.ground_truth_supplied!=='boolean')return false;
 const m=v.metadata;
 if(!count(m.width)||!count(m.height)||!m.width||!m.height||m.source_file_unchanged!==true||typeof m.sha256!=='string')return false;
 const polygon=(p:unknown)=>Array.isArray(p)&&p.length>=3&&p.every(point=>Array.isArray(point)&&point.length===2&&point.every(finiteNumber)&&point[0]>=0&&point[0]<Number(m.width)&&point[1]>=0&&point[1]<Number(m.height));
 return v.frames.every(f=>{
   if(!isRecord(f)||f.width!==m.width||f.height!==m.height||!(f.condition==='original'||typeof f.condition==='string'&&f.condition in weatherConditions)||typeof f.image_path!=='string'||!/^\/weather-evidence\/[a-zA-Z0-9_-]+\/[a-z_-]+\.png$/.test(f.image_path)||typeof f.effect_mask_path!=='string'||!f.effect_mask_path.startsWith('/weather-evidence/')||!matrix(f.to_condition)||!matrix(f.to_reference)||!Array.isArray(f.defects)||!isRecord(f.summary)||!isRecord(f.changes)||!isRecord(f.metrics)||!isRecord(f.quality)||!strings(f.quality.flags)||!isRecord(f.preprocessing))return false;
   const c=f.changes,s=f.summary,p=f.preprocessing,t=f.metrics;
   return ['trained_yolo','opencv_candidates'].includes(String(f.engine))&&s.count===f.defects.length&&t.available===v.ground_truth_supplied&&(t.available||[t.precision,t.recall,t.f1].every(x=>x===null))&&count(s.count)&&count(s.affected_pixel_area)&&count(s.visible_road_pixel_area)&&count(s.visible_road_affected_percent)&&isRecord(s.by_type)&&strings(s.not_assessed)&&strings(c.missed)&&strings(c.added)&&Array.isArray(c.matched)&&c.matched.every(x=>isRecord(x)&&typeof x.original_id==='string'&&typeof x.condition_id==='string'&&finiteNumber(x.pixel_area_change)&&finiteNumber(x.severity_change)&&finiteNumber(x.confidence_change))&&strings(p.preprocessing_only)&&strings(p.raw_only)&&typeof t.available==='boolean'&&[t.precision,t.recall,t.f1].every(x=>x===null||unit(x))&&f.defects.every(d=>isRecord(d)&&typeof d.id==='string'&&typeof d.kind==='string'&&typeof d.geometry==='string'&&polygon(d.reference_polygon)&&polygon(d.frame_polygon)&&Array.isArray(d.bbox_reference_px)&&d.bbox_reference_px.length===4&&d.bbox_reference_px.every(finiteNumber)&&unit(d.confidence)&&unit(d.severity)&&count(d.pixel_area)&&count(d.visible_road_percent)&&strings(d.uncertainty)&&typeof d.uncertain==='boolean'&&d.physical_dimensions===null&&d.confidence_calibrated===false);
 });
}
export async function compareWeather(file:File,quad:RoadQuad,conditions:WeatherCondition[],intensity:number,preprocessing:boolean,annotations:string|undefined,signal?:AbortSignal){
 const body=new FormData();body.append('image',file);body.append('road_quad',JSON.stringify(quad));body.append('conditions_json',JSON.stringify(conditions));
 body.append('intensity',String(intensity));body.append('preprocessing',String(preprocessing));if(annotations!==undefined)body.append('annotations_json',annotations);
 const value=await request('/weather-compare',{method:'POST',body,signal},600_000);
 if(!isWeatherComparison(value))throw new ApiError('The weather service returned incompatible native-resolution evidence. Restart the updated API.');
 return value;
}
