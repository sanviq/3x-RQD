from fastapi.testclient import TestClient
from app.main import app


def record(identifier='GPS-1'):
    return {'id':identifier,'name':'Team surveyed road','latitude':12.95,'longitude':77.6,
            'distance_start_m':0,'length_m':100,'provenance':'model',
            'assessment':{'defects':[]},'evidence':{},'capture_notes':'Contract test only'}


def test_preview_does_not_save_and_commit_preserves_uncertainty(tmp_path,monkeypatch):
    monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path))
    row={**record(),'result':{'score':100,'band':'Good'},'updated_at':'ignored'}
    with TestClient(app) as c:
        preview=c.post('/api/segments/import/preview',json={'segments':[row]})
        assert preview.status_code==200 and preview.json()['saved'] is False
        assert c.get('/api/segments').json()['summary']['segment_count']==0
        response=c.post('/api/segments/import',json={'segments':[row]})
        assert response.status_code==200 and response.json()['saved'] is True
        survey=c.get('/api/segments').json()
        assert survey['summary']['segment_count']==1
        assert survey['segments'][0]['result']['score'] is None
        # The app's export shape can be imported on a teammate's system.
        monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path/'teammate'))
        assert c.post('/segments/import/preview',json=survey).status_code==200


def test_import_is_all_or_nothing_and_never_overwrites(tmp_path,monkeypatch):
    monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path))
    with TestClient(app) as c:
        assert c.post('/api/segments/import',json={'segments':[record()]}).status_code==200
        for rows in ([record('NEW'),record()], [record('NEW'),{**record('BAD'),'latitude':200}],
                     [record('NEW'),record('NEW')],[{**record('DEMO'),'provenance':'demo'}],
                     [{**record('MISSING'),'provenance':None}]):
            response=c.post('/api/segments/import',json={'segments':rows})
            assert response.status_code==422
            assert [s['id'] for s in c.get('/api/segments').json()['segments']]==['GPS-1']
        assert c.post('/api/segments/import',json={'segments':[record('NEW')]}).status_code==200


def test_bad_json_and_bounded_records_rejected(tmp_path,monkeypatch):
    monkeypatch.setenv('ROAD_HEALTH_DATA_DIR',str(tmp_path))
    with TestClient(app) as c:
        for payload in ('[]','{"segments": []}','not-json'):
            assert c.post('/api/segments/import/preview',content=payload).status_code==422
        assert c.post('/api/segments/import/preview',json={'segments':[record(str(i)) for i in range(201)]}).status_code==422
        assert c.post('/api/segments/import/preview',content=b' '*(10*1024*1024+1)).status_code==413
