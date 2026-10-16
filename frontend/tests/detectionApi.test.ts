import { afterEach, describe, expect, it, vi } from 'vitest';
import { baselineFor, detectionForm, inspectDefects } from '../src/api/roadHealth';
import type { DetectionResult } from '../src/api/roadHealth';
afterEach(()=>vi.unstubAllGlobals());
describe('additive detection API contract',()=>{
 it('preserves zero IMU input, optional roll and original-image scale',()=>{
  const form=detectionForm({mode:'model',confidence:.6,resolution:320,scale:'0.5',pitch:'0',roll:'2'},new Blob(['x'],{type:'image/png'}));
  expect(form.get('mm_per_pixel')).toBe('0.5');
  expect(JSON.parse(String(form.get('inclination_json')))).toEqual({source:'imu',pitch:0,roll:2});
  expect(form.get('resolution')).toBe('320');
  expect(form.get('mode')).toBe('model');
 });
 it('preserves estimated inclination provenance instead of silently relabeling it as IMU',()=>{
  const inclination={source:'elevation',elevation_start_m:10,elevation_end_m:15,horizontal_distance_m:100};
  const form=detectionForm({mode:'demo',confidence:.35,resolution:640,pitch:'0',inclination});
  expect(JSON.parse(String(form.get('inclination_json')))).toEqual(inclination);
 });
 it('surfaces unavailable model errors instead of falling back to fabricated detections',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'No trained road-defect model configured.'}),{status:422})));
  await expect(inspectDefects(detectionForm({mode:'model',confidence:.35,resolution:640}))).rejects.toThrow('No trained road-defect model configured.');
 });
 it('strips derived physical measurements when reusing model annotations for scoring',()=>{
  const defect={id:'a',class_name:'pothole',confidence:.8,bbox:[.1,.1,.3,.3],polygon:[],severity:.7,track_id:null,depth_mm:null,depth_source:null,area_fraction:.04,area_m2:2,width_mm:200,height_mm:100,area_method:'bounding_box_estimate'};
  const data={width:960,height:640,assessment:{defects:[defect],configuration:{major:35}}} as unknown as DetectionResult;
  const baseline=baselineFor(data,'','0');
  expect(baseline.defects[0]).not.toHaveProperty('area_m2');
  expect(baseline.defects[0].bbox).toEqual(defect.bbox);
  expect(baseline.inclination).toEqual({source:'imu',pitch:0,roll:null});
  expect(baseline.mm_per_pixel).toBeNull();
 });
});
