"""Bounded, precomputed research summaries; never load training images into the website."""
import json
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
        report=json.loads(Path(pointer['status']).read_text())
        return {k:v for k,v in report.items() if k in ('phase','updated_utc','completed_epochs','target_epochs','collected_images','target_images','activated','improved','notice','release_url')}
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
