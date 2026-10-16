import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioLab } from '../src/components/ScenarioLab';
import { analyzeRoad } from '../src/api/roadQuality';
import { demoResult } from '../src/data/demo';
import type { AnalysisController } from '../src/hooks/useAnalysis';
import type { AnalysisResponse } from '../src/types/api';
vi.mock('../src/api/roadQuality',()=>({analyzeRoad:vi.fn()}));
vi.mock('../src/components/RoadCanvas',()=>({RoadCanvas:()=> <div>Road rendering isolated for state test</div>}));
vi.mock('../src/components/RoadAnnotations',()=>({RoadAnnotations:()=> <div>Annotation rendering isolated for state test</div>}));
vi.mock('../src/simulation/image',()=>{
  const canvas=()=>{const c=document.createElement('canvas');c.width=100;c.height=100;c.toDataURL=()=> 'data:image/png;base64,c2FtcGxl';return c};
  return {contrastHeatmap:canvas,sampleTexture:canvas,textureCanvas:canvas,scenarioTexture:canvas,weatherCanvas:canvas,
    weatherFootprint:()=>[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],canvasFile:async()=>new File(['pixels'],'simulation.png',{type:'image/png'}),downloadCanvas:vi.fn()};
});
const controller=()=>({selected:null,result:demoResult,errors:{},select:vi.fn()}) as unknown as AnalysisController;
const openWeather=()=>fireEvent.click(screen.getByRole('button',{name:'Weather lab',exact:true}));
beforeEach(()=>vi.clearAllMocks());
describe('simulation analysis lifecycle',()=>{
  it('uses two real API calls and preserves the original inspection controller',async()=>{
    const analysis=controller();
    vi.mocked(analyzeRoad).mockResolvedValue(demoResult);
    render(<ScenarioLab active demo selected="RH-001" onNavigate={vi.fn()} analysis={analysis}/>);
    openWeather();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Analyze original & altered images'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'}));
    await waitFor(()=>expect(screen.getByText('Simulation analysis complete.')).toBeInTheDocument());
    expect(analyzeRoad).toHaveBeenCalledTimes(2);
    expect(analysis.select).not.toHaveBeenCalled();
    expect(analysis.result).toBe(demoResult);
    for(const [input]of vi.mocked(analyzeRoad).mock.calls){
      expect(input.includeOverlay).toBe(true);expect(input.mmPerPixel).toBeUndefined();expect(input.pitchDegrees).toBeUndefined();
    }
  });
  it('cancels stale API comparisons when image-effect inputs change',async()=>{
    const resolvers:((r:AnalysisResponse)=>void)[]=[];
    vi.mocked(analyzeRoad).mockImplementation(()=>new Promise(resolve=>resolvers.push(resolve)));
    render(<ScenarioLab active demo selected="RH-001" onNavigate={vi.fn()} analysis={controller()}/>);
    openWeather();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Analyze original & altered images'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'}));
    await waitFor(()=>expect(analyzeRoad).toHaveBeenCalledTimes(2));
    const signals=vi.mocked(analyzeRoad).mock.calls.map(call=>call[1]);
    fireEvent.click(screen.getByRole('button',{name:'Shadow',exact:true}));
    expect(signals.every(signal=>signal?.aborted)).toBe(true);
    await act(async()=>{resolvers.forEach(resolve=>resolve(demoResult))});
    expect(screen.queryByText('Simulation analysis complete.')).not.toBeInTheDocument();
    expect(screen.queryByText('Reference image',{exact:true})).not.toBeInTheDocument();
  });
  it('renders unassessable returned scores without replacing them with zero',async()=>{
    vi.mocked(analyzeRoad).mockResolvedValue({...demoResult,assessment:{...demoResult.assessment,road_quality_index:null,band:'unassessable'}});
    render(<ScenarioLab active demo selected="RH-001" onNavigate={vi.fn()} analysis={controller()}/>);
    openWeather();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Analyze original & altered images'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'}));
    await waitFor(()=>expect(screen.getAllByText('Unable to assess')).toHaveLength(2));
    expect(screen.queryByText('0.0 / 100')).not.toBeInTheDocument();
  });
});
