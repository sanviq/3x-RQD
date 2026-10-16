import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.calibration import calibration_metadata


def test_scale_uncertainty_propagation_and_missing_data():
    physical={'area_sq_ft':100.,'chip_candidates_per_sq_ft':2.,'mean_chip_diameter_mm':10.,'mean_chip_gap_mm_proxy':None}
    result=calibration_metadata(physical,.5,10)
    assert result['bounds']['area_sq_ft']['lower']==pytest.approx(81)
    assert result['bounds']['area_sq_ft']['upper']==pytest.approx(121)
    assert result['bounds']['chip_candidates_per_sq_ft']['lower']==pytest.approx(2/1.21)
    assert result['bounds']['mean_chip_diameter_mm']=={'lower':9.,'upper':11.}
    assert result['bounds']['mean_chip_gap_mm_proxy'] is None
    assert all(v is None for v in calibration_metadata(physical,.5)['bounds'].values())


def test_reference_evaluation_reports_real_errors_separately_by_unit():
    request={'source_description':'Bench reference test fixture','held_out':True,'pairs':[
        {'sample_id':'a','parameter':'chip_diameter','predicted':12,'measured':10,'unit':'mm'},
        {'sample_id':'b','parameter':'chip_diameter','predicted':8,'measured':10,'unit':'mm'},
        {'sample_id':'a','parameter':'pitch','predicted':0,'measured':0,'unit':'degrees'}]}
    with TestClient(app) as c:
        response=c.post('/api/calibration/evaluate',json=request);assert response.status_code==200
        rows={r['parameter']:r for r in response.json()['parameters']}
        assert rows['chip_diameter']['mean_absolute_error']==2
        assert rows['chip_diameter']['root_mean_squared_error']==2
        assert rows['chip_diameter']['mean_bias']==0
        assert rows['pitch']['mean_absolute_percent_error'] is None
        assert rows['pitch']['excluded_zero_references']==1
        assert response.json()['validated'] is False
        request['pairs'].append(request['pairs'][0]);assert c.post('/calibration/evaluate',json=request).status_code==422
        request['pairs']=request['pairs'][:1];request['pairs'][0]['unit']='cm'
        assert c.post('/calibration/evaluate',json=request).status_code==422


def test_http_calibration_requires_correct_capture_and_preserves_raw_units():
    image=np.random.default_rng(12).integers(0,255,(128,128,3),dtype=np.uint8)
    _,encoded=cv2.imencode('.png',image);files={'image':('crop.png',encoded.tobytes(),'image/png')}
    with TestClient(app) as c:
        data={'capture_type':'surface_crop','mm_per_pixel':'.5','scale_uncertainty_percent':'5'}
        response=c.post('/api/analyze',files=files,data=data);assert response.status_code==200
        r=response.json();assert r['calibration']['scale_uncertainty_percent']==5
        assert r['calibration']['bounds']['area_sq_ft']['lower']==pytest.approx(r['physical_measurements']['area_sq_ft']*.95**2)
        assert r['assessment']['road_quality_index'] is None
        data['capture_type']='road_scene';assert c.post('/api/analyze',files=files,data=data).status_code==422
        data['capture_type']='surface_crop';data['scale_uncertainty_percent']='100'
        assert c.post('/api/analyze',files=files,data=data).status_code==422
