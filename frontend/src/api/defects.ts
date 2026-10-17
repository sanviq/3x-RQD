import {isRoadQualityScore} from './qualityScore';
import type { DefectDetection, RoadDetectorSettings } from '../types/api';
import type { RoadQuad } from '../simulation/projection';
import { request, ApiError, isRecord, finiteNumber } from './client';
const point=(p:unknown)=>isRecord(p)&&finiteNumber(p.x)&&finiteNumber(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const polygon=(p:unknown)=>Array.isArray(p)&&p.length>=3&&p.length<=1000&&p.every(point);
const box=(b:unknown)=>isRecord(b)&&['x','y','width','height'].every(k=>finiteNumber(b[k])&&(b[k] as number)>=0);
export function isDefectDetection(v:unknown):v is DefectDetection {
  if(!isRecord(v)||typeof v.version!=='string'||!['opencv_multiscale_contours','yolo_rdd_detection'].includes(String(v.method))||v.coordinate_system!=='normalized_exif_oriented_original'||v.confidence_calibrated!==false||v.requires_review!==true)return false;
  if(!isRecord(v.image)||!finiteNumber(v.image.width)||!finiteNumber(v.image.height)||v.image.width<=0||v.image.height<=0)return false;
  if(!Array.isArray(v.road_quad)||v.road_quad.length!==4||!v.road_quad.every(point))return false;
  if(!Array.isArray(v.warnings)||!v.warnings.every(x=>typeof x==='string')||!Array.isArray(v.defects)||v.defects.length>80)return false;
  if(v.road_quality_score!=null&&(!isRoadQualityScore(v.road_quality_score)||v.road_quality_score.snapshot_id!==v.score_token||v.road_quality_score.image.width!==v.image.width||v.road_quality_score.image.height!==v.image.height))return false;
  const ids=new Set<string>();
  return v.defects.every(d=>{
    if(!isRecord(d)||typeof d.id!=='string'||ids.has(d.id))return false;ids.add(d.id);
    const evidence=d.evidence;
    return ['Pothole','Crack','Depression','Uneven surface'].includes(String(d.kind))&&
      finiteNumber(d.confidence)&&d.confidence>=0&&d.confidence<=1&&finiteNumber(d.severity)&&d.severity>=0&&d.severity<=1&&
      ['Low','Moderate','High'].includes(String(d.severity_label))&&polygon(d.polygon)&&polygon(d.road_polygon)&&box(d.bbox)&&box(d.bbox_normalized)&&
      finiteNumber(d.area_fraction)&&d.area_fraction>=0&&d.area_fraction<=1&&d.depth_mm===null&&d.physical_dimensions===null&&
      isRecord(evidence)&&(v.method==='opencv_multiscale_contours'
        ? d.provenance==='opencv_candidate'&&['local_contrast','boundary_strength','solidity'].every(k=>finiteNumber(evidence[k]))
        : d.provenance==='yolo_prediction'&&['D00','D10','D20','D40'].includes(String(d.detection_code))&&d.kind===(d.detection_code==='D40'?'Pothole':'Crack')&&typeof d.detection_label==='string'&&['bounding_box_schematic','model_segmentation'].includes(String(d.geometry_source)));
  });
}
export async function detectRoadDefects(image:File,quad:RoadQuad,signal?:AbortSignal,settings?:RoadDetectorSettings,roadPolygon?:{x:number;y:number}[]):Promise<DefectDetection> {
  const body=new FormData();body.append('image',image);body.append('road_quad',JSON.stringify(quad));
  if(roadPolygon)body.append('road_polygon',JSON.stringify(roadPolygon));
  if(settings){body.append('detector_mode',settings.mode);body.append('confidence',String(settings.confidence));body.append('resolution',String(settings.resolution))}
  const value=await request('/detect-defects',{method:'POST',body,signal},45000);
  if(!isDefectDetection(value))throw new ApiError('The backend did not return compatible defect geometry. Restart the updated API.');
  if(settings?.mode==='model'&&value.method!=='yolo_rdd_detection')throw new ApiError('The backend returned untrained contours instead of the requested model. Restart the updated API or select Untrained visual candidates.');
  return value;
}
