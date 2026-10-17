import {request,ApiError,isRecord,finiteNumber} from './client';
import {isRoadQualityScore} from './qualityScore';
import type {RoadQualityScore} from './qualityScore';
import type {AnalysisController} from '../hooks/useAnalysis';
export type Coordinates=[number,number]; // longitude, latitude
export interface MapInspection {
 score:RoadQualityScore;analyzed_at:string;saved_at:string;latitude:number;longitude:number;source_hash:string;
 source_width:number;source_height:number;evidence_verified:true;review_status:'user_reviewed'|'unreviewed';location_source:string;
 detector_method:string;original_preview:string;outlined_preview:string;scope:string;
}
export interface MappedSegment {id:string;name:string;coordinates:Coordinates[];length_m:number;source:'openstreetmap';osm_way_id:string;highway:string;start_node:string;end_node:string;inspection:MapInspection|null}
export interface NetworkSummary {
 segment_count:number;inspected_segments:number;not_inspected_segments:number;mapped_length_m:number;represented_segment_length_m:number;
 represented_length_percent:number;average_quality:number|null;comparable_configurations:boolean;defect_count:number|null;
 by_type:Record<string,number>;by_severity:Record<string,number>;needs_attention:number;provisional:true;methodology:string;
}
export interface MapNetwork {segments:MappedSegment[];summary:NetworkSummary;attribution:string;geometry_provider?:string;provider_notice?:string}
export interface MapConfig {center:[number,number];location_label:string;tile_url:string;tile_attribution:string;max_zoom:number;notice:string}
export interface MapBounds {south:number;west:number;north:number;east:number}
export interface SearchPlace {label:string;latitude:number;longitude:number}
export function isMapNetwork(v:unknown):v is MapNetwork {
 if(!isRecord(v)||!Array.isArray(v.segments)||!isRecord(v.summary)||typeof v.attribution!=='string')return false;
 const ids=new Set<string>();
 if(!v.segments.every(s=>{
  if(!isRecord(s)||typeof s.id!=='string'||ids.has(s.id)||typeof s.name!=='string'||s.source!=='openstreetmap'||!finiteNumber(s.length_m)||s.length_m<=0||!Array.isArray(s.coordinates)||s.coordinates.length<2)return false;
  ids.add(s.id);
  if(!s.coordinates.every(p=>Array.isArray(p)&&p.length===2&&finiteNumber(p[0])&&finiteNumber(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85))return false;
  if(s.inspection===null)return true;
  const i=s.inspection;
  return isRecord(i)&&i.evidence_verified===true&&isRoadQualityScore(i.score)&&typeof i.source_hash==='string'&&i.source_hash===i.score.image.sha256&&typeof i.analyzed_at==='string'&&Number.isFinite(Date.parse(i.analyzed_at))&&['user_reviewed','unreviewed'].includes(String(i.review_status))&&typeof i.original_preview==='string'&&i.original_preview.startsWith('data:image/jpeg;base64,')&&typeof i.outlined_preview==='string'&&i.outlined_preview.startsWith('data:image/jpeg;base64,');
 }))return false;
 const s=v.summary;
 if(!isRecord(s.by_type)||!isRecord(s.by_severity)||!Object.values(s.by_type).every(n=>Number.isSafeInteger(n)&&Number(n)>=0)||!Object.values(s.by_severity).every(n=>Number.isSafeInteger(n)&&Number(n)>=0)||typeof s.comparable_configurations!=='boolean'||Number(s.represented_segment_length_m)>Number(s.mapped_length_m)+.001||Number(s.represented_length_percent)>100.00001)return false;
 if(s.inspected_segments===0&&(s.average_quality!==null||s.defect_count!==null))return false;
 if(s.comparable_configurations===false&&s.average_quality!==null)return false;
 return ['segment_count','inspected_segments','not_inspected_segments','mapped_length_m','represented_segment_length_m','represented_length_percent','needs_attention'].every(k=>finiteNumber(s[k])&&Number(s[k])>=0)&&s.segment_count===v.segments.length&&s.inspected_segments===v.segments.filter(x=>x.inspection!==null).length&&Number(s.inspected_segments)+Number(s.not_inspected_segments)===s.segment_count&&(s.average_quality===null||finiteNumber(s.average_quality)&&s.average_quality>=0&&s.average_quality<=100)&&(s.defect_count===null||Number.isSafeInteger(s.defect_count)&&Number(s.defect_count)>=0)&&s.provisional===true&&typeof s.methodology==='string';
}
async function mapRequest(path:string,init:RequestInit={},timeout=45000){
 try{return await request('/map'+path,init,timeout)}catch(e){if(e instanceof ApiError&&e.status===503)throw new ApiError('Road lines could not load from the map providers. Zoom in and press “Load roads in view” to retry. Saved inspections are preserved.',503);throw e}
}
export async function getMapConfig(signal?:AbortSignal):Promise<MapConfig>{
 const v=await mapRequest('/config',{signal});
 if(!isRecord(v)||!Array.isArray(v.center)||v.center.length!==2||!v.center.every(finiteNumber)||Math.abs(v.center[0])>85||Math.abs(v.center[1])>180||typeof v.tile_url!=='string'||!/^https?:\/\//.test(v.tile_url)||typeof v.tile_attribution!=='string'||typeof v.location_label!=='string')throw new ApiError('Invalid map configuration.');
 return v as unknown as MapConfig;
}
export async function getMappedNetwork(signal?:AbortSignal){const v=await mapRequest('/network',{signal});if(!isMapNetwork(v))throw new ApiError('Invalid inspection network response.');return v}
export async function fetchMappedRoads(bounds:MapBounds,signal?:AbortSignal){const v=await mapRequest('/roads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bounds),signal});if(!isMapNetwork(v))throw new ApiError('Invalid road geometry or inspection data.');return v}
export async function searchMapLocation(q:string,signal?:AbortSignal):Promise<SearchPlace[]>{
 const v=await mapRequest('/search?q='+encodeURIComponent(q),{signal});
 if(!isRecord(v)||!Array.isArray(v.results)||!v.results.every(r=>isRecord(r)&&typeof r.label==='string'&&finiteNumber(r.latitude)&&Math.abs(r.latitude)<=85&&finiteNumber(r.longitude)&&Math.abs(r.longitude)<=180))throw new ApiError('Invalid location search response.');
 return v.results as SearchPlace[];
}
export async function attachMapInspection(segmentId:string,analysis:AnalysisController,coordinates:[number,number],confirmed:boolean,reviewed:boolean){
 if(!analysis.selected||!analysis.qualityScore||analysis.qualityScoreBusy||!analysis.detection?.score_token||analysis.qualityScore.snapshot_id!==analysis.detection.score_token)throw new ApiError('Wait for the current detection and score before saving.');
 const form=new FormData();form.set('image',analysis.selected.file);form.set('segment_id',segmentId);form.set('score_token',analysis.detection.score_token);
 form.set('excluded_ids',JSON.stringify(analysis.excludedDefects));form.set('latitude',String(coordinates[0]));form.set('longitude',String(coordinates[1]));form.set('location_confirmed',String(confirmed));form.set('reviewed',String(reviewed));
 const v=await mapRequest('/inspections',{method:'POST',body:form},90000);if(!isMapNetwork(v))throw new ApiError('The service returned invalid saved inspection data.');return v;
}
