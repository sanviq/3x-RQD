import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {InspectionDashboard} from '../src/components/InspectionDashboard';
import {InspectionRoadNetwork} from '../src/components/InspectionRoadNetwork';
import {EvidenceRepairPlanner} from '../src/components/EvidenceRepairPlanner';
import {mapFixture,mapConfig} from './fixtures/mapNetwork';
import type {MappedRoadsController} from '../src/hooks/useMappedRoads';
import type {AnalysisController} from '../src/hooks/useAnalysis';
vi.mock('../src/components/GeographicRoadMap',()=>({GeographicRoadMap:()=> <div>Leaflet map fixture</div>}));
function roads(inspected=true):MappedRoadsController{return{network:mapFixture(inspected),config:mapConfig,selected:'osm-way-1-10-11',setSelected:vi.fn(),error:'',busy:false,refresh:vi.fn(),load:vi.fn(),saving:false,saveError:'',attach:vi.fn()}};
describe('real inspection dashboard',()=>{
 it('shows unknown roads without sample scores or defect totals',()=>{render(<InspectionDashboard roads={roads(false)} onNavigate={vi.fn()}/>);expect(screen.getAllByText('Not inspected').length).toBeGreaterThan(0);expect(screen.getByText(/No inspection-backed scores yet/)).toBeInTheDocument();expect(screen.queryByText(/Six sample segments/)).toBeNull();expect(screen.getAllByText('—').length).toBeGreaterThan(1)});
 it('shows actual linked score and inspection evidence',()=>{render(<InspectionDashboard roads={roads()} onNavigate={vi.fn()}/>);expect(screen.getByRole('img',{name:'Uploaded road with detected regions outlined'})).toBeInTheDocument();expect(screen.getAllByText(/80\.0/).length).toBeGreaterThan(0);expect(screen.getAllByText(/Provisional|provisional/).length).toBeGreaterThan(0)});
 it('selects a real road from an inspection card',()=>{const r=roads();render(<InspectionDashboard roads={r} onNavigate={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/OSM 1/}));expect(r.setSelected).toHaveBeenCalledWith('osm-way-1-10-11')});
 it('filters missing inspections independently of Good ratings',()=>{render(<InspectionDashboard roads={roads()} onNavigate={vi.fn()}/>);fireEvent.change(screen.getByRole('combobox',{name:'Filter inspection condition'}),{target:{value:'Not inspected'}});expect(screen.getByText('No roads match this filter.')).toBeInTheDocument()});
 it('requires an explicit road-location confirmation before saving',()=>{const r=roads(false);render(<InspectionRoadNetwork roads={r} analysis={{selected:null,qualityScore:null} as unknown as AnalysisController} onInspect={vi.fn()}/>);expect(screen.getByRole('button',{name:'Save inspection to this road'})).toBeDisabled();expect(screen.getByText(/They are not image-derived GPS/)).toBeInTheDocument()});
 it('does not invent repair prices or post-repair scores',()=>{render(<EvidenceRepairPlanner roads={roads()} onNetwork={vi.fn()}/>);expect(screen.getByText(/no invented repair prices/i)).toBeInTheDocument();expect(screen.queryByText('After repair')).toBeNull()});
});
