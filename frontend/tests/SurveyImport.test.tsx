import {act,fireEvent,render,screen} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {SurveyImport} from '../src/components/SurveyImport';
import {request} from '../src/api/client';
vi.mock('../src/api/client',()=>({request:vi.fn()}));
const review={saved:false,count:1,defects:0,declared_distance_m:100,notice:'User-supplied records; not independently verified.',records:[{id:'A',name:'Actual team record',latitude:12,longitude:77,provenance:'model',defects:0}]};
describe('GPS survey import review',()=>{
 it('requires preview and an explicit save and invalidates preview after edits',async()=>{
  vi.mocked(request).mockResolvedValue(review);const imported=vi.fn();render(<SurveyImport onImported={imported}/>);
  expect(screen.queryByRole('button',{name:'Save 1 records locally'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GPS inspection JSON'),{target:{value:'{"segments": [{"id":"A"}]}'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Preview import'}))});
  expect(vi.mocked(request).mock.calls.at(-1)?.[0]).toBe('/segments/import/preview');
  expect(imported).not.toHaveBeenCalled();expect(screen.getByText('A · Actual team record')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GPS inspection JSON'),{target:{value:'{"segments": []}'}});
  expect(screen.queryByRole('button',{name:'Save 1 records locally'})).not.toBeInTheDocument();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Preview import'}))});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save 1 records locally'}))});
  expect(vi.mocked(request).mock.calls.at(-1)?.[0]).toBe('/segments/import');expect(imported).toHaveBeenCalledOnce();
 });
 it('shows validation errors and does not save records',async()=>{
  vi.mocked(request).mockRejectedValue(new Error('Existing segment IDs would be overwritten'));
  const imported=vi.fn();render(<SurveyImport onImported={imported}/>);
  fireEvent.change(screen.getByLabelText('GPS inspection JSON'),{target:{value:'{}'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Preview import'}))});
  expect(screen.getByRole('alert')).toHaveTextContent('would be overwritten');expect(imported).not.toHaveBeenCalled();
 });
});
