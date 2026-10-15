"""Behavioral checks for provenance, selective repairs, evaluation and media handling."""
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.assessment import Defect, ScoreConfig, Inclination, assess
from app.detection import Tracker, demo_defects, demo_image, inspect
from app.evaluation import EvaluationRequest, evaluate


def test_selective_repairs_leave_untreated_defects():
    ds = demo_defects()
    before = assess(ds)
    after = assess(ds, repaired=[ds[0].id])
    assert after['defect_count'] == len(ds)-1
    assert {d['id'] for d in after['defects']} == {d.id for d in ds[1:]}
    assert after['score'] > before['score']
    assert after['inclination']['pitch'] is None
    assert after['validated'] is False
    assert after['score'] == round(100-sum(after['penalties'].values()), 2)


def test_larger_defect_gives_larger_penalty():
    small = Defect(id='a', class_name='pothole', confidence=.8, severity=.7, bbox=(.1,.1,.2,.2))
    big = small.model_copy(update={'bbox': (.1,.1,.6,.6)})
    assert assess([big])['score'] < assess([small])['score']


def test_depth_and_weights_validation():
    with pytest.raises(ValueError):
        Defect(id='a', class_name='pothole', bbox=(.1,.1,.3,.3), confidence=.8, depth_mm=30)
    with pytest.raises(ValueError):
        ScoreConfig(good_threshold=40, moderate_threshold=50)
    with pytest.raises(ValueError):
        ScoreConfig(major=0,granular=0,roughness=0,other=0)


def test_tracker_deduplicates_and_recovers_short_occlusion():
    tracker = Tracker()
    first = tracker.update(demo_defects())
    ids = [d.track_id for d in first]
    tracker.update([])
    second = tracker.update(demo_defects())
    assert ids == [d.track_id for d in second]
    assert len(tracker.seen) == len(ids)


def test_quality_withholds_score_and_demo_never_claims_measured_confidence():
    result = inspect(np.zeros((128,128,3), np.uint8))
    assert result['repeat_capture'] is True
    assert result['assessment']['score'] is None
    assert result['assessment']['band'] == 'Unassessable'
    assert result['assessment_confidence'] is None
    result = inspect(demo_image())
    assert result['provenance'] == 'demo'
    assert 'NOT detections from this image' in result['notice']


def test_inclination_retained_after_repair_and_density_calibration():
    ds = demo_defects()
    inc = Inclination(source='imu',pitch=10,roll=2)
    a = assess(ds, mm_per_pixel=1, inclination=inc)
    b = assess(ds, mm_per_pixel=2, inclination=inc)
    assert a['density_per_100m2'] == pytest.approx(b['density_per_100m2']*4, abs=.03)
    repaired = assess(ds, inclination=inc, repaired=[d.id for d in ds])
    assert repaired['score'] < 100
    assert repaired['inclination']['pitch'] == 10
    assert repaired['inclination']['approximate'] is False


def test_api_demo_model_absence_and_stream_lifecycle():
    with TestClient(app) as client:
        data = client.get('/api/demo').json()
        assert len(data['segments']) == 12
        for s in data['segments']:
            assert s['provenance'] == 'demo'
            assert s['result']['score'] == round(100-sum(s['result']['penalties'].values()), 2)
        assert client.post('/api/inspect',data={'mode':'model'}).status_code == 422
        assert client.post('/api/inspect',files={'image':('bad.jpg',b'bad')}).status_code == 422
        assert client.post('/api/inspect',data={'confidence':1.2}).status_code == 422
        assert client.post('/api/inspect',data={'resolution':100}).status_code == 422
        key = client.post('/api/streams').json()['session_id']
        a = client.post('/api/inspect',data={'session_id':key}).json()
        b = client.post('/api/inspect',data={'session_id':key}).json()
        assert a['unique_tracks'] == b['unique_tracks'] == 6
        assert client.delete('/api/streams/'+key).status_code == 200
        assert client.post('/api/inspect',data={'session_id':key}).status_code == 422


