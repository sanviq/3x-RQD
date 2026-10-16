import { describe, expect, it } from 'vitest';
import { defaultPath, effectiveMarks, groundHeight, initialDrive, stepDrive, tire, tireContactHeight, wheelDemoMarks, wheelPosition } from '../src/simulation/model';
import { wheelPose } from '../src/simulation/vehicle';
import type { Mark } from '../src/simulation/model';
const config={width:6,length:30,speed:25};
const hole:Mark={...wheelDemoMarks(config)[0],severity:1};
function run(marks:Mark[]){
  let state=initialDrive(),maxTravel=0,maxVibration=0,maxWheel=0,minimumLoad=Infinity;
  for(let i=0;i<2400&&state.z<config.length-1.6;i++){
    state=stepDrive(state,config,marks,defaultPath);
    const p=wheelPose(state,marks,defaultPath,config);
    maxTravel=Math.max(maxTravel,Math.abs(p.travel));maxVibration=Math.max(maxVibration,Math.abs(p.vibration));
    maxWheel=Math.max(maxWheel,Math.abs(state.wheels[1].axle));minimumLoad=Math.min(minimumLoad,p.compression);
  }
  return {state,maxTravel,maxVibration,maxWheel,minimumLoad};
}
describe('wheel-level contact and motion',()=>{
  it('has no artificial shaking, axle movement or suspension motion on a smooth road',()=>{
    const r=run([]);expect(r.maxTravel).toBe(0);expect(r.maxVibration).toBe(0);expect(r.maxWheel).toBe(0);
    expect(r.minimumLoad).toBeCloseTo(tire.staticDeflection);
  });
  it('starts reacting only at the spatial footprint, then rebounds',()=>{
    let state=initialDrive(),before=0,after=0;
    const frontEntry=(1-hole.y)*config.length-hole.length*config.length*.75-tire.radius;
    for(let i=0;i<1100;i++){
      state=stepDrive(state,config,[hole],defaultPath);
      const wheel=wheelPosition(state.z,1,defaultPath,config),travel=wheelPose(state,[hole],defaultPath,config).travel;
      if(wheel.z<frontEntry)before=Math.max(before,Math.abs(travel));
      if(wheel.z>(1-hole.y)*config.length+hole.length*config.length)after=Math.max(after,Math.abs(travel));
    }
    expect(before).toBe(0);expect(after).toBeGreaterThan(.0001);
  });
  it('increases movement with severity and removes the response after repair',()=>{
    const mild=run([{...hole,depthMm:20,severity:.6}]),severe=run([{...hole,depthMm:100,severity:1.5}]);
    expect(severe.maxTravel).toBeGreaterThan(mild.maxTravel*2);
    expect(severe.maxVibration).toBeGreaterThan(mild.maxVibration);
    const repaired=run(effectiveMarks([{...hole,repaired:true}],'Repaired',0));
    expect(repaired.maxTravel).toBe(0);expect(repaired.maxVibration).toBe(0);
  });
  it('bridges a narrow crack instead of making the axle follow an impossible point contact',()=>{
    const crack={...hole,kind:'Crack' as const,length:.003,depthMm:100},x=(hole.x-.5)*config.width,z=(1-hole.y)*config.length;
    expect(groundHeight(x,z,[crack],config)).toBeCloseTo(-.1);
    expect(tireContactHeight(x,z,[crack],config)).toBeGreaterThan(-.04);
  });
  it('locks tire rotation to distance and keeps contact loads nonnegative',()=>{
    const state={...initialDrive(),distance:12};expect(wheelPose(state,[],defaultPath,config).rotation).toBeCloseTo(12/tire.radius);
    const r=run([{...hole,depthMm:250,severity:1.8}]);expect(r.minimumLoad).toBeGreaterThanOrEqual(0);
    expect(r.state.wheels.every(w=>Object.values(w).every(Number.isFinite))).toBe(true);
  });
  it('keeps the demo explicit and in the right wheel track',()=>{
    const marks=wheelDemoMarks(config);
    expect(marks.every(m=>m.provenance==='sample')).toBe(true);
    expect((marks[0].x-.5)*config.width).toBeCloseTo(wheelPosition(4,1,defaultPath,config).x);
    expect(marks.map(m=>m.kind)).toEqual(['Pothole','Uneven surface','Ravelling']);
  });
});
