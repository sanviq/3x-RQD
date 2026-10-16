
import {describe,it,expect} from 'vitest';
import {photoGeometry,photoSettings,isRepairPhotoResult,defaultPhotoSettings} from '../src/api/repairPhotos';
import {fullQuad,roadProject,sceneQuad} from '../src/simulation/projection';
import type {Mark} from '../src/simulation/model';
const mark={id:'CV1',kind:'Pothole',x:.4,y:.7,width:.2,length:.1,depthMm:50,severity:1,repaired:true,provenance:'detected',visualSeverity:.8,polygon:[{x:.3,y:.6},{x:.5,y:.6},{x:.5,y:.8},{x:.3,y:.8}]} as Mark;
describe('photo repair geometry contract',()=>{
  it('maps actual contour points back into original image perspective',()=>{
    const geometry=photoGeometry([mark],sceneQuad)[0];
    expect(geometry.polygon).toEqual(mark.polygon!.map(p=>roadProject(sceneQuad,p.x,p.y)));
    expect(geometry.severity).toBe(.8);expect(geometry.geometry_source).toBe('contour');
  });
  it('identifies box approximations and manual geometry explicitly',()=>{
    expect(photoGeometry([mark],fullQuad,true)[0].geometry_source).toBe('bounding_box');
    expect(photoGeometry([{...mark,provenance:'manual'}],fullQuad,true)[0].geometry_source).toBe('manual');
  });
  it('passes the actual monthly rates without inventing measured depths',()=>{
    expect(photoSettings(12,{depth:.04,size:.02},{...defaultPhotoSettings})).toMatchObject({months:12,severity_growth_per_month:.04,size_growth_per_month:.02});
    expect(photoGeometry([mark],fullQuad)[0]).not.toHaveProperty('depth_mm');
  });
  it('rejects responses that lack either real images, masks or simulation labeling',()=>{
    expect(isRepairPhotoResult({images:{original:'fake'}})).toBe(false);
    expect(isRepairPhotoResult({version:'repair-photo-v1',simulated:false})).toBe(false);
  });
});
