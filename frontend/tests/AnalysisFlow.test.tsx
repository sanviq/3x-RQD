vi.mock('../src/api/roadRegion',()=>({detectRoadRegion:vi.fn(async()=>null)}));
import { act, renderHook, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAnalysis } from '../src/hooks/useAnalysis';
import { AnalysisResults } from '../src/components/AnalysisResults';
import { demoResult } from '../src/data/demo';
import { analyzeRoad } from '../src/api/roadQuality';
import { inspectImage } from '../src/utils/imageValidation';
vi.mock('../src/api/roadQuality',()=>({analyzeRoad:vi.fn()}));
vi.mock('../src/utils/imageValidation',async importOriginal=>{
  const original=await importOriginal<typeof import('../src/utils/imageValidation')>();
  return {...original,inspectImage:vi.fn(async(file:File)=>({file,width:100,height:100,url:'blob:'+file.name}))};
});
describe('analysis lifecycle',()=>{
  it('ignores an old response when calibration changes during a request',async()=>{
    let resolve!:(value:typeof demoResult)=>void;
    vi.mocked(analyzeRoad).mockImplementation(()=>new Promise(done=>{resolve=done}));
    const {result}=renderHook(()=>useAnalysis());
    await act(async()=>{await result.current.select(new File(['x'],'road.png',{type:'image/png'}))});
    let submission!:Promise<void>;
    act(()=>{submission=result.current.submit()});
    expect(result.current.busy).toBe(true);
    const signal=vi.mocked(analyzeRoad).mock.calls.at(-1)?.[1];
    act(()=>result.current.setScale('.5'));
    expect(signal?.aborted).toBe(true);
    await act(async()=>{resolve(demoResult);await submission});
    expect(result.current.result).toBeNull();
    expect(result.current.scale).toBe('.5');
    expect(result.current.selected?.file.name).toBe('road.png');
  });
  it('cancels selection decode on reset and releases its late preview',async()=>{
    let resolve!:(value:Awaited<ReturnType<typeof inspectImage>>)=>void;
    vi.mocked(inspectImage).mockImplementationOnce(()=>new Promise(done=>{resolve=done}));
    const {result}=renderHook(()=>useAnalysis());
    let selection!:Promise<void>;
    act(()=>{selection=result.current.select(new File(['x'],'late.png'))});
    act(()=>result.current.reset());
    await act(async()=>{resolve({file:new File(['x'],'late.png'),width:100,height:100,url:'blob:late'});await selection});
    expect(result.current.selected).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
  });
});
describe('truthful result presentation',()=>{
  it('shows null score as unable to assess, while retaining valid zero measurements',()=>{
    render(<AnalysisResults result={{...demoResult,assessment:{...demoResult.assessment,road_quality_index:null,band:'unassessable'},physical_measurements:{...demoResult.physical_measurements,area_sq_ft:0},inclination:{degrees:0,source:'user_supplied_sensor'}}}/>);
    expect(screen.getAllByText('Unable to assess').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('0.00°')).toBeInTheDocument();
    for(const warning of demoResult.warnings)expect(screen.getByText(warning)).toBeInTheDocument();
  });
});
