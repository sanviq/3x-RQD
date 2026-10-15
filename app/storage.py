"""Explicit local survey saves. Uploaded media are never automatically persisted."""
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from app.assessment import Segment, assess
from app.simulation import assessment_args

class SavedSegment(Segment):
    evidence: dict[Literal['original','detections','segmentation','heatmap'], str] = Field(default_factory=dict)
    capture_notes: str = Field(default='', max_length=2000)

    @model_validator(mode='after')
    def bounded_evidence(self):
        if sum(len(v) for v in self.evidence.values()) > 5*1024*1024:
            raise ValueError('Evidence previews exceed 5 MiB; save metadata only.')
        if any(not v.startswith('data:image/jpeg;base64,') for v in self.evidence.values()):
            raise ValueError('Evidence must be inline JPEG previews, not remote image URLs.')
        return self


@contextmanager
def connection():
    directory = Path(os.environ.get('ROAD_HEALTH_DATA_DIR',str(Path(__file__).resolve().parents[1]/'.local-road-health')))
    directory.mkdir(parents=True,exist_ok=True)
    db = sqlite3.connect(directory/'survey.sqlite3', timeout=15)
    try:
        db.execute('CREATE TABLE IF NOT EXISTS segments (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT DEFAULT CURRENT_TIMESTAMP)')
        yield db
        db.commit()
    finally:
        db.close()


def save_segment(record):
    with connection() as db:
        count = db.execute('SELECT COUNT(*) FROM segments').fetchone()[0]
        exists = db.execute('SELECT 1 FROM segments WHERE id=?',(record.id,)).fetchone()
        if count >= 200 and not exists:
            raise ValueError('Local survey supports 200 segments. Export and archive the current survey first.')
        db.execute('INSERT INTO segments (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=CURRENT_TIMESTAMP',
                   (record.id,record.model_dump_json()))
    return {'saved':True,'id':record.id,'storage':'local_sqlite','notice':'Explicitly saved on this computer. Saved evidence contains processed previews, not original-resolution capture files.'}


def list_segments():
    with connection() as db:
        rows = db.execute('SELECT payload,updated FROM segments ORDER BY json_extract(payload,\'$.distance_start_m\'),id').fetchall()
    segments = []
    for payload, updated in rows:
        record = SavedSegment.model_validate_json(payload)
        segments.append({**record.model_dump(),'updated_at':updated,'result':assess(**assessment_args(record.assessment))})
    length = sum(s['length_m'] for s in segments)
    return {'segments':segments,'summary':{'distance_m':length,'segment_count':len(segments),
            'average_quality':round(sum(s['result']['score']*s['length_m'] for s in segments)/length,2) if length else None,
            'defects':sum(s['result']['defect_count'] for s in segments),'bad_segments':sum(s['result']['band']=='Bad' for s in segments),
            'low_confidence_segments':[s['id'] for s in segments if s['provenance']!='demo' and (s['result']['average_confidence'] is None or s['result']['average_confidence']<.6)]},
            'notice':'Locally saved, user-supplied records. Segment lengths, GPS and sensor calibration are not independently verified. Distances sum declared segment lengths; overlapping segments are not merged. Scores use each saved policy.'}
