
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NativeWeatherLab} from '../src/components/NativeWeatherLab';
import {compareWeather} from '../src/api/weatherComparison';
import type {WeatherComparison} from '../src/api/weatherComparison';
import {weatherFixture} from './fixtures/weather';
import {fullQuad} from '../src/simulation/projection';
vi.mock('../src/api/weatherComparison',async original=>({...await original<typeof import('../src/api/weatherComparison')>(),compareWeather:vi.fn()}));
const props=()=>({capture:{file:new File(['native'],'road.jpg'),url:'blob:original',width:640,height:427},quad:fullQuad});
beforeEach(()=>vi.clearAllMocks());
describe('native weather upload workflow',()=>{
 it('does not substitute duplicate images before actual analysis and uses returned evidence',async()=>{
   vi.mocked(compareWeather).mockResolvedValue(weatherFixture());const p=props();render(<NativeWeatherLab {...p}/>);
   expect(screen.getAllByRole('img')).toHaveLength(1);expect(compareWeather).not.toHaveBeenCalled();
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'})));
   expect(compareWeather).toHaveBeenCalledWith(p.capture.file,p.quad,['rain'],.5,true,undefined,expect.any(AbortSignal));
   expect(screen.getAllByRole('img')).toHaveLength(2);
   expect(screen.getByAltText('Rain altered road at original resolution')).toHaveAttribute('src','/api/weather-evidence/test/rain.png');
   expect(screen.getByRole('table',{name:'Weather robustness metrics'})).toHaveTextContent('No ground truth');
 });
 it('requests every condition independently in a single native API batch',async()=>{
   vi.mocked(compareWeather).mockResolvedValue(weatherFixture());render(<NativeWeatherLab {...props()}/>);
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Analyze all seven conditions'})));
   expect(vi.mocked(compareWeather).mock.calls[0][2]).toEqual(['rain','puddles','shadow','low_light','glare','blur','perspective']);
 });
 it('discards late results after the source or intensity changes',async()=>{
   let finish!:(v:WeatherComparison)=>void;vi.mocked(compareWeather).mockImplementation(()=>new Promise(r=>{finish=r}));
   const p=props();const view=render(<NativeWeatherLab {...p}/>);
   fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'}));
   const signal=vi.mocked(compareWeather).mock.calls[0][6];
   fireEvent.change(screen.getByLabelText('Native weather intensity'),{target:{value:'80'}});
   expect(signal?.aborted).toBe(true);await act(async()=>finish(weatherFixture()));
   expect(screen.queryByRole('table',{name:'Weather robustness metrics'})).not.toBeInTheDocument();
   view.rerender(<NativeWeatherLab {...p} capture={{...p.capture,file:new File(['other'],'other.jpg')}}/>);
   expect(screen.getAllByRole('img')).toHaveLength(1);
 });
 it('keeps original upload visible and permits retry after backend failure',async()=>{
   vi.mocked(compareWeather).mockRejectedValueOnce(new Error('Server busy')).mockResolvedValueOnce(weatherFixture());
   render(<NativeWeatherLab {...props()}/>);
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'})));
   expect(screen.getByRole('alert')).toHaveTextContent('Server busy');expect(screen.getAllByRole('img')).toHaveLength(1);
   await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Analyze original & altered images'})));
   expect(screen.queryByRole('alert')).not.toBeInTheDocument();
   const table=screen.getByRole('table',{name:'Condition defect measurements'});expect(within(table).getByText(/uncalibrated/)).toBeInTheDocument();
 });
});
