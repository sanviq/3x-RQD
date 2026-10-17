from pathlib import Path
import json
import numpy as np
import cv2
from fastapi.testclient import TestClient
from app.main import app
from app import detection

PHOTO=Path(__file__).parent/'fixtures/pothole-road.jpg'

def test_reviewed_analysis_reuses_selected_ids_score_and_full_side_coverage(monkeypatch):
    def no_second_model(*a,**kw):raise AssertionError('A shared inspection must not run YOLO again')
    monkeypatch.setattr(detection,'predict',no_second_model)
    with TestClient(app) as client:
        files={'image':('road.jpg',PHOTO.read_bytes(),'image/jpeg')}
        region=client.post('/road-region',files=files).json()
        q=region['road_quad'];poly=region['road_polygon']
        assert len(poly)>4
        # Real road-edge area excluded by the former narrow trapezoid.
        assert cv2.pointPolygonTest(np.asarray([[p['x'],p['y']] for p in poly],np.float32),(.15,.65),False)>=0
        detected=client.post('/api/detect-defects',files=files,data={'detector_mode':'opencv','road_quad':json.dumps(q),'road_polygon':json.dumps(poly)}).json()
        ids=[d['id'] for d in detected['defects']]
        response=client.post('/api/inspect-reviewed',files=files,data={'score_token':detected['score_token']})
        assert response.status_code==200,response.text
        shared=response.json()
        assert shared['retained_ids']==ids
        assert shared['assessment']['score']==detected['road_quality_score']['score']
        assert shared['assessment']['defect_count']==len(ids)
        assert shared['timing']['inference_ms']==0 and shared['provenance']=='opencv'
        assert shared['width']==640 and shared['height']==427
        excluded=client.post('/api/inspect-reviewed',files=files,data={'score_token':detected['score_token'],'excluded_json':json.dumps([ids[0]])}).json()
        assert excluded['retained_ids']==ids[1:]
        assert excluded['assessment']['defect_count']==len(ids)-1
        assert all(d['depth_mm'] is None for d in shared['assessment']['defects'])
        bad=client.post('/api/inspect-reviewed',files={'image':('other.jpg',b'not the original image','image/jpeg')},data={'score_token':detected['score_token']})
        assert bad.status_code==422
