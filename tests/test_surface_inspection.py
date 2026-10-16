"""Surface contracts using known synthetic targets and attributed road photos, not accuracy claims."""
import hashlib
from pathlib import Path
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.features import extract_features,FEATURE_VERSION
from app.road_region import identify_road
from app import mask_models


def chips(single=False):
    image=np.full((256,256,3),50,np.uint8)
    for x in range(32,240,40):
        for y in range(32,240,40):
            if not single or (x==112 and y==112):cv2.circle(image,(x,y),10,(180,180,180),-1)
    return image


def encoded(image):
    ok,b=cv2.imencode('.png',image);assert ok;return b.tobytes()


def test_native_pixel_and_physical_units_use_different_scales():
    a,_=extract_features(chips(),.5);b,_=extract_features(chips(),1)
    assert a['surface_measurements']==b['surface_measurements']
    assert a['chip_candidate_count']>=20
    assert 12<a['surface_measurements']['equivalent_diameter']['value']<25
    assert a['surface_measurements']['inter_chip_gap']['value']>5
    assert b['physical_measurements']['area_sq_ft']==4*a['physical_measurements']['area_sq_ft']
    assert b['physical_measurements']['mean_chip_diameter_mm']==2*a['physical_measurements']['mean_chip_diameter_mm']
    assert b['physical_measurements']['chip_candidates_per_sq_ft']==a['physical_measurements']['chip_candidates_per_sq_ft']/4


def test_missing_calibration_retains_usable_pixel_measurements():
    r,_=extract_features(chips())
    assert r['surface_measurements']['candidate_density']['value']>0
    assert all(v is None for v in r['physical_measurements'].values())
    assert any(i['code']=='scale_missing' and i['guidance'] for i in r['surface_quality']['issues'])


def test_single_particle_has_no_fabricated_gap():
    r,_=extract_features(chips(True),.5)
    assert r['chip_candidate_count']==1
    assert r['surface_measurements']['equivalent_diameter']['value']>0
    assert r['surface_measurements']['inter_chip_gap']['value'] is None
    assert r['physical_measurements']['mean_chip_gap_mm_proxy'] is None


@pytest.mark.parametrize('tone',[0,100,255])
def test_unusable_image_has_actionable_limits_and_no_perfect_condition_score(tone):
    data=encoded(np.full((128,128,3),tone,np.uint8))
    with TestClient(app) as client:
        r=client.post('/analyze',files={'image':('road.png',data,'image/png')},data={'capture_type':'surface_crop','mm_per_pixel':.5}).json()
    assert r['surface_quality']['status']=='limited'
    assert r['defect_detection']['road_quality_score'] is None
    assert 'Refocus' in r['defect_detection']['score_error']
    assert r['physical_measurements']['area_sq_ft']>0
    assert r['surface_measurements']['equivalent_diameter']['value'] is None
    assert all(np.isfinite(v) for v in r['features'].values())


def test_automatic_region_is_pixel_derived_and_never_claims_calibrated_confidence():
    image=np.full((300,400,3),(20,150,30),np.uint8)
    cv2.fillConvexPoly(image,np.array([[170,90],[235,90],[390,299],[5,299]]),[100,100,100])
    r=identify_road(image)
    assert r['method']=='opencv_road_appearance'
    assert r['confidence'] is None and r['requires_review']
    assert r['road_quad'][0]['y']>0
    assert r['road_quad'][2]['y']>.9
    assert identify_road(np.zeros_like(image))['status']=='needs_outline'


def test_explicit_rectified_crop_and_manual_quad_are_preserved():
    image=chips();q=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]
    assert identify_road(image,'surface_crop')['method']=='declared_surface_crop'
    r=identify_road(image,road_quad=q)
    assert r['method']=='provided_outline'
    assert np.allclose([[p['x'],p['y']] for p in r['road_quad']],q)


def test_missing_optional_mask_model_is_an_explicit_fallback(monkeypatch,tmp_path):
    monkeypatch.setenv('ROAD_HEALTH_CHIP_MASK_MODEL',str(tmp_path/'missing.onnx'))
    r,_=extract_features(chips())
    assert r['chip_candidate_count']>0
    assert r['surface_quality']['method']=='opencv_local_contrast_watershed'
    assert any(i['code']=='chip_model_failed' for i in r['surface_quality']['issues'])


def test_model_letterbox_maps_back_to_native_dimensions(monkeypatch,tmp_path):
    p=tmp_path/'fixture.onnx';p.write_bytes(b'Not actual model weights; forward is mocked')
    monkeypatch.setenv('ROAD_HEALTH_ROAD_MASK_MODEL',str(p));monkeypatch.setenv('ROAD_HEALTH_ROAD_MASK_OUTPUT','probabilities')
    class Net:
        def setInput(self,blob):assert blob.shape==(1,3,512,512)
        def forward(self):
            m=np.zeros((1,1,512,512),np.float32);m[:,:,128:384,:]=1;return m
    monkeypatch.setattr(cv2.dnn,'readNetFromONNX',lambda path:Net());mask_models._nets.clear()
    mask,status=mask_models.predict_mask(np.full((100,200,3),100,np.uint8),'road')
    assert status['used'] and mask.shape==(100,200) and mask.all()


def test_detector_failure_keeps_real_opencv_analysis(monkeypatch):
    from app import integrated_detector as bridge
    monkeypatch.setattr(bridge,'selected_model',lambda explicit:{'configured':True,'confidence':.35,'imgsz':640})
    monkeypatch.setattr(bridge.detection,'predict',lambda *args:(_ for _ in ()).throw(RuntimeError('fixture model failed')))
    r=bridge.detect_defects(chips())
    assert r['method']=='opencv_multiscale_contours'
    assert r['model_failure']['fallback']=='opencv_multiscale_contours'


def test_real_segmentation_is_not_replaced_by_a_box(monkeypatch):
    from app import integrated_detector as bridge
    from app.assessment import Defect
    monkeypatch.setattr(bridge,'selected_model',lambda explicit:{'configured':True,'confidence':.35,'imgsz':640})
    d=Defect(id='mask',class_name='pothole',detection_code='D40',detection_label='Pothole',confidence=.8,severity=.7,bbox=(.2,.2,.8,.8),polygon=[(.2,.2),(.8,.2),(.8,.4),(.4,.4),(.4,.8),(.2,.8)])
    monkeypatch.setattr(bridge.detection,'predict',lambda *args:[d])
    r=bridge.detect_defects(chips());item=r['defects'][0]
    assert item['geometry_source']=='model_segmentation'
    points=np.array([[p['x'],p['y']] for p in item['polygon']],np.float32)
    assert abs(cv2.contourArea(points))<.3


@pytest.mark.parametrize('name',['India_India_000114.jpg','China_Drone_China_Drone_000008.jpg','Norway_Norway_000009.jpg'])
def test_varied_attributed_road_photos_return_surface_evidence(name):
    p=Path(__file__).parents[1]/'data/examples/rdd2022'/name
    with TestClient(app) as client:
        response=client.post('/analyze',files={'image':(name,p.read_bytes(),'image/jpeg')},data={'include_overlay':True})
    assert response.status_code==200
    r=response.json()
    assert r['feature_version']==FEATURE_VERSION=='surface-v4'
    assert r['road_region']['method']!='provided_outline'
    assert r['overlay_png_base64'] and r['surface_measurements']
    assert all(v is None for v in r['physical_measurements'].values())
