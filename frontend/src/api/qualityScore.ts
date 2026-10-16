import {request,ApiError,isRecord,finiteNumber} from './client';
export interface RoadQualityScore {
 version:'road-quality-v1';status:'provisional';validated:false;score:number;rating:'Excellent'|'Good'|'Fair'|'Poor'|'Critical';score_is_model_confidence:false;snapshot_id:string;
 score_scope:string;image:{width:number;height:number;sha256:string;source_file_unchanged:true;quality:{flags:string[];repeat_capture:boolean}};
 excluded_ids:string[];config:Record<string,unknown>;config_source:string;config_sha256:string;road_quad:number[][];deduction_points:number;
 components:{id:string;label:string;points:number}[];
 defects:{id:string;kind:string;severity:number;confidence:number;severity_label:string;candidate_pixel_area:number;candidate_road_percent:number;owned_pixel_area:number;type_weight:number;location_multiplier:number;evidence_multiplier:number;weighted_intensity:number;geometry:string;artifact_ambiguous:boolean;deduction_points:number;road_position:{u:number;v:number}}[];
 cells:{id:number;row:number;column:number;road_pixels:number;weighted_load:number;candidate_area_percent:number}[];
 summary:{detected_count:number;included_count:number;excluded_count:number;by_type:Record<string,number|null>;not_assessed_types?:string[];by_severity:Record<string,number>;visible_road_pixel_area:number;affected_pixel_area:number;affected_road_percent:number;weighted_load:number;worst_cell:number;unique_penalized_pixels:number};
 uncertainty:string[];validation:{available:false;n:0;mae:null;pearson_r:null;reason:string};generated_at:string;
}
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const nonnegative=(v:unknown)=>finiteNumber(v)&&v>=0;
const counts=(v:unknown,allowUnknown=false)=>isRecord(v)&&Object.values(v).every(x=>allowUnknown&&x===null||Number.isSafeInteger(x)&&Number(x)>=0);
export function isRoadQualityScore(v:unknown):v is RoadQualityScore {
 if(!isRecord(v)||v.version!=='road-quality-v1'||v.status!=='provisional'||v.validated!==false||v.score_is_model_confidence!==false||!finiteNumber(v.score)||v.score<0||v.score>100||!['Excellent','Good','Fair','Poor','Critical'].includes(String(v.rating))||typeof v.snapshot_id!=='string')return false;
 if(!isRecord(v.image)||!nonnegative(v.image.width)||!nonnegative(v.image.height)||typeof v.image.sha256!=='string'||v.image.source_file_unchanged!==true||!isRecord(v.image.quality)||!strings(v.image.quality.flags)||!strings(v.excluded_ids)||!strings(v.uncertainty)||!isRecord(v.config)||!isRecord(v.validation)||v.validation.available!==false||v.validation.mae!==null||v.validation.pearson_r!==null)return false;
 if(!Array.isArray(v.components)||v.components.length!==3||!v.components.every(c=>isRecord(c)&&typeof c.label==='string'&&nonnegative(c.points)))return false;
 const total=v.components.reduce((sum,c)=>sum+c.points,0);
 if(!finiteNumber(v.deduction_points)||Math.abs(total-v.deduction_points)>.001||Math.abs(v.score-Math.max(0,Math.min(100,100-total)))>.051)return false;
 const s=v.summary;
 if(!isRecord(s)||!counts(s.by_type,true)||!counts(s.by_severity)||!['detected_count','included_count','excluded_count','visible_road_pixel_area','affected_pixel_area','affected_road_percent'].every(k=>nonnegative(s[k]))||Number(s.affected_pixel_area)>Number(s.visible_road_pixel_area)||Number(s.affected_road_percent)>100||Number(s.included_count)+Number(s.excluded_count)!==s.detected_count)return false;
 if(!Array.isArray(v.defects)||v.defects.length!==s.included_count||!Array.isArray(v.cells))return false;
 return v.defects.every(d=>isRecord(d)&&typeof d.id==='string'&&typeof d.kind==='string'&&typeof d.geometry==='string'&&finiteNumber(d.severity)&&d.severity>=0&&d.severity<=1&&finiteNumber(d.confidence)&&d.confidence>=0&&d.confidence<=1&&['candidate_pixel_area','candidate_road_percent','owned_pixel_area','location_multiplier','evidence_multiplier','deduction_points'].every(k=>nonnegative(d[k])));
}
export async function rescoreRoad(scoreToken:string,excludedIds:string[],signal?:AbortSignal){
 const value=await request('/road-quality-score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score_token:scoreToken,excluded_ids:excludedIds}),signal},60000);
 if(!isRoadQualityScore(value)||value.snapshot_id!==scoreToken||[...value.excluded_ids].sort().join('\0')!==[...excludedIds].sort().join('\0'))throw new ApiError('The service returned a score for incompatible detection evidence. Detect again.');
 return value;
}
