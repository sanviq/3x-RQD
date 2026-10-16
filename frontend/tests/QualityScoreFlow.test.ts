vi.mock('../src/api/roadRegion',()=>({detectRoadRegion:vi.fn(async()=>null)}));
import {act,renderHook} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {useAnalysis} from '../src/hooks/useAnalysis';
import {detectRoadDefects} from '../src/api/defects';
import {rescoreRoad} from '../src/api/qualityScore';
import type {RoadQualityScore} from '../src/api/qualityScore';
import {scoreFixture} from './fixtures/qualityScore';
import raw from './fixtures/pothole-detection.json';
import type {DefectDetection} from '../src/types/api';
vi.mock('../src/api/defects',()=>({detectRoadDefects:vi.fn()}));
vi.mock('../src/api/qualityScore',async original=>({...await original<typeof import('../src/api/qualityScore')>(),rescoreRoad:vi.fn()}));
vi.mock('../src/api/roadQuality',()=>({analyzeRoad:vi.fn(()=>new Promise(()=>{}))}));
vi.mock('../src/utils/imageValidation',async original=>({...await original<typeof import('../src/utils/imageValidation')>(),inspectImage:vi.fn(async(file:File)=>({file,width:640,height:427,url:'blob:'+file.name}))}));
const detection=(token='test-score-snapshot-1234567890')=>({...raw,score_token:token,road_quality_score:scoreFixture(80,[],token),defects:[{...raw.defects[0],id:'A'},{...raw.defects[0],id:'B'}]}) as DefectDetection;
const select=async(result:{current:ReturnType<typeof useAnalysis>},name='road.jpg')=>act(async()=>result.current.select(new File(['native pixels'],name,{type:'image/jpeg'})));
const tick=async(ms=260)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms)});
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();vi.mocked(detectRoadDefects).mockResolvedValue(detection())});afterEach(()=>vi.useRealTimers());
describe('authoritative upload score lifecycle',()=>{
 it('automatically displays the backend score without a separate count-based calculation',async()=>{
  const {result}=renderHook(()=>useAnalysis());await select(result);expect(result.current.qualityScore).toBeNull();await tick();
  expect(result.current.qualityScore?.score).toBe(80);expect(rescoreRoad).not.toHaveBeenCalled();
 });
 it('recalculates exclusions via API and hides the stale score immediately',async()=>{
  vi.mocked(rescoreRoad).mockResolvedValue(scoreFixture(90,['A']));const {result}=renderHook(()=>useAnalysis());await select(result);await tick();
  act(()=>result.current.toggleDefect('A'));expect(result.current.qualityScore).toBeNull();await tick(190);
  expect(rescoreRoad).toHaveBeenCalledWith(detection().score_token,['A'],expect.any(AbortSignal));expect(result.current.qualityScore?.score).toBe(90);
 });
 it('ignores a late exclusion response after the reviewer changes back',async()=>{
  let finish!:(value:RoadQualityScore)=>void;vi.mocked(rescoreRoad).mockImplementationOnce(()=>new Promise(r=>{finish=r}));
  const {result}=renderHook(()=>useAnalysis());await select(result);await tick();act(()=>result.current.toggleDefect('A'));await tick(190);
  const signal=vi.mocked(rescoreRoad).mock.calls[0][2];act(()=>result.current.toggleDefect('A'));expect(signal?.aborted).toBe(true);
  await act(async()=>finish(scoreFixture(90,['A'])));expect(result.current.qualityScore?.score).toBe(80);
 });
 it('invalidates scores on source/footprint changes and reruns, with exclusions reset',async()=>{
  const {result}=renderHook(()=>useAnalysis());await select(result);await tick();
  act(()=>result.current.setRoadQuad([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]));expect(result.current.qualityScore).toBeNull();await tick();
  act(()=>result.current.retryDetection());expect(result.current.qualityScore).toBeNull();await tick();
  await select(result,'replacement.jpg');expect(result.current.qualityScore).toBeNull();await tick();expect(result.current.qualityScore?.image.width).toBe(640);
 });
 it('keeps detections but withholds stale scores when the review API fails',async()=>{
  vi.mocked(rescoreRoad).mockRejectedValue(new Error('Score evidence expired. Detect again.'));
  const {result}=renderHook(()=>useAnalysis());await select(result);await tick();act(()=>result.current.toggleDefect('A'));await tick(190);
  expect(result.current.qualityScore).toBeNull();expect(result.current.qualityScoreError).toContain('expired');expect(result.current.detection?.defects).toHaveLength(2);
 });
});
