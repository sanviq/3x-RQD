"""Lazy access to a bounded, attributed real-data gallery; never labelled AI results."""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router=APIRouter()
EXAMPLES=Path(__file__).resolve().parents[1]/'data/examples/rdd2022'


def catalog():
    path=EXAMPLES/'catalog.json'
    return json.loads(path.read_text()) if path.is_file() else []


@router.get('/dataset/examples')
def examples():
    return {'examples':catalog(),'provenance':'RDD2022 human annotations',
            'notice':'Real training examples from six countries; China includes drone and motorbike views. Preview copies are resized. Ground-truth boxes are human dataset annotations, not model detections or accuracy results. Indian state coverage is not established.',
            'source':'https://figshare.com/articles/dataset/21431547','license':'CC BY 4.0'}


@router.get('/dataset/examples/{filename}')
def example_file(filename:str):
    allowed={r[k] for r in catalog() for k in ('image','yolo_labels','original_xml')}
    if filename not in allowed or Path(filename).name!=filename:raise HTTPException(404,'Unknown dataset example')
    path=EXAMPLES/filename
    if not path.is_file():raise HTTPException(404,'Dataset example missing')
    return FileResponse(path,media_type='image/jpeg' if filename.endswith('.jpg') else 'text/plain',
                        headers={'Cache-Control':'public, max-age=3600'})
