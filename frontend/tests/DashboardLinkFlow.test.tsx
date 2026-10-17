import {useState} from 'react';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {InspectionDashboard} from '../src/components/InspectionDashboard';
import {InspectionRoadNetwork} from '../src/components/InspectionRoadNetwork';
import {useMappedRoads} from '../src/hooks/useMappedRoads';
import type {AnalysisController} from '../src/hooks/useAnalysis';
import type {Page} from '../src/types/api';
import {mapFixture,mapConfig} from './fixtures/mapNetwork';
import {scoreFixture} from './fixtures/qualityScore';

vi.mock('../src/components/GeographicRoadMap',()=>({GeographicRoadMap:()=> <div>Test map</div>}));
vi.mock('../src/api/map',async importOriginal=>({...await importOriginal<typeof import('../src/api/map')>(),getMapConfig:vi.fn(),getMappedNetwork:vi.fn(),fetchMappedRoads:vi.fn(),attachMapInspection:vi.fn()}));
import {getMapConfig,getMappedNetwork,attachMapInspection} from '../src/api/map';

// Synthetic evidence and location used only in this mocked lifecycle test.
const score=scoreFixture();
const photo={file:new File(['synthetic fixture'],'test-road.jpg',{type:'image/jpeg'}),url:'blob:fixture',width:640,height:427};
const analyzed={selected:photo,qualityScore:score,qualityScoreBusy:false,detectionBusy:false,detection:{score_token:score.snapshot_id},detectionError:'',qualityScoreError:''} as unknown as AnalysisController;
function Workspace({analysis=analyzed}:{analysis?:AnalysisController}){
 const roads=useMappedRoads();
 const [page,setPage]=useState<Page>('overview');
 return page==='overview'?<InspectionDashboard roads={roads} analysis={analysis} onNavigate={setPage}/>:page==='network'?<InspectionRoadNetwork roads={roads} analysis={analysis} onInspect={()=>setPage('inspection')} onOverview={()=>setPage('overview')}/>:<h1>Review surface inspection</h1>;
}
beforeEach(()=>{
 vi.clearAllMocks();
 vi.mocked(getMapConfig).mockResolvedValue(mapConfig);
 vi.mocked(getMappedNetwork).mockResolvedValue(mapFixture(false));
 vi.mocked(attachMapInspection).mockResolvedValue(mapFixture());
});

describe('overview to saved inspection',()=>{
 it('keeps an analyzed but unsaved photo out of the network totals',async()=>{
  render(<Workspace/>);
  await screen.findByText(/OSM 1/);
  expect(screen.getByText('Not saved to a road')).toBeInTheDocument();
  const total=screen.getByText('Detected candidates').closest('article')!;
  expect(within(total).getByText('—')).toBeInTheDocument();
  expect(screen.getByText(/2 retained candidates · 80.0/)).toBeInTheDocument();
  expect(attachMapInspection).not.toHaveBeenCalled();
 });
 it('saves only after location confirmation and returns to updated overview totals',async()=>{
  render(<Workspace/>);
  await screen.findByText(/OSM 1/);
  fireEvent.click(screen.getByRole('button',{name:/OSM 1/}));
  expect(screen.getByRole('heading',{name:'Road network.'})).toBeInTheDocument();
  const save=screen.getByRole('button',{name:'Save inspection to this road'});
  expect(save).toBeDisabled();
  expect(screen.getByText(/Confirm that the photo belongs to this road to enable saving/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox',{name:/I confirm this capture belongs/}));
  expect(save).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed the candidate outlines/}));
  fireEvent.click(save);
  await screen.findByText(/Inspection saved to Fixture Road/);
  expect(attachMapInspection).toHaveBeenCalledWith('osm-way-1-10-11',analyzed,[12.9716,77.5956],true,true);
  fireEvent.click(screen.getByRole('button',{name:'View updated overview'}));
  const total=screen.getByText('Detected candidates').closest('article')!;
  expect(within(total).getByText('2')).toBeInTheDocument();
  expect(screen.queryByText('Not saved to a road')).toBeNull();
  expect(within(screen.getByText('Average road quality').closest('article')!).getByText('80.0')).toBeInTheDocument();
 });
 it('keeps failed saves visible and does not claim the dashboard was updated',async()=>{
  vi.mocked(attachMapInspection).mockRejectedValue(new Error('Evidence expired. Detect again.'));
  render(<Workspace/>);
  await screen.findByText(/OSM 1/);
  fireEvent.click(screen.getByRole('button',{name:'Choose the correct road'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/I confirm this capture belongs/}));
  fireEvent.click(screen.getByRole('button',{name:'Save inspection to this road'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Evidence expired. Detect again.');
  expect(screen.queryByRole('button',{name:'View updated overview'})).toBeNull();
 });
 it('takes a failed analysis back to inspection instead of claiming it is ready',async()=>{
  render(<Workspace analysis={{...analyzed,qualityScore:null,detectionError:'Detector unavailable'}}/>);
  await screen.findByText(/OSM 1/);
  expect(screen.getByText(/Analysis needs attention/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Open Surface inspection'}));
  expect(screen.getByRole('heading',{name:'Review surface inspection'})).toBeInTheDocument();
 });
 it('requires analysis matching the current score before allowing a save',async()=>{
  render(<Workspace analysis={{...analyzed,detection:{...analyzed.detection!,score_token:'different-evidence'}}}/>);
  await screen.findByText(/OSM 1/);
  fireEvent.click(screen.getByRole('button',{name:'Choose the correct road'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/I confirm this capture belongs/}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save inspection to this road'})).toBeDisabled());
  expect(attachMapInspection).not.toHaveBeenCalled();
 });
});
