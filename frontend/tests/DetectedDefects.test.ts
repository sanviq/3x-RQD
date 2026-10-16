import { describe, expect, it } from 'vitest';
import response from './fixtures/pothole-detection.json';
import type { DefectDetection } from '../src/types/api';
import { isDefectDetection } from '../src/api/defects';
import { assumedDepth, detectedMarks, inspectionPath } from '../src/simulation/detections';
import { roadProject } from '../src/simulation/projection';
import { defaultPath, effectiveMarks, groundHeight, initialDrive, stepDrive, wheelPosition } from '../src/simulation/model';
const detection=response as DefectDetection;
const config={width:6,length:30,speed:25};
describe('actual pothole-photo response and simulation mapping',()=>{
  it('validates real API geometry and rejects corrupt coordinates or fake metric depth',()=>{
    expect(isDefectDetection(detection)).toBe(true);
    const d=detection.defects[0];
    expect(isDefectDetection({...detection,defects:[{...d,polygon:[{x:Infinity,y:.5},...d.polygon]}]})).toBe(false);
    expect(isDefectDetection({...detection,defects:[{...d,depth_mm:60}]})).toBe(false);
    expect(isDefectDetection({...detection,defects:[d,d]})).toBe(false);
  });
  it('maps each contour through the same homography as the photo texture',()=>{
    for(const defect of detection.defects){
      for(let i=0;i<defect.road_polygon.length;i++){
        const point=defect.road_polygon[i],original=roadProject(detection.road_quad,point.x,point.y);
        expect(original.x).toBeCloseTo(defect.polygon[i].x,3);expect(original.y).toBeCloseTo(defect.polygon[i].y,3);
      }
    }
  });
  it('maps genuine response items in encounter order, with explicit provenance and no samples',()=>{
    const marks=detectedMarks(detection);
    expect(marks).toHaveLength(detection.defects.length);expect(marks.every(m=>m.provenance==='detected')).toBe(true);
    expect(marks.map(m=>m.id).sort()).toEqual(detection.defects.map(m=>m.id).sort());
    for(let i=1;i<marks.length;i++)expect(marks[i].y).toBeLessThanOrEqual(marks[i-1].y);
    expect(detectedMarks(null)).toEqual([]);
  });
  it('uses only documented visualization depth priors and excludes rejected candidates',()=>{
    expect(assumedDepth('Pothole',0)).toBe(20);expect(assumedDepth('Pothole',1)).toBe(100);
    expect(assumedDepth('Crack',1)).toBe(15);
    const id=detection.defects[0].id;
    expect(detectedMarks(detection,[id]).some(m=>m.id===id)).toBe(false);
    expect(detection.defects.every(d=>d.depth_mm===null&&d.physical_dimensions===null)).toBe(true);
  });
  it('uses the mapped contour, rather than the entire bounding ellipse, for surface contact',()=>{
    const mark={...detectedMarks(detection)[0],polygon:[{x:.4,y:.4},{x:.6,y:.4},{x:.5,y:.6}],x:.5,y:.5,width:.2,length:.2,depthMm:80};
    expect(groundHeight(0,16,[mark],config)).toBeLessThan(0);
    expect(groundHeight(.55,12.2,[mark],config)).toBe(0);
  });
  it('produces actual contact and response for the supplied photo and zero after all repairs',()=>{
    const marks=detectedMarks(detection),path=inspectionPath(marks,config);
    let state=initialDrive();
    while(state.z<config.length-1.6)state=stepDrive(state,config,marks,path);
    expect(state.hits.length).toBeGreaterThan(0);expect(state.peak).toBeGreaterThan(.05);
    expect(state.hits.every(id=>detection.defects.some(d=>d.id===id))).toBe(true);
    const repaired=effectiveMarks(marks.map(m=>({...m,repaired:true})),'Repaired',0);
    let stable=initialDrive();for(let i=0;i<200;i++)stable=stepDrive(stable,config,repaired,defaultPath);
    expect(stable.peak).toBe(0);expect(stable.wheels.every(w=>w.axle===0&&w.body===0)).toBe(true);
    expect(wheelPosition(state.z,1,path,config).x).toBeGreaterThan(-config.width/2);
  });
});
