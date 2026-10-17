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


def test_opencv_workbench_matches_main_pipeline_and_tracks_real_candidates(monkeypatch):
    monkeypatch.setattr(detection,'predict',lambda *a,**k: (_ for _ in ()).throw(AssertionError('OpenCV must not call YOLO')))
    with TestClient(app) as client:
        files={'image':('road.jpg',PHOTO.read_bytes(),'image/jpeg')}
        main=client.post('/api/detect-defects',files=files,data={'detector_mode':'opencv'}).json()
        result=client.post('/api/inspect',files=files,data={'mode':'opencv','resolution':'320','confidence':'.95'})
        assert result.status_code==200,result.text
        workbench=result.json()
        assert workbench['provenance']=='opencv'
        assert workbench['retained_ids']==[d['id'] for d in main['defects']]
        assert workbench['assessment']['score']==main['road_quality_score']['score']
        assert workbench['road_polygon']==main['road_polygon']
        assert workbench['assessment']['damaged_area_percent']==round(main['road_quality_score']['summary']['affected_road_percent'],2)
        assert workbench['width']==640 and workbench['height']==427
        assert not workbench['synthetic_stress_test']
        assert all(d['depth_mm'] is None for d in workbench['assessment']['defects'])
        session=client.post('/api/streams').json()['session_id']
        first=client.post('/api/inspect',files=files,data={'mode':'opencv','session_id':session}).json()
        second=client.post('/api/inspect',files=files,data={'mode':'opencv','session_id':session}).json()
        assert first['unique_tracks']==second['unique_tracks']==len(main['defects'])
        assert [d['track_id'] for d in first['assessment']['defects']]==[d['track_id'] for d in second['assessment']['defects']]
        client.delete('/api/streams/'+session)


def test_opencv_workbench_requires_capture_and_withholds_empty_evidence():
    with TestClient(app) as client:
        assert client.post('/api/inspect',data={'mode':'opencv'}).status_code==422
        ok,pixels=cv2.imencode('.png',np.full((100,100,3),120,np.uint8));assert ok
        response=client.post('/api/inspect',files={'image':('blank.png',pixels.tobytes(),'image/png')},data={'mode':'opencv'})
        assert response.status_code==200,response.text
        assert response.json()['assessment']['score'] is None
        assert response.json()['assessment']['defect_count']==0


def test_opencv_video_accepts_real_frames_without_yolo(monkeypatch, tmp_path):
    from app import road_quality_score as quality
    snapshots_before=set(quality._snapshots)
    monkeypatch.setattr(detection,'predict',lambda *a,**k: (_ for _ in ()).throw(AssertionError('OpenCV video must not call YOLO')))
    image=cv2.imread(str(PHOTO));path=tmp_path/'capture.avi'
    writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),2,(640,427))
    assert writer.isOpened()
    try:
        writer.write(image);writer.write(image)
    finally:writer.release()
    with TestClient(app) as client:
        response=client.post('/api/video',files={'video':('capture.avi',path.read_bytes(),'video/x-msvideo')},data={'mode':'opencv','sample_every':1,'max_frames':2})
        assert response.status_code==200,response.text
        result=response.json()
        assert len(result['frames'])==2
        assert all(frame['provenance']=='opencv' and frame['assessment']['defect_count']>0 for frame in result['frames'])
        # Codec quantization can change a few contours; association must still
        # avoid counting every recurring candidate again in the second frame.
        counts=[frame['assessment']['defect_count'] for frame in result['frames']]
        assert max(counts)<=result['unique_tracks']<sum(counts)
        assert set(quality._snapshots)==snapshots_before


def test_html_revalidates_the_frontend_bundle_after_deployment():
    from starlette.responses import HTMLResponse
    from starlette.routing import Route
    route=Route('/test-cache-page',lambda request:HTMLResponse('<html>test</html>'))
    app.router.routes.insert(0,route)
    try:
        with TestClient(app) as client:
            response=client.get('/test-cache-page')
            assert response.status_code==200
            assert 'no-store' in response.headers['cache-control']
    finally:app.router.routes.remove(route)
