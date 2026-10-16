
import {act,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {RepairPhotoViews} from '../src/components/RepairPhotoViews';
import {renderRepairPhotos} from '../src/api/repairPhotos';
import type {RepairPhotoResult} from '../src/api/repairPhotos';
import type {Mark} from '../src/simulation/model';
import {fullQuad} from '../src/simulation/projection';
vi.mock('../src/api/repairPhotos',async original=>({...await original<typeof import('../src/api/repairPhotos')>(),renderRepairPhotos:vi.fn()}));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const fixture=(months=6)=>({version:'repair-photo-v1',images:{source:png,original:png,repaired:png,predicted:png},
  masks:{repair:png,prediction:png},image:{width:640,height:427,original_width:640,original_height:427},
  settings:{months},engine_used:'opencv_telea',fallback_reason:'No local model',repair_count:1,
  simulated:true,forecast_validated:false,warnings:['Visual simulation only.'],defects:[]}) as unknown as RepairPhotoResult;
const mark={id:'CV1',kind:'Pothole',x:.5,y:.6,width:.2,length:.1,depthMm:40,severity:1,visualSeverity:.7,repaired:true,provenance:'detected'} as Mark;
const props=()=>({file:new File(['pixels'],'road.jpg'),quad:fullQuad,marks:[mark],months:6,growth:{depth:.03,size:.015},onMonths:vi.fn()});
const tick=()=>act(async()=>{await vi.advanceTimersByTimeAsync(410)});
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks()});afterEach(()=>vi.useRealTimers());
describe('photo repair workflow',()=>{
  it('automatically calls the actual photo renderer with selected defects and current assumptions',async()=>{
    vi.mocked(renderRepairPhotos).mockResolvedValue(fixture());const p=props();render(<RepairPhotoViews {...p}/>);
    expect(screen.queryByAltText('Same uploaded road with selected potholes filled with asphalt patches')).not.toBeInTheDocument();
    await tick();
    expect(renderRepairPhotos).toHaveBeenCalledWith(p.file,p.quad,p.marks,expect.objectContaining({months:6,repair_quality:.8,traffic:'normal',weather:'seasonal',engine:'auto'}),expect.any(AbortSignal),undefined);
    expect(screen.getByAltText('Original uploaded road with detected defect outlines')).toBeInTheDocument();
    expect(screen.getByAltText('Same uploaded road with selected potholes filled with asphalt patches')).toBeInTheDocument();
    expect(screen.getByAltText('Simulated road after 6 months')).toBeInTheDocument();
  });
  it('exposes 3/6/12 horizons and rerenders after traffic/quality changes',async()=>{
    vi.mocked(renderRepairPhotos).mockResolvedValue(fixture());const p=props();render(<RepairPhotoViews {...p}/>);await tick();
    fireEvent.click(screen.getByRole('button',{name:'12 months',exact:true}));expect(p.onMonths).toHaveBeenCalledWith(12);
    fireEvent.change(screen.getByLabelText('Photo traffic assumption'),{target:{value:'heavy'}});
    fireEvent.change(screen.getByLabelText('Photo repair quality'),{target:{value:'.25'}});await tick();
    expect(vi.mocked(renderRepairPhotos).mock.calls.at(-1)![3]).toMatchObject({traffic:'heavy',repair_quality:.25});
  });
  it('aborts stale results and never relabels a previous horizon as the new one',async()=>{
    let finish!:(v:RepairPhotoResult)=>void;
    vi.mocked(renderRepairPhotos).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));
    vi.mocked(renderRepairPhotos).mockResolvedValueOnce(fixture(12));const p=props();
    const view=render(<RepairPhotoViews {...p}/>);await tick();const signal=vi.mocked(renderRepairPhotos).mock.calls[0][4];
    view.rerender(<RepairPhotoViews {...p} months={12}/>);expect(signal?.aborted).toBe(true);
    await tick();await act(async()=>finish(fixture(6)));
    expect(screen.getByAltText('Simulated road after 12 months')).toBeInTheDocument();
    expect(screen.queryByAltText('Simulated road after 6 months')).not.toBeInTheDocument();
  });
  it('reports backend failures without inserting copies of the uploaded image',async()=>{
    vi.mocked(renderRepairPhotos).mockRejectedValue(new Error('Renderer unavailable'));
    render(<RepairPhotoViews {...props()}/>);await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Renderer unavailable');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Retry photo rendering'})).toBeInTheDocument();
  });
});
