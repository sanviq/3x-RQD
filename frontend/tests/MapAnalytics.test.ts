import {describe,it,expect,vi} from 'vitest';
import {isMapNetwork,attachMapInspection,searchMapLocation} from '../src/api/map';
import {scoreColor,repairPriorities} from '../src/network/analytics';
import {mapFixture} from './fixtures/mapNetwork';
import type {AnalysisController} from '../src/hooks/useAnalysis';
describe('inspection map data integrity',()=>{
 it('accepts evidence-backed and explicitly uninspected road responses',()=>{expect(isMapNetwork(mapFixture())).toBe(true);expect(isMapNetwork(mapFixture(false))).toBe(true)});
 it('keeps an unknown condition gray, different from a measured zero',()=>{expect(scoreColor(null)).toBe('#858b88');expect(scoreColor(0)).not.toBe(scoreColor(null))});
 it('rejects source-image hash mismatch',()=>{const v=mapFixture();v.segments[0].inspection!.source_hash='wrong';expect(isMapNetwork(v)).toBe(false)});
 it('rejects evidence without backend verification',()=>{const v=mapFixture();(v.segments[0].inspection as unknown as {evidence_verified:boolean}).evidence_verified=false;expect(isMapNetwork(v)).toBe(false)});
 it('rejects duplicate IDs, nonfinite geometry and fabricated summary totals',()=>{const v=mapFixture();v.segments.push(v.segments[0]);expect(isMapNetwork(v)).toBe(false);const b=mapFixture();b.segments[0].coordinates[0][1]=NaN;expect(isMapNetwork(b)).toBe(false);const c=mapFixture();c.summary.inspected_segments=3;expect(isMapNetwork(c)).toBe(false)});
 it('never recommends repairs for uninspected roads',()=>{expect(repairPriorities(mapFixture(false).segments)).toEqual([])});
 it('prioritizes poorer observed condition without mutating the data',()=>{const a=mapFixture().segments[0],b=structuredClone(a);b.id='other';b.inspection!.score.score=40;const list=[a,b];expect(repairPriorities(list).map(s=>s.id)).toEqual(['other',a.id]);expect(list[0]).toBe(a)});
 it('does not save while the current score is pending',async()=>{const fetcher=vi.spyOn(globalThis,'fetch');await expect(attachMapInspection('x',{selected:null} as unknown as AnalysisController,[0,0],true,false)).rejects.toThrow('Wait for the current detection');expect(fetcher).not.toHaveBeenCalled()});
 it('submits search only through the explicit API call with an encoded query',async()=>{const mock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({results:[{label:'Place',latitude:13,longitude:77}]})));expect(await searchMapLocation('MG Road & Park')).toHaveLength(1);expect(String(mock.mock.calls[0][0])).toContain('MG%20Road%20%26%20Park')});
});
