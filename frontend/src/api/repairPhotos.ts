
import {request,isRecord,finiteNumber,ApiError} from './client';
import type {Mark,GrowthRates} from '../simulation/model';
import type {RoadQuad} from '../simulation/projection';
import {roadProject} from '../simulation/projection';
export interface RepairPhotoSettings {
  months:number;repair_quality:number;traffic:'light'|'normal'|'heavy';weather:'dry'|'seasonal'|'wet'|'freeze_thaw';
  size_growth_per_month:number;severity_growth_per_month:number;patch_decay_per_month:number;
  engine:'auto'|'opencv'|'diffusers';inpaint_method:'telea'|'ns';
}
export interface RepairPhotoResult {
  version:'repair-photo-v1';images:{source:string;original:string;repaired:string;predicted:string};
  masks:{repair:string;prediction:string};image:{width:number;height:number;original_width:number;original_height:number};
  settings:RepairPhotoSettings;engine_used:string;fallback_reason:string|null;
  repair_count:number;simulated:true;forecast_validated:false;warnings:string[];
  defects:{id:string;kind:string;repaired:boolean;original_area_px:number;predicted_area_px:number;patch_degradation:number|null;linear_growth_factor:number}[];
}
export type PhotoAssumptions=Omit<RepairPhotoSettings,'months'|'size_growth_per_month'|'severity_growth_per_month'>;
export const defaultPhotoSettings={repair_quality:.8,traffic:'normal',weather:'seasonal',patch_decay_per_month:.035,engine:'auto',inpaint_method:'telea'} as const;
export function photoGeometry(marks:Mark[],quad:RoadQuad,boxGeometry=false){
  return marks.map(m=>{
    const points=m.polygon??Array.from({length:32},(_,i)=>({x:m.x+Math.cos(i*Math.PI/16)*m.width/2,y:m.y+Math.sin(i*Math.PI/16)*m.length/2}));
    return {id:m.id,kind:m.kind,severity:m.visualSeverity??Math.min(1,Math.max(0,m.severity/2)),
      polygon:points.map(p=>roadProject(quad,Math.max(0,Math.min(1,p.x)),Math.max(0,Math.min(1,p.y)))),
      geometry_source:m.provenance==='manual'?'manual':boxGeometry?'bounding_box':'contour'};
  });
}
export function photoSettings(months:number,growth:GrowthRates,extra:Omit<RepairPhotoSettings,'months'|'size_growth_per_month'|'severity_growth_per_month'>):RepairPhotoSettings{
  return {...extra,months,size_growth_per_month:growth.size,severity_growth_per_month:growth.depth};
}
const png=(v:unknown):v is string=>typeof v==='string'&&v.startsWith('data:image/png;base64,');
export function isRepairPhotoResult(v:unknown):v is RepairPhotoResult {
  if(!isRecord(v)||v.version!=='repair-photo-v1'||v.simulated!==true||v.forecast_validated!==false||!isRecord(v.images)||!isRecord(v.masks)||!isRecord(v.image)||!isRecord(v.settings))return false;
  if(!['source','original','repaired','predicted'].every(k=>png(v.images&&isRecord(v.images)?v.images[k]:null))||!png(v.masks.repair)||!png(v.masks.prediction))return false;
  if(!['width','height','original_width','original_height'].every(k=>finiteNumber(v.image&&isRecord(v.image)?v.image[k]:null)&&Number((v.image as Record<string,unknown>)[k])>0))return false;
  return finiteNumber(v.settings.months)&&typeof v.engine_used==='string'&&Number.isInteger(v.repair_count)&&Array.isArray(v.defects)&&Array.isArray(v.warnings)&&v.warnings.every(x=>typeof x==='string');
}
export async function renderRepairPhotos(file:File,quad:RoadQuad,marks:Mark[],settings:RepairPhotoSettings,signal?:AbortSignal,boxGeometry=false){
  const body=new FormData();body.append('image',file);body.append('road_quad',JSON.stringify(quad));
  body.append('defects_json',JSON.stringify(photoGeometry(marks,quad,boxGeometry)));
  body.append('repair_ids_json',JSON.stringify(marks.filter(m=>m.repaired).map(m=>m.id)));
  body.append('settings_json',JSON.stringify(settings));
  const value=await request('/repair-views',{method:'POST',body,signal},300_000);
  if(!isRepairPhotoResult(value))throw new ApiError('The photo renderer returned an incompatible response. Restart the updated backend.');
  return value;
}
