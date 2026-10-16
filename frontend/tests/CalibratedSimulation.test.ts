import {describe,it,expect} from 'vitest';
import {simulateScenario} from '../src/simulation/comparison';
import {defaultGrowth,defaultPath,vehicle,wheelDemoMarks,initialDrive,staticTireDeflection} from '../src/simulation/model';
import {wheelPose} from '../src/simulation/vehicle';
const config={width:6,length:20,speed:25};
const input={marks:wheelDemoMarks(config),config,path:defaultPath,months:6,growth:defaultGrowth};
describe('explicit vehicle parameters propagate through the shared physics',()=>{
 it('changes actual dynamics rather than just the display label',()=>{
  const baseline=simulateScenario(input,'Original');
  const suspension={...vehicle,sprungMass:600,damping:3500};
  const changed=simulateScenario({...input,config:{...config,suspension}},'Original');
  expect(changed.rms).not.toBeCloseTo(baseline.rms,3);
  expect(changed.seconds).toBe(baseline.seconds);expect(changed.distance).toBe(baseline.distance);
  const pose=wheelPose(initialDrive(),[],defaultPath,{...config,suspension});
  expect(pose.compression).toBeCloseTo(staticTireDeflection({...config,suspension}));
 });
 it('remains finite for boundary parameter combinations and has no fabricated vibration on smooth roads',()=>{
  for(const suspension of [
   {sprungMass:150,unsprungMass:20,spring:60000,damping:5000,tire:300000},
   {sprungMass:800,unsprungMass:100,spring:10000,damping:500,tire:80000},
  ]){
   const result=simulateScenario({...input,config:{...config,suspension}},'Original');
   expect(Number.isFinite(result.rms)).toBe(true);expect(result.peak).toBeLessThan(1e5);
   expect(simulateScenario({...input,marks:[],config:{...config,suspension}},'Original').rms).toBe(0);
  }
 });
 it('rejects invalid vehicle coefficients and preserves matched selected repairs',()=>{
  expect(()=>simulateScenario({...input,config:{...config,suspension:{...vehicle,sprungMass:0}}},'Original')).toThrow();
  const selected=input.marks.map((m,i)=>({...m,repaired:i===0}));
  const before=simulateScenario({...input,marks:selected},'Original'),after=simulateScenario({...input,marks:selected},'Repaired');
  expect(after.seconds).toBe(before.seconds);expect(after.hits).toBeLessThan(before.hits);
  expect(input.marks.every(m=>!m.repaired)).toBe(true);
 });
});
