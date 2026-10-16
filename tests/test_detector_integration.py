"""Model activation, conservative assessment, genuine class mapping and both API paths."""
import json
from types import SimpleNamespace
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.assessment import Defect
from app import detection
from app.main import app
from app.model_registry import selected_model
from tools.prepare_rdd2022 import file_sha256
from tools.improve_detector import passes, improved


def test_registry_rejects_failed_or_changed_checkpoint(tmp_path,monkeypatch):
    weights=tmp_path/'model.pt';weights.write_bytes(b'trusted-fixture-not-loaded')
    registry=tmp_path/'detector.json';monkeypatch.setenv('ROAD_HEALTH_DETECTOR_REGISTRY',str(registry))
    record={'checkpoint':str(weights),'checkpoint_sha256':file_sha256(weights),'enabled':True,
            'validation_passed':True,'test_passed':True,'confidence':.25,'imgsz':768}
    registry.write_text(json.dumps(record));assert selected_model()['configured']
    weights.write_bytes(b'different-checkpoint');assert not selected_model()['configured']
    record['checkpoint_sha256']=file_sha256(weights);record['test_passed']=False
    registry.write_text(json.dumps(record));assert not selected_model()['configured']


def test_yolo_maps_to_teammate_geometry_and_both_routes(monkeypatch,tmp_path):
    from app import integrated_detector as bridge
    monkeypatch.setattr(bridge,'selected_model',lambda explicit:{'configured':True,'confidence':.25,'imgsz':768})
    defects=[Defect(id='defect-1',class_name='crack',detection_code='D10',detection_label='Transverse crack',
                    confidence=.8,bbox=(.2,.3,.7,.5),severity=.4),
             Defect(id='outside',class_name='pothole',detection_code='D40',confidence=.9,bbox=(.01,.01,.1,.1),severity=.7)]
    monkeypatch.setattr(detection,'predict',lambda *args:defects)
    image=np.random.default_rng(4).integers(0,255,(200,300,3),dtype=np.uint8)
    _,encoded=cv2.imencode('.png',image)
    quad=[[.15,.2],[.85,.2],[.85,.9],[.15,.9]]
    result=bridge.detect_defects(image,quad)
    assert len(result['defects'])==1
    d=result['defects'][0]
    assert d['detection_code']=='D10' and d['kind']=='Crack' and d['confidence']==.8
    assert d['bbox']=={'x':60,'y':60,'width':150,'height':40}
    assert d['geometry_source']=='bounding_box_schematic' and d['depth_mm'] is None
    assert result['road_health_score'] is None
    with TestClient(app) as client:
        for path in ('/detect-defects','/api/detect-defects'):
            response=client.post(path,files={'image':('road.png',encoded.tobytes(),'image/png')},data={'road_quad':json.dumps(quad)})
            assert response.status_code==200 and response.json()['method']=='yolo_rdd_detection'
        response=client.post('/analyze',files={'image':('road.png',encoded.tobytes(),'image/png')})
        assert response.status_code==200 and response.json()['assessment']['road_quality_index'] is None


def test_no_detection_or_high_confidence_never_establishes_health(monkeypatch):
    image=np.random.default_rng(5).integers(0,255,(64,640,3),dtype=np.uint8)
    for defects in ([],[Defect(id='d',class_name='pothole',confidence=.99,bbox=(.1,.1,.2,.2))]):
        monkeypatch.setattr(detection,'predict',lambda *args: defects)
        report=detection.inspect(image,mode='model',resolution=320)
        assert report['assessment']['score'] is None
        assert report['assessment']['band']=='Unassessable'
        assert report['processed_width']==320 and report['processed_height']==32


def test_failed_recall_or_unmatched_test_cannot_activate():
    def report(p=.7,r=.5,ap=.5):
        return {'split':'test','dataset_manifest_sha256':'same','diagnostic':{'precision':p,'recall':r,'f1':2*p*r/(p+r)},
                'ultralytics_metrics':{'metrics/mAP50(B)':ap,'metrics/mAP50-95(B)':ap/2},
                'per_class_metrics':{c:{'map50':.4} for c in ('D00','D10','D20','D40')}}
    assert passes(report()) and not passes(report(r=.1))
    assert improved(report(),report(p=.6,r=.3,ap=.3))
    candidate=report();candidate['dataset_manifest_sha256']='different'
    assert not improved(candidate,report(p=.6,r=.3,ap=.3))


def test_validation_threshold_selection_rejects_test(tmp_path):
    from tools.analyze_detector_errors import analyze
    (tmp_path/'report.json').write_text('{"split":"test"}')
    with pytest.raises(ValueError,match='validation only'):analyze(tmp_path)


