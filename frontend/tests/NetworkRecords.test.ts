
import {renderHook,act} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import {useRoadNetwork} from '../src/hooks/useRoadNetwork';
import {demoResult} from '../src/data/demo';
const roads={type:'FeatureCollection',features:[{type:'Feature',id:'a',properties:{name:'Road A'},geometry:{type:'LineString',coordinates:[[77,13],[77.001,13]]}}]};
const file=(data=roads)=>({size:120,text:async()=>JSON.stringify(data)}) as File;
describe('session network records',()=>{
  it('attaches an actual immutable analysis snapshot and exclusion list to the chosen segment',async()=>{
    const {result}=renderHook(()=>useRoadNetwork());
    await act(async()=>result.current.importFile(file()));
    const excluded=['CV1'];act(()=>result.current.attach('road.jpg',demoResult,excluded));excluded.push('CV2');
    expect(result.current.records.a.result).toBe(demoResult);
    expect(result.current.records.a.excludedCandidates).toEqual(['CV1']);
  });
  it('preserves valid geometry when a replacement import is invalid',async()=>{
    const {result}=renderHook(()=>useRoadNetwork());
    await act(async()=>result.current.importFile(file()));
    await act(async()=>result.current.importFile({size:20,text:async()=>'{}'} as File));
    expect(result.current.links[0].id).toBe('a');expect(result.current.error).toContain('WGS84');
  });
  it('clears old records when a valid new network replaces the old one',async()=>{
    const {result}=renderHook(()=>useRoadNetwork());
    await act(async()=>result.current.importFile(file()));
    act(()=>result.current.attach('old.jpg',demoResult,[]));
    await act(async()=>result.current.importFile(file()));
    expect(result.current.records).toEqual({});
  });
  it('ignores stale asynchronous imports after a newer choice',async()=>{
    let finish!:(s:string)=>void;
    const old={size:100,text:()=>new Promise<string>(resolve=>{finish=resolve})} as File;
    const {result}=renderHook(()=>useRoadNetwork());
    let pending:Promise<void>;act(()=>{pending=result.current.importFile(old)});
    const next={...roads,features:roads.features.map(f=>({...f,id:'new'}))};
    await act(async()=>result.current.importFile(file(next)));
    await act(async()=>{finish(JSON.stringify(roads));await pending});
    expect(result.current.links[0].id).toBe('new');
  });
});
