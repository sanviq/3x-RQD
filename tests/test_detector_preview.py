import json
from pathlib import Path

import pytest
from app import detection
from app.model_registry import selected_model
from tools.configure_detector_preview import configure
from tools.prepare_rdd2022 import file_sha256


def make_job(root):
    checkpoint=root/'run/weights/best.pt';checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b'fixture-not-a-loadable-model')
    frozen={'checkpoint_sha256':file_sha256(checkpoint),'confidence':.35,'imgsz':768}
    (root/'frozen-candidate.json').write_text(json.dumps(frozen))
    for split,folder in [('val','candidate-validation'),('test','candidate-test')]:
        p=root/folder/'report.json';p.parent.mkdir()
        p.write_text(json.dumps({'split':split,'checkpoint_sha256':frozen['checkpoint_sha256'],
            'dataset_manifest_sha256':'matching-fixture','per_class_metrics':dict.fromkeys(('D00','D10','D20','D40'),{}),
            'diagnostic':{'confidence':.35,'precision':.592,'recall':.251}}))
    return checkpoint


def test_preview_is_explicit_hashed_and_never_qualifies_automatic_detection(tmp_path,monkeypatch):
    checkpoint=make_job(tmp_path/'job');preview=tmp_path/'preview.json'
    monkeypatch.setenv('ROAD_HEALTH_DETECTOR_REGISTRY',str(tmp_path/'no-accepted-model.json'))
    monkeypatch.setenv('ROAD_HEALTH_PREVIEW_REGISTRY',str(preview))
    monkeypatch.setattr(detection,'MODEL_PATH','')
    configure(tmp_path/'job',preview)
    assert selected_model()['configured'] is False
    selection=selected_model(allow_experimental=True)
    assert selection['configured'] and selection['qualified'] is False
    assert selection['source']=='interactive_experimental_preview'
    assert detection.model_status()['automatic_detection_configured'] is False
    assert 'path' not in detection.model_status()
    checkpoint.write_bytes(b'changed')
    assert not selected_model(allow_experimental=True)['configured']


def test_preview_preserves_existing_configuration_and_checks_report_identity(tmp_path):
    make_job(tmp_path/'job');preview=tmp_path/'preview.json'
    configure(tmp_path/'job',preview)
    original=preview.read_text()
    configure(tmp_path/'job',preview)
    assert preview.read_text()==original
    path=tmp_path/'job/candidate-test/report.json';report=json.loads(path.read_text())
    report['checkpoint_sha256']='different';path.write_text(json.dumps(report))
    with pytest.raises(ValueError,match='frozen evaluated'):configure(tmp_path/'job',preview)
    assert preview.read_text()==original
    report['checkpoint_sha256']=file_sha256(tmp_path/'job/run/weights/best.pt');report['split']='train'
    path.write_text(json.dumps(report))
    with pytest.raises(ValueError,match='Matching validation'):configure(tmp_path/'job',preview)


def test_interactive_api_accepts_the_evaluated_768_resolution(monkeypatch):
    import cv2
    import numpy as np
    from fastapi.testclient import TestClient
    from app.main import app
    from app import road_api
    monkeypatch.setattr(road_api,'inspect',lambda image,**kwargs:{'resolution':kwargs['resolution'],'provenance':kwargs['mode']})
    _,image=cv2.imencode('.png',np.full((64,64,3),100,dtype=np.uint8))
    with TestClient(app) as client:
        response=client.post('/api/inspect',files={'image':('road.png',image.tobytes(),'image/png')},
                             data={'mode':'model','resolution':'768'})
    assert response.status_code==200 and response.json()=={'resolution':768,'provenance':'model'}


def test_teammate_can_configure_from_small_release_assets_without_the_dataset(tmp_path):
    import shutil
    checkpoint=make_job(tmp_path/'job');release=tmp_path/'release';release.mkdir()
    for source,name in [(checkpoint,'road-health-improvement-v2-best.pt'),
        (tmp_path/'job/frozen-candidate.json','improvement-v2-activation.json'),
        (tmp_path/'job/candidate-validation/report.json','improvement-v2-validation.json'),
        (tmp_path/'job/candidate-test/report.json','improvement-v2-test.json')]:
        shutil.copyfile(source,release/name)
    result=configure(release,tmp_path/'preview.json')
    assert result['usage']=='interactive_preview' and result['imgsz']==768
    assert Path(result['checkpoint']).parent==release
