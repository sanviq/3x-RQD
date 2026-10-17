"""A requested model must reach the photo review, never silently become CV contours."""
import json
import cv2
import numpy as np
from fastapi.testclient import TestClient
from app import detection, integrated_detector as bridge
from app.assessment import Defect
from app.main import app


def photo():
    image=np.random.default_rng(11).integers(40,190,(120,200,3),dtype=np.uint8)
    return cv2.imencode('.png',image)[1].tobytes()


def test_main_photo_review_can_explicitly_use_preview_without_qualifying_it(monkeypatch):
    requests=[]
    def select(explicit='', *, allow_experimental=False):
        requests.append(allow_experimental)
        return {'configured':allow_experimental,'confidence':.35,'imgsz':768,'path':'fixture-only','qualified':False}
    monkeypatch.setattr(bridge,'selected_model',select)
    calls=[]
    def predict(image,mode,confidence,resolution):
        calls.append((image.shape,mode,confidence,resolution))
        return [Defect(id='actual-model-box',class_name='pothole',detection_code='D40',
                       detection_label='Pothole',confidence=.7,bbox=(.2,.4,.6,.7))]
    monkeypatch.setattr(detection,'predict',predict)
    with TestClient(app) as client:
        r=client.post('/api/detect-defects',files={'image':('road.png',photo(),'image/png')},
            data={'detector_mode':'model','confidence':.25,'resolution':768,
                  'road_quad':json.dumps([[0,0],[1,0],[1,1],[0,1]])})
    assert r.status_code==200
    result=r.json()
    assert result['method']=='yolo_rdd_detection' and result['defects'][0]['id']=='actual-model-box'
    assert calls==[((120,200,3),'model',.25,768)]  # original pixels reach YOLO without CV filtering
    assert requests==[True]
    assert result['class_coverage']['Depression']=='not_trained'
    assert result['road_quality_score']['summary']['by_type']['Uneven surface'] is None


def test_explicit_model_failure_is_actionable_and_never_returns_cv_candidates(monkeypatch):
    monkeypatch.setattr(bridge,'selected_model',lambda *a,**kw:{'configured':False})
    with TestClient(app) as client:
        r=client.post('/api/detect-defects',files={'image':('road.png',photo(),'image/png')},data={'detector_mode':'model'})
        surface=client.post('/api/analyze',files={'image':('road.png',photo(),'image/png')},data={'detector_mode':'model'})
    assert r.status_code==422 and 'No trained road detector' in r.json()['detail']
    assert surface.status_code==200 and 'surface_measurements' in surface.json()
    assert 'defect_detection' not in surface.json()
    assert any('No trained road detector' in x for x in surface.json()['warnings'])


def test_automatic_routes_still_require_qualification_and_cv_is_explicit(monkeypatch):
    flags=[]
    def select(*a,**kw):
        flags.append(kw.get('allow_experimental',False));return {'configured':False}
    monkeypatch.setattr(bridge,'selected_model',select)
    image=np.full((120,200,3),100,dtype=np.uint8)
    assert bridge.detect_defects(image)['method']=='opencv_multiscale_contours'
    assert bridge.detect_defects(image,mode='opencv')['method']=='opencv_multiscale_contours'
    assert not any(flags)


def test_duplicate_boxes_do_not_inflate_damage_and_distinct_rdd_classes_remain():
    strongest=Defect(id='strong',class_name='crack',detection_code='D00',confidence=.8,bbox=(.2,.3,.5,.6))
    duplicate=strongest.model_copy(update={'id':'duplicate','confidence':.4})
    other_class=strongest.model_copy(update={'id':'transverse','detection_code':'D10','confidence':.6})
    other_hole=Defect(id='separate',class_name='pothole',detection_code='D40',confidence=.7,bbox=(.6,.6,.9,.9))
    assert [d.id for d in bridge._unique_defects([duplicate,other_hole,other_class,strongest])]==['strong','separate','transverse']
