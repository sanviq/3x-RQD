import {describe,it,expect} from 'vitest';
import {isDefectDetection} from '../src/api/defects';
import {detectedMarks} from '../src/simulation/detections';
const polygon=[{x:.2,y:.3},{x:.7,y:.3},{x:.7,y:.5},{x:.2,y:.5}];
// Synthetic contract fixture only; not an evaluated model prediction.
const defect={id:'contract-only',kind:'Crack',confidence:.8,severity:.4,severity_label:'Moderate',
 polygon,road_polygon:polygon,bbox:{x:60,y:60,width:150,height:40},bbox_normalized:{x:.2,y:.3,width:.5,height:.2},
 area_fraction:.1,provenance:'yolo_prediction',geometry_source:'bounding_box_schematic',depth_mm:null,physical_dimensions:null,
 detection_code:'D10',detection_label:'Transverse crack',evidence:{detection_code:'D10',detection_label:'Transverse crack'}};
const response={version:'rdd-yolo-v2',method:'yolo_rdd_detection',coordinate_system:'normalized_exif_oriented_original',
 road_quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],image:{width:300,height:200},
 defects:[defect],warnings:['Bounding boxes are schematic'],confidence_calibrated:false,requires_review:true};
describe('trained detector compatibility with the existing simulator',()=>{
 it('accepts RDD classes and preserves the existing simulation workflow',()=>{
  expect(isDefectDetection(response)).toBe(true);
  if(isDefectDetection(response)){
   const marks=detectedMarks(response);expect(marks).toHaveLength(1);
   expect(marks[0].kind).toBe('Crack');expect(marks[0].confidence).toBe(.8);
   expect(marks[0].polygon).toEqual(polygon);
  }
 });
 it('rejects invented classes, metric depth, or mixed OpenCV/YOLO provenance',()=>{
  for(const patch of [{detection_code:'D99'},{depth_mm:20},{provenance:'opencv_candidate'},{geometry_source:'segmentation_mask'}]){
   expect(isDefectDetection({...response,defects:[{...defect,...patch}]})).toBe(false);
  }
 });
});
