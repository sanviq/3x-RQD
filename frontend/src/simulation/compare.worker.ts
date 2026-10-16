import { simulateScenario } from './comparison';
import type { ComparisonInput } from './comparison';
import type { DriveResult, Scenario } from './model';
self.onmessage=(event:MessageEvent<ComparisonInput>)=>{
  try{
    const scenarios:Scenario[]=['Original','Repaired','Deteriorated'],results={} as Record<Scenario,DriveResult>;
    scenarios.forEach((scenario,index)=>{
      results[scenario]=simulateScenario(event.data,scenario,fraction=>self.postMessage({type:'progress',value:(index+fraction)/3}));
    });
    self.postMessage({type:'complete',results});
  }catch(error){self.postMessage({type:'error',message:(error as Error).message})}
};
