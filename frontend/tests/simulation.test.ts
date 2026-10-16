import { describe, expect, it } from 'vitest';
import { affectedFraction, defaultPath, driveResult, effectiveMarks, groundHeight, initialDrive, pathX, recommendRepairs, repairCost, stepDrive } from '../src/simulation/model';
import type { Mark, RoadConfig } from '../src/simulation/model';
const config:RoadConfig={width:6,length:20,speed:30};
const pothole:Mark={id:'M1',kind:'Pothole',x:.5,y:.5,width:.5,length:.16,depthMm:80,severity:1,repaired:true,provenance:'manual'};
const other:Mark={...pothole,id:'M2',x:.2,y:.3,repaired:false};
function complete(marks:Mark[]){
  let state=initialDrive();
  for(let i=0;i<10000&&state.z<config.length-1.6;i++)state=stepDrive(state,config,marks,defaultPath);
  return driveResult(state,'Original',config,[]);
}
describe('simulation geometry and repair isolation',()=>{
  it('preserves untreated defects and removes only selected repair geometry',()=>{
    const original=effectiveMarks([pothole,other],'Original',6),repaired=effectiveMarks([pothole,other],'Repaired',6);
    expect(original).toHaveLength(2);expect(repaired).toEqual([other]);
    expect(groundHeight(0,10,original,config)).toBeLessThan(-.07);
    expect(groundHeight(0,10,repaired,config)).toBeGreaterThan(-.001);
    expect(groundHeight((other.x-.5)*6,(1-other.y)*20,repaired,config)).toBe(groundHeight((other.x-.5)*6,(1-other.y)*20,[other],config));
  });
  it('deterioration changes only the scenario copy',()=>{
    const later=effectiveMarks([pothole],'Deteriorated',12)[0];
    expect(later.depthMm).toBeCloseTo(108.8);expect(later.width).toBeGreaterThan(pothole.width);
    expect(pothole.depthMm).toBe(80);expect(effectiveMarks([pothole],'Deteriorated',0)).toEqual([pothole]);
  });
  it('calculates affected union without double counting',()=>{
    expect(affectedFraction([],config)).toBe(0);
    expect(affectedFraction([pothole],config)).toBeGreaterThan(0);
    expect(affectedFraction([pothole,{...pothole,id:'duplicate'}],config)).toBe(affectedFraction([pothole],config));
  });
  it('orders bottom-to-top waypoints and provides steering',()=>{
    const path=[{x:.7,y:0},{x:.3,y:1}];
    expect(pathX(0,path,config)).toBeCloseTo(-1.2);expect(pathX(20,path,config)).toBeCloseTo(1.2);expect(pathX(10,path,config)).toBeCloseTo(0);
  });
});
describe('fixed-step vehicle response',()=>{
  it('flat ground produces zero vertical acceleration',()=>{
    const result=complete([]);expect(result.seconds).toBeGreaterThan(0);
    expect(result.rms).toBe(0);expect(result.peak).toBe(0);expect(result.hits).toBe(0);
  });
  it('encountered potholes cause a finite response and selected repair removes it',()=>{
    const before=complete(effectiveMarks([pothole],'Original',0)),after=complete(effectiveMarks([pothole],'Repaired',0));
    expect(before.hits).toBe(1);expect(before.rms).toBeGreaterThan(.01);expect(Number.isFinite(before.peak)).toBe(true);
    expect(after.rms).toBe(0);expect(after.distance).toBe(before.distance);expect(after.seconds).toBe(before.seconds);expect(after.speed).toBe(before.speed);
  });
  it('does not report contact for a defect outside the driving path',()=>expect(complete([{...pothole,width:.01,x:.05,length:.03}]).hits).toBe(0));
});
describe('annotation repair budgeting',()=>{
  it('uses assumed area, rate and mobilization fee',()=>expect(repairCost(pothole,config,1000)).toBe(Math.round(1000+Math.PI*.5*6*.16*20/4*1000)));
  it('never recommends repairs above budget',()=>{
    expect(recommendRepairs([pothole,other],config,1000,0)).toEqual([]);
    for(const budget of [2000,10000,20000]){
      const ids=recommendRepairs([pothole,other],config,1000,budget);
      expect([pothole,other].filter(m=>ids.includes(m.id)).reduce((sum,m)=>sum+repairCost(m,config,1000),0)).toBeLessThanOrEqual(budget);
    }
  });
});
