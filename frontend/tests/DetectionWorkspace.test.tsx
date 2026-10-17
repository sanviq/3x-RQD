import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DetectionWorkspace} from '../src/components/DetectionWorkspace';
import {detectorStatus,inspectDefects} from '../src/api/roadHealth';
import type {DetectorStatus} from '../src/api/roadHealth';
vi.mock('../src/components/DatasetGallery',()=>({DatasetGallery:()=>null}));
vi.mock('../src/components/InclinationTool',()=>({InclinationTool:()=>null}));
vi.mock('../src/api/roadHealth',async()=>({...await vi.importActual('../src/api/roadHealth'),detectorStatus:vi.fn(),inspectDefects:vi.fn()}));
const status=(configured=true):DetectorStatus=>({model:{configured,loaded:false,mode:configured?'model':'demo',requires:'local weights',supported_classes:['crack','pothole'],source:'interactive_experimental_preview',qualified:false,confidence:.35,imgsz:768,notice:'Experimental trained model; qualification failed. Review predictions.'},edge:'cpu',storage:'local'});
const image=new File(['fixture-image-not-decoded-in-this-mocked-client-test'],'road.jpg',{type:'image/jpeg'});
beforeEach(()=>{vi.stubEnv('VITE_ENABLE_DEMOS','true');vi.mocked(detectorStatus).mockReset();vi.mocked(inspectDefects).mockReset();vi.mocked(inspectDefects).mockRejectedValue(new Error('Mock request complete'));});
afterEach(()=>vi.unstubAllEnvs());
describe('explicit real-photo detection',()=>{
 it('uses the available trained model and its evaluated resolution instead of fixture annotations',async()=>{
  vi.mocked(detectorStatus).mockResolvedValue(status());
  render(<DetectionWorkspace image={image} scale="" pitch=""/>);
  const button=await screen.findByRole('button',{name:'Run trained detector'});
  expect(screen.getByLabelText('Defect detection mode')).toHaveValue('model');
  expect(screen.getByLabelText('Detection processing resolution')).toHaveValue('768');
  await userEvent.click(button);
  await waitFor(()=>expect(inspectDefects).toHaveBeenCalledOnce());
  const form=vi.mocked(inspectDefects).mock.calls[0][0];
  expect(form.get('mode')).toBe('model');expect(form.get('resolution')).toBe('768');expect(form.get('image')).toBe(image);
 });
 it('explains an unavailable model and disables model inference without silently falling back',async()=>{
  vi.mocked(detectorStatus).mockResolvedValue(status(false));
  render(<DetectionWorkspace image={image} scale="" pitch=""/>);
  await screen.findByText('Trained detector unavailable');
  expect(screen.getByText(/No trained detector is available on this server/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Run trained detector'})).toBeDisabled();
  expect(inspectDefects).not.toHaveBeenCalled();
 });
 it('preserves an explicit demo choice when a model-status response arrives late',async()=>{
  let resolve!:(value:DetectorStatus)=>void;
  vi.mocked(detectorStatus).mockReturnValue(new Promise(done=>{resolve=done}));
  render(<DetectionWorkspace image={image} scale="" pitch=""/>);
  fireEvent.change(screen.getByLabelText('Defect detection mode'),{target:{value:'demo'}});
  await act(async()=>resolve(status()));
  expect(screen.getByLabelText('Defect detection mode')).toHaveValue('demo');
  expect(screen.getByRole('button',{name:'Generate demo annotations'})).toBeEnabled();
 });
 it('lets an unavailable status connection recover without losing the selected file',async()=>{
  vi.mocked(detectorStatus).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(status());
  render(<DetectionWorkspace image={image} scale="" pitch=""/>);
  await userEvent.click(await screen.findByRole('button',{name:'Retry detector connection'}));
  await screen.findByRole('button',{name:'Run trained detector'});
  expect(screen.getByText('Selected capture: road.jpg')).toBeInTheDocument();
 });
});
