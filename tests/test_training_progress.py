import json
from datetime import datetime, timedelta, timezone

from app import research
from tools.detection_error_summary import summarize_errors


def test_progress_exposes_interim_metrics_and_eta_without_local_paths(tmp_path,monkeypatch):
    status=tmp_path/'status.json';pointer=tmp_path/'pointer.json'
    pointer.write_text(json.dumps({'status':str(status)}))
    monkeypatch.setattr(research,'TRAINING_POINTER',pointer)
    report={'phase':'training','updated_utc':datetime.now(timezone.utc).isoformat(),
            'completed_epochs':2,'target_epochs':50,'child_pid':999,'log':'private/path'}
    status.write_text(json.dumps(report));(tmp_path/'run').mkdir()
    path=tmp_path/'run/results.csv'
    path.write_text('epoch,time,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B)\n1,100,.4,.3,.2,.1\n2,160,.5,.4,.3,.2\n3,')
    value=research.training_status()
    assert value['latest_validation']['epoch']==2
    assert value['latest_validation']['precision']==.5
    assert value['latest_validation']['provenance']=='interim_training_validation'
    assert value['estimated_training_seconds_remaining']==48*60
    assert 'log' not in value and 'child_pid' not in value
    report['updated_utc']=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()
    status.write_text(json.dumps(report))
    value=research.training_status()
    assert value['heartbeat_stale'] is True
    assert 'estimated_training_seconds_remaining' not in value
    report.update(phase='complete',updated_utc=datetime.now(timezone.utc).isoformat())
    status.write_text(json.dumps(report))
    assert 'estimated_training_seconds_remaining' not in research.training_status()


def test_error_summary_distinguishes_duplicate_class_and_localization_errors():
    gt=[{'class_id':0,'bbox':[0,0,.05,.05]}, {'class_id':3,'bbox':[.5,.5,1,1]}]
    predictions=[{'class_id':0,'bbox':[0,0,.05,.05],'confidence':.9},
                 {'class_id':0,'bbox':[0,0,.05,.05],'confidence':.8},
                 {'class_id':1,'bbox':[.5,.5,1,1],'confidence':.8},
                 {'class_id':2,'bbox':[.2,.2,.3,.3],'confidence':.8}]
    result=summarize_errors([{'ground_truth':gt,'predictions':predictions}],.35)
    assert result['false_positive_categories']=={'duplicate_same_class':1,'overlapping_wrong_class':1,'unmatched_background_or_unlabelled_damage':1}
    assert result['per_class']['D00']=={'tp':1,'fp':1,'fn':0,'precision':.5,'recall':1}
    assert result['per_class']['D40']['recall']==0
    assert result['per_class']['D40']['precision'] is None
    assert result['misses_by_box_area']['small_under_1pct']=={'labels':1,'missed':0}
    assert result['misses_by_box_area']['large_over_10pct']=={'labels':1,'missed':1}
