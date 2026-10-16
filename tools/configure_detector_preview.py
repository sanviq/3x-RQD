"""Enable explicitly labelled interactive inference from an evaluated local run."""
import argparse
import json
from pathlib import Path

from app.model_registry import DEFAULT_PREVIEW_REGISTRY, DEFAULT_REGISTRY
from tools.improve_detector import atomic_json
from tools.prepare_rdd2022 import file_sha256


def configure(job, output=DEFAULT_PREVIEW_REGISTRY):
    job=Path(job).resolve();output=Path(output).resolve()
    if output==DEFAULT_REGISTRY.resolve():raise ValueError('Preview must not overwrite the qualification registry')
    checkpoint=job/'run/weights/best.pt'
    if checkpoint.is_file():
        frozen_path=job/'frozen-candidate.json'
        validation_path=job/'candidate-selected-validation/report.json'
        if not validation_path.exists():validation_path=job/'candidate-validation/report.json'
        test_path=job/'candidate-test/report.json'
    else:
        checkpoint=job/'road-health-improvement-v2-best.pt'
        frozen_path=job/'improvement-v2-activation.json'
        validation_path=job/'improvement-v2-validation.json'
        test_path=job/'improvement-v2-test.json'
    frozen=json.loads(frozen_path.read_text())
    val=json.loads(validation_path.read_text());test=json.loads(test_path.read_text())
    checksum=file_sha256(checkpoint)
    if any(r['checkpoint_sha256']!=checksum for r in (frozen,val,test)):
        raise ValueError('Checkpoint does not match the frozen evaluated artifact')
    if val['split']!='val' or test['split']!='test' or val['dataset_manifest_sha256']!=test['dataset_manifest_sha256']:
        raise ValueError('Matching validation and held-out reports required')
    if set(val['per_class_metrics'])!={'D00','D10','D20','D40'} or set(test['per_class_metrics'])!=set(val['per_class_metrics']):
        raise ValueError('Four-class RDD2022 reports required')
    if any(r['diagnostic']['confidence']!=frozen['confidence'] for r in (val,test)):
        raise ValueError('Frozen confidence differs from evaluation')
    confidence=float(frozen['confidence']);imgsz=int(frozen['imgsz'])
    if not 0<confidence<1 or not 320<=imgsz<=1280:raise ValueError('Invalid preview settings')
    p=test['diagnostic']['precision']*100;r=test['diagnostic']['recall']*100
    record={'enabled':True,'usage':'interactive_preview','checkpoint':str(checkpoint),
            'checkpoint_sha256':checksum,'confidence':confidence,'imgsz':imgsz,
            'notice':f'Experimental trained RDD2022 detector. Recorded internal test precision {p:.1f}%, recall {r:.1f}% at confidence {confidence:g}; these are dataset results, not confidence for your photo. Qualification failed; review predictions. Road-health grades, exact damage area and depth are not validated.'}
    if output.exists() and json.loads(output.read_text())!=record:
        raise ValueError('Existing preview configuration differs; preserve and review it first')
    atomic_json(output,record)
    return record


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job',type=Path)
    parser.add_argument('--output',type=Path,default=DEFAULT_PREVIEW_REGISTRY)
    args=parser.parse_args()
    record=configure(args.job,args.output)
    print(json.dumps({k:v for k,v in record.items() if k!='checkpoint'},indent=2))
