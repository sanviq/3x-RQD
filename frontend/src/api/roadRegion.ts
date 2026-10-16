import {request,ApiError,isRecord,finiteNumber} from './client';
import type {CaptureType,RoadRegion} from '../types/api';
export function isRoadRegion(v:unknown):v is RoadRegion{
 return isRecord(v)&&Array.isArray(v.road_quad)&&v.road_quad.length===4&&v.road_quad.every(p=>isRecord(p)&&finiteNumber(p.x)&&finiteNumber(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)&&['provided_outline','declared_surface_crop','semantic_road_mask','opencv_road_appearance'].includes(String(v.method))&&['selected','review_required','needs_outline'].includes(String(v.status))&&typeof v.requires_review==='boolean'&&v.confidence===null&&v.confidence_calibrated===false&&typeof v.message==='string'&&isRecord(v.image)&&finiteNumber(v.image.width)&&finiteNumber(v.image.height)&&v.image.width>0&&v.image.height>0;
}
export async function detectRoadRegion(image:File,captureType:CaptureType,signal?:AbortSignal):Promise<RoadRegion>{
 const f=new FormData();f.set('image',image);f.set('capture_type',captureType);
 const v=await request('/road-region',{method:'POST',body:f,signal},45000);
 if(!isRoadRegion(v))throw new ApiError('The service returned an invalid road outline. Choose the road corners manually or retry.');return v;
}
