import {renderHook,act,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {useMappedRoads} from '../src/hooks/useMappedRoads';
import {mapFixture,mapConfig} from './fixtures/mapNetwork';
vi.mock('../src/api/map',async importOriginal=>({...await importOriginal<typeof import('../src/api/map')>(),getMapConfig:vi.fn(),getMappedNetwork:vi.fn(),fetchMappedRoads:vi.fn()}));
import {getMapConfig,getMappedNetwork,fetchMappedRoads} from '../src/api/map';
const bounds={south:12.97,north:12.98,west:77.59,east:77.60};
describe('mapped road lifecycle',()=>{
 it('loads backend evidence and preserves it when a provider fails',async()=>{vi.mocked(getMapConfig).mockResolvedValue(mapConfig);vi.mocked(getMappedNetwork).mockResolvedValue(mapFixture());vi.mocked(fetchMappedRoads).mockRejectedValue(new Error('Provider offline'));const {result}=renderHook(()=>useMappedRoads());await waitFor(()=>expect(result.current.network?.segments.length).toBe(1));await act(()=>result.current.load(bounds));expect(result.current.error).toBe('Provider offline');expect(result.current.network!.segments[0].inspection!.score.score).toBe(80)});
 it('ignores geometry responses from an older viewport',async()=>{vi.mocked(getMapConfig).mockResolvedValue(mapConfig);vi.mocked(getMappedNetwork).mockResolvedValue(mapFixture());let finish!:(v:ReturnType<typeof mapFixture>)=>void;vi.mocked(fetchMappedRoads).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({...mapFixture(false),segments:mapFixture(false).segments.map(s=>({...s,id:'new-road'}))});const {result}=renderHook(()=>useMappedRoads());await waitFor(()=>expect(result.current.busy).toBe(false));let first!:Promise<void>;act(()=>{first=result.current.load(bounds)});await act(()=>result.current.load(bounds));await act(async()=>{finish(mapFixture());await first});expect(result.current.network!.segments[0].id).toBe('new-road')});
});
