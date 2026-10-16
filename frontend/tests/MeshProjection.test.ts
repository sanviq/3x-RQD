import { describe, expect, it } from 'vitest';
import { fitRoadProjection, type Vertex } from '../src/components/meshProjection';
describe('road camera framing', () => {
 for(const [width,length] of [[7,30],[.48,.32],[100,2],[.00001,.00003]])for(const [vw,vh] of [[1000,480],[320,280]])for(const yaw of [-180,-60,0,90,180]){
  it(`fits ${width}x${length}, yaw ${yaw}, viewport ${vw}x${vh}`,()=>{
   const vertices:Vertex[]=[-1,1].flatMap(x=>[-1,1].map(z=>[x*width/2,0,z*length/2] as Vertex));
   const points=vertices.map(fitRoadProjection(vertices,vw,vh,yaw,52));
   const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
   expect(Math.min(...xs)).toBeGreaterThanOrEqual(vw*.079);expect(Math.max(...xs)).toBeLessThanOrEqual(vw*.921);
   expect(Math.min(...ys)).toBeGreaterThanOrEqual(vh*.109);expect(Math.max(...ys)).toBeLessThanOrEqual(vh*.891);
   expect(Math.max((Math.max(...xs)-Math.min(...xs))/(vw*.84),(Math.max(...ys)-Math.min(...ys))/(vh*.78))).toBeCloseTo(1);
  });
 }
 it('zooms around the geometry center without changing model coordinates',()=>{
  const vertices:Vertex[]=[[10,0,20],[17,0,50]],before=JSON.stringify(vertices);
  const a=fitRoadProjection(vertices,800,400,-60,52,1)(vertices[0]),b=fitRoadProjection(vertices,800,400,-60,52,2)(vertices[0]);
  expect(b.x-400).toBeCloseTo(2*(a.x-400));expect(b.y-200).toBeCloseTo(2*(a.y-200));expect(JSON.stringify(vertices)).toBe(before);
 });
});
