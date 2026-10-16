
import {describe,it,expect,vi,afterEach} from 'vitest';
import {compareWeather,isWeatherComparison} from '../src/api/weatherComparison';
import {weatherFixture} from './fixtures/weather';
import {fullQuad} from '../src/simulation/projection';
afterEach(()=>vi.unstubAllGlobals());
describe('native weather API contract',()=>{
 it('accepts complete native evidence, rejects resized or invalid geometry',()=>{
   const a=weatherFixture('perspective',1739,1081);expect(isWeatherComparison(a)).toBe(true);
   expect(isWeatherComparison({...a,frames:[{...a.frames[0],width:1024}]})).toBe(false);
   a.frames[0].defects[0].frame_polygon[0][0]=2000;expect(isWeatherComparison(a)).toBe(false);
 });
 it('rejects accuracy metrics when no known annotations exist',()=>{
   const a=weatherFixture();a.frames[0].metrics.f1=.9;expect(isWeatherComparison(a)).toBe(false);
 });
 it('rejects invented physical dimensions and calibrated confidence',()=>{
   const a=weatherFixture();expect(isWeatherComparison({...a,frames:[{...a.frames[0],defects:[{...a.frames[0].defects[0],physical_dimensions:{depth:30}}]}]})).toBe(false);
   a.frames[0].defects[0].confidence=NaN;expect(isWeatherComparison(a)).toBe(false);
 });
 it('uploads the actual original File with native road geometry and annotation provenance',async()=>{
   const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify(weatherFixture())));vi.stubGlobal('fetch',mock);
   const file=new File(['unchanged native bytes'],'source.jpg',{type:'image/jpeg'});
   await compareWeather(file,fullQuad,['rain'],.7,true,'[]');
   const [url,init]=mock.mock.calls[0];expect(url).toBe('/api/weather-compare');
   const body=init.body as FormData;expect(body.get('image')).toBe(file);expect(body.get('road_quad')).toBe(JSON.stringify(fullQuad));
   expect(body.get('annotations_json')).toBe('[]');expect(body.get('conditions_json')).toBe('["rain"]');
 });
 it('handles incompatible server evidence instead of fabricating a comparison',async()=>{
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({frames:[]}))));
   await expect(compareWeather(new File(['x'],'x.jpg'),fullQuad,['blur'],.5,false,undefined)).rejects.toThrow('incompatible native-resolution evidence');
 });
});
