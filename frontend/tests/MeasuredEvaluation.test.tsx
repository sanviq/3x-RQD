import {act,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {MeasuredEvaluation} from '../src/components/MeasuredEvaluation';
import {request} from '../src/api/client';
vi.mock('../src/api/client',()=>({request:vi.fn()}));
const metrics={images:10,checkpoint_sha256:'fixture',ultralytics_metrics:{'metrics/mAP50(B)':.3,'metrics/mAP50-95(B)':.1},diagnostic:{precision:.5,recall:.3,f1:.375,confidence:.35,tp:3,fp:3,fn:7},per_class_metrics:{}};
afterEach(()=>vi.useRealTimers());
describe('live training and final results',()=>{
 it('labels interim metrics and refreshes final results without reopening the page',async()=>{
  vi.useFakeTimers();let complete=false;
  vi.mocked(request).mockImplementation(async path=>path.includes('training-status')?
   {phase:complete?'complete':'training',completed_epochs:16,target_epochs:50,latest_validation:{epoch:16,precision:.395,recall:.329,map50:.278,map50_95:.112},estimated_training_seconds_remaining:120}:
   {run:complete?'improvement-v2':'compact-v1',test:metrics,validation:metrics,activation:{enabled:false},release_url:'#'});
  await act(async()=>{render(<MeasuredEvaluation/>)});
  expect(screen.getByLabelText('Interim training validation')).toHaveTextContent('39.5%');
  expect(screen.getByText('compact-v1')).toBeInTheDocument();
  complete=true;await act(async()=>{await vi.advanceTimersByTimeAsync(30000)});
  expect(screen.getByText('improvement-v2')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('complete');
  expect(screen.queryByLabelText('Interim training validation')).not.toBeInTheDocument();
 });
 it('warns when the heartbeat is stale',async()=>{
  vi.mocked(request).mockImplementation(async path=>path.includes('training-status')?{phase:'training',heartbeat_stale:true}:{run:'compact-v1',test:metrics,validation:metrics,activation:{},release_url:'#'});
  await act(async()=>{render(<MeasuredEvaluation/>)});
  expect(screen.getByText(/Training status has not updated recently/)).toBeInTheDocument();
 });
 it('does not describe a completed job as paused when its heartbeat ages',async()=>{
  vi.mocked(request).mockImplementation(async path=>path.includes('training-status')?{phase:'complete',heartbeat_stale:true}:{run:'improvement-v2',test:metrics,validation:metrics,activation:{},release_url:'#'});
  await act(async()=>{render(<MeasuredEvaluation/>)});
  expect(screen.getByRole('status')).toHaveTextContent('complete');
  expect(screen.queryByText(/Training status has not updated recently/)).not.toBeInTheDocument();
 });
});