def test_optimizer_budget_and_no_inclination_invention():
    with TestClient(app) as client:
        segments = client.get('/api/demo').json()['segments']
        segments = [{k:v for k,v in s.items() if k not in ('result','seed')} for s in segments]
        budget = 300000
        r = client.post('/api/optimize',json={'segments':segments,'budget':budget})
        assert r.status_code == 200, r.text
        result = r.json()
        assert 0 <= result['spent'] <= budget
        assert result['spent'] == sum(item['cost'] for item in result['recommendations'] if item['selected'])
        assert result['remaining']+result['spent'] == budget
        assert client.post('/api/optimize',json={'segments':segments,'budget':0}).json()['spent'] == 0
        assert client.post('/api/inclination',json={'source':'elevation','elevation_start_m':100,'elevation_end_m':110,'horizontal_distance_m':100}).json()['approximate'] is True


def test_evaluation_known_true_false_and_missed_detections():
    gt = {'id':'gt','class_name':'pothole','confidence':1,'bbox':[.1,.1,.3,.3]}
    pred = {**gt,'id':'pred','confidence':.9}
    req = EvaluationRequest.model_validate({'frames':[
        {'image_id':'a','ground_truth':[gt],'predictions':[pred]},
        {'image_id':'b','ground_truth':[gt],'predictions':[]},
        {'image_id':'c','ground_truth':[],'predictions':[pred]}]})
    r = evaluate(req)
    assert r['precision'] == r['recall'] == r['f1'] == .5
    assert r['confusion_matrix'] == [[1,1],[1,0]]
    perfect = evaluate(EvaluationRequest.model_validate({'frames':[{'image_id':'a','ground_truth':[gt],'predictions':[pred]}]}))
    assert perfect['map50'] == perfect['map50_95'] == 1
    duplicate = req.model_copy(update={'frames':[req.frames[0],req.frames[0]]})
    with pytest.raises(ValueError): evaluate(duplicate)


def test_video_sampling_and_material_ratios(tmp_path):
    path = tmp_path/'sample.avi'
    writer = cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),10,(320,240))
    for i in range(12): writer.write(cv2.resize(demo_image(),(320,240)))
    writer.release()
    with TestClient(app) as client:
        r = client.post('/api/video',files={'video':('sample.avi',path.read_bytes())},data={'max_frames':3,'sample_every':2,'resolution':320})
        assert r.status_code == 200, r.text
        assert [f['frame_index'] for f in r.json()['frames']] == [0,2,4]
        assert r.json()['unique_tracks'] == 6
        assert client.post('/api/video',files={'video':('bad.mp4',b'bad')}).status_code == 422
        data = {'sample_id':'S1','dry_mass_g':100,'loose_mass_g':20,'recovered_metal_g':2,'oversized_mass_g':30,'method':'Dry mass sieve test'}
        r = client.post('/api/material',json=data).json()
        assert r['loose_fraction_percent'] == 20
        assert r['recovered_metal_percent'] == 2
        data['recovered_metal_g'] = 101
        assert client.post('/api/material',json=data).status_code == 422


def test_prefix_proxy_and_direct_production_contracts():
    with TestClient(app) as client:
        assert client.get('/health').json() == client.get('/api/health').json()
        assert client.get('/status').json() == client.get('/api/status').json()
        _, encoded = cv2.imencode('.png',demo_image())
        files = {'image':('synthetic.png',encoded.tobytes(),'image/png')}
        for path in ('/analyze','/api/analyze'):
            r = client.post(path,files=files,data={'pitch_degrees':0,'include_overlay':True})
            assert r.status_code == 200, r.text
            assert r.json()['inclination']['degrees'] == 0
            assert r.json()['overlay_png_base64']


def test_survey_evidence_and_scores_use_the_same_fixtures():
    with TestClient(app) as client:
        survey = client.get('/api/demo').json()['segments']
        for s in survey[:4]:
            r = client.post('/api/inspect',data={'seed':s['seed'],'demo_profile':'survey'}).json()
            assert r['assessment']['score'] == s['result']['score']
            assert r['assessment']['defect_count'] == s['result']['defect_count']


