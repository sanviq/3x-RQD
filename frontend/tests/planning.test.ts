import { describe, expect, it } from 'vitest';
import { segments, optimize, defaultWeights, score, summary } from '../src/data/demo';
describe('demo planning math',()=>{
  it('never exceeds the recommended budget, including a zero budget',()=>{
    for(const budget of [0,85000,300000,800000,1500000]){
      const chosen=optimize(budget,defaultWeights);
      expect(segments.filter(s=>chosen.includes(s.id)).reduce((sum,s)=>sum+s.cost,0)).toBeLessThanOrEqual(budget);
    }
  });
  it('uses distance weighting and leaves unselected segment values unchanged',()=>{
    const original=summary(defaultWeights);
    const repaired=summary(defaultWeights,['RH-001']);
    const length=segments.reduce((sum,s)=>sum+s.length,0);
    expect(original.average).toBe(Math.round(segments.reduce((sum,s)=>sum+score(s)*s.length,0)/length));
    expect(repaired.average).toBeGreaterThanOrEqual(original.average);
    expect(score(segments[1],defaultWeights,false)).toBe(score(segments[1]));
  });
});
