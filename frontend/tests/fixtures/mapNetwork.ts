import type {MapInspection,MapNetwork,MappedSegment,MapConfig} from '../../src/api/map';
import {scoreFixture} from './qualityScore';
export const mapConfig:MapConfig={center:[12.9716,77.5946],location_label:'Test location — fixture only',tile_url:'https://example.test/{z}/{x}/{y}.png',tile_attribution:'Test fixture tiles',max_zoom:19,notice:'Not real map evidence'};
export function mapFixture(inspected=true):MapNetwork{
 const score=scoreFixture();
 const inspection:MapInspection={score,analyzed_at:score.generated_at,saved_at:score.generated_at,latitude:12.9716,longitude:77.5946,source_hash:score.image.sha256,source_width:640,source_height:427,evidence_verified:true,review_status:'unreviewed',location_source:'user_confirmed_map_assignment',detector_method:'opencv_multiscale_contours',original_preview:'data:image/jpeg;base64,AA==',outlined_preview:'data:image/jpeg;base64,AA==',scope:'Synthetic test observation; not real inspection evidence.'};
 const segment:MappedSegment={id:'osm-way-1-10-11',name:'Fixture Road',coordinates:[[77.5946,12.9716],[77.5956,12.9716]],length_m:100,source:'openstreetmap',osm_way_id:'1',highway:'residential',start_node:'10',end_node:'11',inspection:inspected?inspection:null};
 return {segments:[segment],attribution:'OSM test fixture',summary:{segment_count:1,inspected_segments:inspected?1:0,not_inspected_segments:inspected?0:1,mapped_length_m:100,represented_segment_length_m:inspected?100:0,represented_length_percent:inspected?100:0,average_quality:inspected?80:null,comparable_configurations:true,defect_count:inspected?2:null,by_type:inspected?{Pothole:2}:{},by_severity:{Low:0,Moderate:0,High:inspected?2:0},needs_attention:0,provisional:true,methodology:'Synthetic test summary; excludes unknown roads.'}};
}
