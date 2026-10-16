import { driveResult, effectiveMarks, initialDrive, stepDrive } from './model';
import type { DriveResult, GrowthRates, Mark, RoadConfig, Scenario, Waypoint } from './model';
export interface ComparisonInput {marks:Mark[];config:RoadConfig;path:Waypoint[];months:number;growth:GrowthRates}
export function simulateScenario(input:ComparisonInput,scenario:Scenario,progress?:(fraction:number)=>void):DriveResult {
  const marks=effectiveMarks(input.marks,scenario,input.months,input.growth),trace:DriveResult['trace']=[];
  let state=initialDrive(),sample=0;
  for(let i=0;i<250000;i++){
    state=stepDrive(state,input.config,marks,input.path);
    if(state.time-sample>=.05){trace.push({distance:state.distance,acceleration:state.acceleration});sample=state.time}
    if(i%480===0)progress?.((state.z-1.6)/(input.config.length-3.2));
    if(state.z>=input.config.length-1.6)return driveResult(state,scenario,input.config,trace);
  }
  throw new Error('This path did not complete within the simulation step limit. Use fewer, smoother waypoints.');
}
