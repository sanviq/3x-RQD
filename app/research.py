"""Bounded, precomputed research summaries; never load training images into the website."""
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException

router=APIRouter()
REPORT=Path(__file__).resolve().parents[1]/'docs/datasets/country-comparison.json'
RESULTS=REPORT.parent/'results'
TRAINING_POINTER=Path(__file__).resolve().parents[1]/'.local-road-health/training-job.json'

@router.get('/dataset/comparison')
def country_comparison():
    if not REPORT.is_file():raise HTTPException(404,'Country sample report is not available yet.')
    return json.loads(REPORT.read_text())


@router.get('/research/training-status')
def training_status():
    if not TRAINING_POINTER.is_file():return {'phase':'not_running','notice':'No local training job is registered.'}
    try:
        pointer=json.loads(TRAINING_POINTER.read_text())
        status_path=Path(pointer['status'])
        report=json.loads(status_path.read_text())
        public={k:v for k,v in report.items() if k in ('phase','updated_utc','completed_epochs','target_epochs','collected_images','target_images','activated','improved','notice','release_url')}
        # A heartbeat is distinct from a completed epoch. Never present cached
        # metrics as evidence that a stopped or sleeping process is still active.
        try:
            age=(datetime.now(timezone.utc)-datetime.fromisoformat(report['updated_utc'])).total_seconds()
            public['heartbeat_stale']=age>120
        except (KeyError,ValueError,TypeError):
            public['heartbeat_stale']=True
        progress_file=status_path.parent/'run/results.csv'
        if progress_file.is_file():
            try:
                with progress_file.open() as f:rows=list(csv.DictReader(f))
                keys={'precision':'metrics/precision(B)','recall':'metrics/recall(B)',
                      'map50':'metrics/mAP50(B)','map50_95':'metrics/mAP50-95(B)'}
                # Ignore incomplete trailing rows during an epoch CSV append.
                valid=[]
                for row in rows:
                    try:
                        values={k:float(row[v]) for k,v in keys.items()}
                        epoch=int(row['epoch']);elapsed=float(row['time'])
                        if epoch>0 and math.isfinite(elapsed) and all(math.isfinite(v) and 0<=v<=1 for v in values.values()):
                            valid.append((epoch,elapsed,values))
                    except (KeyError,ValueError,TypeError):continue
                if valid:
                    epoch,_,values=valid[-1]
                    public['latest_validation']={'epoch':epoch,**values,'provenance':'interim_training_validation',
                        'notice':'Ultralytics epoch validation metrics, not final held-out test results or deployment-threshold precision.'}
                    recent=valid[-6:]
                    durations=[(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(recent,recent[1:]) if b[0]>a[0] and b[1]>a[1]]
                    if report['phase']=='training' and not public['heartbeat_stale'] and durations:
                        public['estimated_training_seconds_remaining']=round(max(0,report['target_epochs']-epoch)*sum(durations)/len(durations))
            except (OSError,ValueError,KeyError,TypeError):pass
        return public
    except (OSError,ValueError,KeyError,TypeError):
        return {'phase':'status_unavailable','notice':'Inspect the local job logs for progress.'}


@router.get('/research/model-evaluation')
def model_evaluation():
    name='improvement-v2' if (RESULTS/'improvement-v2/test.json').is_file() else 'compact-v1'
    folder=RESULTS/name
    if not (folder/'test.json').is_file():raise HTTPException(404,'No measured evaluation report is available.')
    result={'run':name,'provenance':'measured_internal_heldout_evaluation','release_url':'https://github.com/sanviq/3x-RQD/releases/tag/rdd2022-'+name}
    for key,file in [('validation','validation.json'),('test','test.json'),('baseline','baseline-test.json'),('activation','activation.json')]:
        if (folder/file).is_file():result[key]=json.loads((folder/file).read_text())
    return result
