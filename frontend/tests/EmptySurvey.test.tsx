import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {LiveNetwork} from '../src/components/LiveNetwork';
import {loadRoads} from '../src/api/roadHealth';
vi.mock('../src/api/roadHealth',()=>({loadRoads:vi.fn()}));
describe('empty live survey',()=>{
 it('offers explicit demo navigation without manufacturing saved records',async()=>{
  vi.mocked(loadRoads).mockResolvedValue({segments:[]} as unknown as Awaited<ReturnType<typeof loadRoads>>);
  const navigate=vi.fn(),demo=vi.fn();render(<LiveNetwork onNavigate={navigate} onExploreDemo={demo} compact/>);
  await screen.findByText('Start your road survey');
  expect(screen.getAllByText('Not assessed')).toHaveLength(2);
  expect(screen.getByText(/training does not automatically populate/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Explore demo dashboard'}));expect(demo).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Inspect & save a road'}));expect(navigate).toHaveBeenCalledWith('inspection');
 });
 it('does not invent zero counts when the service cannot load the survey',async()=>{
  vi.mocked(loadRoads).mockRejectedValue(new Error('Service unavailable'));
  render(<LiveNetwork onNavigate={vi.fn()}/>);await screen.findByText('Local survey unavailable');
  expect(screen.queryByText('0 km')).not.toBeInTheDocument();
 });
});
