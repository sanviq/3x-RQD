"""Select only locally trusted checkpoints; hot-read atomic, hash-bound activation records."""
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path

DEFAULT_REGISTRY = Path(__file__).resolve().parents[1]/'.local-road-health/detector.json'
DEFAULT_PREVIEW_REGISTRY = DEFAULT_REGISTRY.with_name('experimental-detector.json')


@lru_cache(maxsize=8)
def _digest(path, mtime_ns, size):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        while block:=f.read(1024*1024):h.update(block)
    return h.hexdigest()


def _accepted_model(explicit=''):
    if explicit:
        p=Path(explicit).expanduser()
        return {'path':str(p), 'configured':p.is_file(), 'experimental':True,
                'source':'explicit_local_checkpoint', 'confidence':.35, 'imgsz':640,
                'notice':'Manually configured trusted local weights; reliability has not been verified by the activation registry.'}
    registry=Path(os.environ.get('ROAD_HEALTH_DETECTOR_REGISTRY',str(DEFAULT_REGISTRY)))
    if not registry.is_file():return {'path':'','configured':False,'experimental':True,'source':'not_configured'}
    try:
        record=json.loads(registry.read_text())
        p=Path(record['checkpoint'])
        stat=p.stat()
        if record.get('enabled') is not True or record.get('validation_passed') is not True or record.get('test_passed') is not True:
            raise ValueError('Activation checks have not passed')
        if _digest(str(p),stat.st_mtime_ns,stat.st_size)!=record['checkpoint_sha256']:
            raise ValueError('Checkpoint checksum differs from the evaluated model')
        confidence=float(record['confidence']);imgsz=int(record['imgsz'])
        if not 0<confidence<1 or not 320<=imgsz<=1280:raise ValueError('Invalid operating point')
        return {'path':str(p),'configured':True,'experimental':True,'source':'evaluated_local_registry',
                'confidence':confidence,'imgsz':imgsz,'checkpoint_sha256':record['checkpoint_sha256'],
                'notice':'Passed internal prototype detection checks. Human review is required; road-health scores, depth and country rankings are not validated.'}
    except (OSError,ValueError,KeyError,TypeError) as exc:
        return {'path':'','configured':False,'experimental':True,'source':'registry_rejected','notice':str(exc)}


def selected_model(explicit='', *, allow_experimental=False):
    selection=_accepted_model(explicit)
    if selection['configured'] or not allow_experimental:
        return selection
    registry=Path(os.environ.get('ROAD_HEALTH_PREVIEW_REGISTRY',str(DEFAULT_PREVIEW_REGISTRY)))
    if not registry.is_file():return selection
    try:
        record=json.loads(registry.read_text())
        if record.get('enabled') is not True or record.get('usage')!='interactive_preview':
            raise ValueError('Experimental preview was not explicitly enabled')
        path=Path(record['checkpoint']);stat=path.stat()
        checksum=_digest(str(path),stat.st_mtime_ns,stat.st_size)
        if checksum!=record['checkpoint_sha256']:raise ValueError('Preview checkpoint checksum changed')
        confidence=float(record['confidence']);imgsz=int(record['imgsz'])
        if not 0<confidence<1 or not 320<=imgsz<=1280:raise ValueError('Invalid preview settings')
        return {'path':str(path),'configured':True,'experimental':True,'qualified':False,
                'source':'interactive_experimental_preview','checkpoint_sha256':checksum,
                'confidence':confidence,'imgsz':imgsz,
                'notice':record.get('notice','Experimental trained model for explicit interactive inference. Human review required; qualification has not passed.')}
    except (OSError,ValueError,KeyError,TypeError):
        return {**selection,'preview_notice':'Experimental preview unavailable; check its local checkpoint, checksum and configuration.'}