def test_scenario_does_not_change_untreated_properties():
    with TestClient(app) as client:
        ds = [d.model_dump() for d in demo_defects()]
        req = {'baseline':{'defects':ds},'repaired':[ds[0]['id']]}
        r = client.post('/api/simulate',json=req)
        assert r.status_code == 200, r.text
        result = r.json()
        assert result['gain'] > 0
        for d in result['after']['defects']:
            original = next(item for item in ds if item['id']==d['id'])
            assert d['severity'] == original['severity']
            assert tuple(d['bbox']) == tuple(original['bbox'])
        assert client.post('/api/simulate',json={**req,'repaired':['unknown']}).status_code == 422
        changed = client.post('/api/simulate',json={**req,'months':12}).json()
        assert changed['after']['score'] < result['after']['score']


def test_local_saves_are_explicit_and_preserve_provenance(tmp_path,monkeypatch):
    monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path))
    with TestClient(app) as client:
        assert client.get('/api/segments').json()['segments'] == []
        client.post('/api/inspect')
        assert client.get('/api/segments').json()['segments'] == []
        s = client.get('/api/demo').json()['segments'][3]
        record = {k:v for k,v in s.items() if k not in ('result','seed')}
        assert client.put('/api/segments/'+s['id'],json=record).status_code == 200
        survey = client.get('/api/segments').json()
        assert len(survey['segments']) == 1
        assert survey['segments'][0]['provenance'] == 'demo'
        assert survey['summary']['distance_m'] == s['length_m']
        assert survey['summary']['average_quality'] == s['result']['score']
        assert client.put('/api/segments/wrong-id',json=record).status_code == 422
        assert client.put('/api/segments/'+s['id'],json={**record,'evidence':{'original':'https://external.example/image.jpg'}}).status_code == 422


def test_schematic_driving_and_twin_have_explicit_depth_provenance():
    with TestClient(app) as client:
        ds = [d.model_dump() for d in demo_defects()]
        r = client.post('/api/simulation/drive',json={'baseline':{'defects':ds},'repaired':[ds[0]['id']],'frames':3})
        assert r.status_code == 200, r.text
        result = r.json()
        assert result['after']['remaining_defects'] == result['before']['remaining_defects']-1
        assert result['after']['score'] > result['before']['score']
        assert result['after']['speed_kmh'] == result['before']['speed_kmh']
        assert len(result['before']['frames']) == len(result['after']['frames']) == 3
        mesh = client.post('/api/twin',json={'defects':ds}).json()
        assert len(mesh['vertices']) == 25*49
        assert len(mesh['faces']) == 24*48
        assert all(v is None for v in mesh['measured_depth_mm'])
        assert 'schematic' in mesh['vertical_source']
        ds[0]['depth_mm'],ds[0]['depth_source'] = 40,'depth_sensor'
        measured = client.post('/api/twin',json={'defects':ds}).json()
        assert 40 in measured['measured_depth_mm']


def test_calibrated_camera_pose_and_invalid_rotation():
    from app.assessment import inclination_result
    obj = np.array([[0,0,0],[2,0,0],[2,2,0],[0,2,0],[1,1,0]],np.float64)
    k = np.array([[800,0,320],[0,800,240],[0,0,1]],np.float64)
    rv = np.array([.1,.15,0],np.float64)
    projected,_ = cv2.projectPoints(obj,rv,np.array([0,0,10],np.float64),k,None)
    reading = Inclination(source='camera_geometry',camera_matrix=k.tolist(),camera_to_world=np.eye(3).tolist(),image_points=projected.reshape(-1,2).tolist(),world_points=obj.tolist())
    result = inclination_result(reading)
    rotation,_ = cv2.Rodrigues(rv)
    expected = np.degrees(np.arctan2(-rotation[0,2],rotation[2,2]))
    assert result['pitch'] == pytest.approx(expected,abs=.005)
    assert result['approximate'] is True
    assert result['reprojection_rmse_px'] < .01
    with pytest.raises(ValueError):
        inclination_result(reading.model_copy(update={'camera_to_world':[[0,0,0],[0,0,0],[0,0,0]]}))