def test_country_summary_has_no_country_health_verdict(tmp_path):
    from tools.summarize_countries import summarize
    manifest=tmp_path/'manifest.json';manifest.write_text(json.dumps([
        {'country':'India','split':'train','width':640,'height':640,'labels':[[3,.5,.5,.5,.5],[3,.5,.5,.5,.5]]}]))
    r=summarize(manifest);row=r['rows'][0]
    assert row['annotation_counts']['D40']==2 and row['mean_box_union_image_fraction']==.25
    assert row['road_health_score'] is None and 'not representative' in r['notice']
    with TestClient(app) as c:
        response=c.get('/api/dataset/comparison');assert response.status_code==200
        assert all(x['road_health_score'] is None for x in response.json()['rows'])


def test_expansion_keeps_exposed_images_out_of_fresh_test(tmp_path):
    from PIL import Image
    from tools.build_compact_dataset import build
    from train_detector import validated_dataset
    source=tmp_path/'selected';source.mkdir()
    inventories=[]
    for i in range(60):
        name=f'India_{i*100:06d}'
        image=source/'raw/India/train/images'/(name+'.jpg');image.parent.mkdir(parents=True,exist_ok=True)
        Image.fromarray(np.random.default_rng(i).integers(0,255,(64,64,3),dtype=np.uint8)).save(image)
        xml=source/'raw/India/train/annotations/xmls'/(name+'.xml');xml.parent.mkdir(parents=True,exist_ok=True)
        xml.write_text(f'<annotation><filename>{name}.jpg</filename><size><width>64</width><height>64</height></size><object><name>{["D00","D10","D20","D40"][i%4]}</name><bndbox><xmin>1</xmin><ymin>1</ymin><xmax>32</xmax><ymax>32</ymax></bndbox></object></annotation>')
        inventories.append({'subset':'India','raw_image':str(image.relative_to(source)),'raw_xml':str(xml.relative_to(source)),
                            'image_sha256':file_sha256(image),'xml_sha256':file_sha256(xml),'source_xml':xml.name,'source_outer_member':'India.zip'})
    (source/'India.inventory.json').write_text(json.dumps(inventories))
    (source/'collection-audit.json').write_text('{"status":"complete","subsets":{}}')
    original=tmp_path/'original';build(source,original)
    all_prior=json.loads((original/'manifest.json').read_text())
    prior=[]
    for split in ('train','val','test'):
        prior.extend([r for r in all_prior if r['split']==split][:2])
    (original/'subset-manifest.json').write_text(json.dumps(prior))
    expanded=tmp_path/'expanded';build(source,expanded,prior_manifest=original/'subset-manifest.json',fresh_test_only=True)
    validated_dataset(expanded/'data.yaml')
    records=json.loads((expanded/'manifest.json').read_text());by_pixel={r['pixel_sha256']:r for r in records}
    for old in prior:
        assert by_pixel[old['pixel_sha256']]['split']==('train' if old['split']=='train' else 'val')
    assert not {r['pixel_sha256'] for r in records if r['split']=='test'} & {r['pixel_sha256'] for r in prior}
    assert all(r['split']=='test' for r in records if r['pixel_sha256'] not in {old['pixel_sha256'] for old in prior})


def test_saved_high_confidence_detections_are_not_health_grades(tmp_path,monkeypatch):
    from app.storage import SavedSegment,save_segment,list_segments
    from app.assessment import optimize,OptimizeRequest
    monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path))
    payload={'id':'real-detection','name':'Needs officer review','latitude':18,'longitude':73,
             'distance_start_m':0,'length_m':100,'assessment':{'defects':[
                 {'id':'d','class_name':'pothole','confidence':.99,'bbox':[.1,.1,.4,.4]}]},'provenance':'model'}
    save_segment(SavedSegment.model_validate(payload))
    result=list_segments()['segments'][0]['result']
    assert result['score'] is None and result['candidate_score'] is not None
    assert result['evidence_status']=='detections_available'
    assert not optimize(OptimizeRequest.model_validate({'segments':[payload],'budget':100000}))['recommendations']


def test_video_tracks_distinct_rdd_crack_classes_separately():
    from app.detection import Tracker
    tracker=Tracker()
    first=Defect(id='a',class_name='crack',detection_code='D00',confidence=.8,bbox=(.1,.1,.4,.4))
    second=first.model_copy(update={'id':'b','detection_code':'D10'})
    tracker.update([first]);tracker.update([second])
    assert first.track_id!=second.track_id and len(tracker.seen)==2
