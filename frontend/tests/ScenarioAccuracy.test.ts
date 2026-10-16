import { describe, expect, it } from 'vitest';
import { defaultGrowth, editMark, effectiveMarks, groundHeight, markArea, repairCost, surfaceProfile, vehicle } from '../src/simulation/model';
import type { Mark } from '../src/simulation/model';
import { simulateScenario } from '../src/simulation/comparison';
import { projectTwin, renderOrigin, twinCamera } from '../src/simulation/twin';
import { weatherFootprint } from '../src/simulation/image';
const config={width:6,length:20,speed:25},path=[{x:.5,y:1},{x:.5,y:0}];
const mark:Mark={id:'CV1',kind:'Pothole',x:.625,y:.5,width:.25,length:.15,depthMm:80,severity:1,repaired:false,provenance:'detected',visualSeverity:.7,
  polygon:[{x:.5,y:.425},{x:.75,y:.425},{x:.75,y:.575},{x:.5,y:.575}]};
describe('shared scenario geometry',()=>{
  it('moves and resizes the actual contour with its bounding fields',()=>{
    const moved=editMark(mark,{x:.525,y:.6,width:.3,length:.2});
    expect(moved.polygon![0].x).toBeCloseTo(.375);expect(moved.polygon![0].y).toBeCloseTo(.5);
    expect(moved.width).toBeCloseTo(.3);expect(moved.length).toBeCloseTo(.2);
    expect(mark.polygon![0]).toEqual({x:.5,y:.425});
  });
  it('preserves exact zero-horizon geometry and applies growth to contour and area',()=>{
    const zero=effectiveMarks([mark],'Deteriorated',0)[0],later=effectiveMarks([mark],'Deteriorated',12)[0];
    expect(zero).toEqual(mark);expect(later.depthMm).toBeCloseTo(108.8);
    expect(markArea(later,config)/markArea(mark,config)).toBeCloseTo(1.18**2);
    const edgeX=(.752-.5)*config.width,z=10;
    expect(groundHeight(edgeX,z,[mark],config)).toBe(0);expect(groundHeight(edgeX,z,[later],config)).toBeLessThan(0);
  });
  it('supports user growth rates, bounded contours, and immutable inputs',()=>{
    const changed=effectiveMarks([mark],'Deteriorated',24,{depth:0,size:0})[0];expect(changed).toEqual(mark);
    const grown=effectiveMarks([{...mark,x:.92,polygon:mark.polygon!.map(p=>({x:p.x+.29,y:p.y}))}],'Deteriorated',24,{depth:.1,size:.05})[0];
    expect(grown.polygon!.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)).toBe(true);
    expect(mark.repaired).toBe(false);
  });
  it('charges actual polygon area and uses ellipse area only for manual geometry',()=>{
    expect(markArea(mark,config)).toBeCloseTo(.25*.15*6*20);
    expect(repairCost(mark,config,1000)).toBe(5500);
    expect(markArea({...mark,polygon:undefined},config)).toBeCloseTo(Math.PI*.25*.15*6*20/4);
  });
  it('removes only selected repairs and retains untreated geometry',()=>{
    const other={...mark,id:'CV2',x:.2,polygon:undefined,repaired:false};
    const after=effectiveMarks([{...mark,repaired:true},other],'Repaired',12);
    expect(after).toEqual([other]);expect(effectiveMarks([mark],'Original',12)[0]).toEqual(mark);
  });
});
describe('matched physics comparison and camera accuracy',()=>{
  it('compares all scenarios with identical path, duration, distance and speed',()=>{
    const input={marks:[{...mark,repaired:true}],config,path,months:6,growth:defaultGrowth};
    const original=simulateScenario(input,'Original'),repaired=simulateScenario(input,'Repaired'),later=simulateScenario(input,'Deteriorated');
    expect(original.rms).toBeGreaterThan(0);expect(repaired.rms).toBe(0);expect(later.rms).toBeGreaterThan(0);
    for(const result of [repaired,later]){
      expect(result.distance).toBe(original.distance);expect(result.seconds).toBe(original.seconds);expect(result.speed).toBe(original.speed);
    }
    expect(original.trace.length).toBeGreaterThan(20);
  });
  it('produces finite wheel-track profiles at actual steered wheel positions',()=>{
    const samples=surfaceProfile([mark],config,path);
    expect(samples.some(s=>s.rightMm<0)).toBe(true);expect(samples.every(s=>Number.isFinite(s.leftMm)&&Number.isFinite(s.rightMm))).toBe(true);
    expect(vehicle.track).toBe(1.5);
  });
  it('keeps twin world origin fixed while the wheel camera follows the moving vehicle',()=>{
    const pose={x:2,z:15,yaw:.4,axleHeight:.3,bodyHeight:.8};
    expect(renderOrigin('Orbit',pose)).toEqual({wheel:[0,0,0,0],yaw:0});
    expect(renderOrigin('Wheel',pose)).toEqual({wheel:[2,15,.3,.8],yaw:.4});
  });
  it('projects the selected defect to the camera center without changing physical height',()=>{
    const camera=twinCamera(config,[mark],-62,1,{tilt:42,relief:4,focus:mark.id});
    const projected=projectTwin(camera.target,camera,960,600)!;
    expect(projected.x).toBeCloseTo(480);expect(projected.y).toBeCloseTo(300);
    expect(groundHeight(.75,10,[mark],config)).toBeCloseTo(-.08);
    expect(camera.relief).toBe(4);
  });
  it('keeps the camera framing identical when a focused defect is repaired',()=>{
    const settings={tilt:42,relief:4,focus:mark.id,anchor:{x:mark.x,y:mark.y,width:mark.width,length:mark.length}};
    expect(twinCamera(config,[mark],-62,1,settings)).toEqual(twinCamera(config,[],-62,1,settings));
  });
  it('returns the exact synthetic perspective footprint used for API exclusion',()=>{
    expect(weatherFootprint('Perspective',100)).toEqual([{x:.2,y:.07},{x:.8,y:.07},{x:1,y:1},{x:0,y:1}]);
    expect(weatherFootprint('Rain',50)).toEqual([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);
  });
});
