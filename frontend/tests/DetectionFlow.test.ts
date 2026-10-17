vi.mock('../src/api/roadRegion',()=>({detectRoadRegion:vi.fn(async()=>null)}));
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalysis } from '../src/hooks/useAnalysis';
import {analyzeRoad} from '../src/api/roadQuality';
import {demoResult} from '../src/data/demo';
import { detectRoadDefects } from '../src/api/defects';
import response from './fixtures/pothole-detection.json';
import type { DefectDetection } from '../src/types/api';
vi.mock('../src/api/defects',()=>({detectRoadDefects:vi.fn()}));
vi.mock('../src/api/roadQuality',()=>({analyzeRoad:vi.fn()}));
vi.mock('../src/utils/imageValidation',async original=>{
  const value=await original<typeof import('../src/utils/imageValidation')>();
  return {...value,inspectImage:vi.fn(async(file:File)=>({file,width:640,height:427,url:'blob:'+file.name}))};
});
const detection=response as DefectDetection;
const select=async(result:{current:ReturnType<typeof useAnalysis>},name='road.jpg')=>act(async()=>result.current.select(new File(['pixels'],name,{type:'image/jpeg'})));
const dispatch=()=>act(async()=>{await vi.advanceTimersByTimeAsync(260)});
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks()});
afterEach(()=>vi.useRealTimers());
describe('automatic upload detection lifecycle',()=>{

  it('automatically requests complete texture/chip analysis and an overlay for the actual upload',async()=>{
    vi.mocked(detectRoadDefects).mockResolvedValue(detection);
    vi.mocked(analyzeRoad).mockResolvedValue({...demoResult,defect_detection:detection});
    const {result}=renderHook(()=>useAnalysis());await select(result);
    await act(async()=>{await vi.advanceTimersByTimeAsync(700)});
    expect(analyzeRoad).toHaveBeenCalledWith(expect.objectContaining({image:result.current.selected!.file,roadQuad:result.current.roadQuad,captureType:'road_scene',includeOverlay:true}),expect.any(AbortSignal));
    expect(result.current.result?.chip_candidate_count).toBe(demoResult.chip_candidate_count);
  });
  it('invalidates an analysis on road-region changes and ignores its stale response',async()=>{
    vi.mocked(detectRoadDefects).mockResolvedValue(detection);
    let finish!:(value:typeof demoResult)=>void;
    vi.mocked(analyzeRoad).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
    vi.mocked(analyzeRoad).mockResolvedValueOnce({...demoResult,chip_candidate_count:7});
    const {result}=renderHook(()=>useAnalysis());await select(result);
    await act(async()=>{await vi.advanceTimersByTimeAsync(700)});
    const signal=vi.mocked(analyzeRoad).mock.calls[0][1];
    act(()=>result.current.setRoadQuad([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]));
    expect(signal?.aborted).toBe(true);expect(result.current.result).toBeNull();
    await act(async()=>finish(demoResult));expect(result.current.result).toBeNull();
    await act(async()=>{await vi.advanceTimersByTimeAsync(700)});
    expect(result.current.result?.chip_candidate_count).toBe(7);
  });

  it('sends the actual file and road footprint after decode, without demo substitutes',async()=>{
    vi.mocked(detectRoadDefects).mockResolvedValue(detection);
    const {result}=renderHook(()=>useAnalysis());await select(result);
    expect(result.current.detection).toBeNull();expect(result.current.detectionBusy).toBe(true);
    await dispatch();
    expect(detectRoadDefects).toHaveBeenCalledWith(result.current.selected!.file,result.current.roadQuad,expect.any(AbortSignal),{mode:'model',confidence:.35,resolution:768});
    expect(result.current.detection).toBe(detection);expect(result.current.detectionBusy).toBe(false);
  });
  it('aborts old media and ignores its late geometry',async()=>{
    let resolve!:(d:DefectDetection)=>void;
    vi.mocked(detectRoadDefects).mockImplementationOnce(()=>new Promise(done=>{resolve=done}));
    vi.mocked(detectRoadDefects).mockResolvedValueOnce({...detection,defects:[]});
    const {result}=renderHook(()=>useAnalysis());await select(result,'old.jpg');await dispatch();
    const signal=vi.mocked(detectRoadDefects).mock.calls[0][2];
    await select(result,'new.jpg');expect(signal?.aborted).toBe(true);await dispatch();
    await act(async()=>resolve(detection));
    expect(result.current.detection?.defects).toEqual([]);expect(result.current.selected?.file.name).toBe('new.jpg');
  });
  it('redetects on footprint edits and resets rejected candidates',async()=>{
    vi.mocked(detectRoadDefects).mockResolvedValue(detection);
    const {result}=renderHook(()=>useAnalysis());await select(result);await dispatch();
    act(()=>result.current.toggleDefect(detection.defects[0].id));expect(result.current.excludedDefects).toHaveLength(1);
    act(()=>result.current.setRoadQuad([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]));
    expect(result.current.detection).toBeNull();expect(result.current.excludedDefects).toEqual([]);
    await dispatch();expect(detectRoadDefects).toHaveBeenCalledTimes(2);
  });
  it('surfaces detector failure and leaves geometry absent',async()=>{
    vi.mocked(detectRoadDefects).mockRejectedValue(new Error('Detector unavailable'));
    const {result}=renderHook(()=>useAnalysis());await select(result);await dispatch();
    expect(result.current.detection).toBeNull();expect(result.current.detectionError).toBe('Detector unavailable');
    act(()=>result.current.reset());expect(result.current.detection).toBeNull();
  });
});
