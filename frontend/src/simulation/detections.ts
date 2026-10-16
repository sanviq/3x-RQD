import type { DefectDetection } from '../types/api';
import type { Mark, RoadConfig, Waypoint } from './model';
import { clamp, vehicle } from './model';

/** A documented visualization prior, never a depth measurement. */
export function assumedDepth(kind:string,severity:number) {
  const s=clamp(severity,0,1);
  return kind==='Crack'?3+12*s:kind==='Pothole'?20+80*s:kind==='Depression'?8+40*s:5+30*s;
}
export function detectedMarks(detection:DefectDetection|null|undefined,excluded:string[]=[]):Mark[] {
  return (detection?.defects??[]).filter(d=>!excluded.includes(d.id)).map(d=>{
    const xs=d.road_polygon.map(p=>p.x),ys=d.road_polygon.map(p=>p.y);
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    return {id:d.id,kind:d.kind,x:(x0+x1)/2,y:(y0+y1)/2,width:Math.max(.002,x1-x0),length:Math.max(.002,y1-y0),
      depthMm:assumedDepth(d.kind,d.severity),severity:1,repaired:false,provenance:'detected' as const,
      confidence:d.confidence,visualSeverity:d.severity,polygon:d.road_polygon.map(p=>({...p}))};
  }).sort((a,b)=>b.y-a.y);
}
/** An inspection route intentionally aligns the right wheel with one visible candidate.
 * It is not a safe route recommendation. Preserve the user's path after they edit it. */
export function inspectionPath(marks:Mark[],config:RoadConfig):Waypoint[] {
  const targets=marks.filter(m=>m.y>.10&&m.y<.82&&m.x>.18&&m.x<.9);
  const target=[...targets].sort((a,b)=>(b.width*b.length*(b.visualSeverity??.5))-(a.width*a.length*(a.visualSeverity??.5)))[0];
  const x=target?clamp(target.x-vehicle.track/(2*config.width),.16,.84):.5;
  return [{x,y:1},{x,y:0}];
}
