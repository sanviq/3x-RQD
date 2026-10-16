"""Bounded follow-up training and validation only; never reuse the exposed test."""
import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

from train_detector import validated_dataset
from tools.improve_detector import atomic_json
from tools.prepare_rdd2022 import file_sha256


def compare_validation(baseline, candidate):
    if (baseline['split'] != 'val' or candidate['split'] != 'val'
            or baseline['dataset_manifest_sha256'] != candidate['dataset_manifest_sha256']
            or baseline['images'] != candidate['images']
            or baseline['class_distribution'] != candidate['class_distribution']
            or baseline['diagnostic']['confidence'] != candidate['diagnostic']['confidence']):
        raise ValueError('Compare only the same validation images, labels and confidence policy')
    fields=('precision','recall','f1')
    before=baseline['diagnostic'];after=candidate['diagnostic']
    return {
        'split':'val', 'images':candidate['images'],
        'baseline_checkpoint_sha256':baseline['checkpoint_sha256'],
        'candidate_checkpoint_sha256':candidate['checkpoint_sha256'],
        'diagnostic_deltas':{k:after[k]-before[k] for k in fields},
        'map50_delta':candidate['ultralytics_metrics']['metrics/mAP50(B)']-baseline['ultralytics_metrics']['metrics/mAP50(B)'],
        'activation_enabled':False,'requires_fresh_holdout':True,
        'notice':'Validation experiment only. Earlier test results have been inspected; do not reuse that test to tune this model or claim fresh final confirmation. No automatic activation, road-health validation or 90% achievement claim.'}


def execute(repo, root, phase, arguments, epochs):
    with (root/'pipeline.log').open('ab',buffering=0) as log:
        child=subprocess.Popen([sys.executable,'-u',*arguments],cwd=repo,
                               stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
        try:
            while True:
                progress={'completed_epochs':0}
                path=root/'run/results.csv'
                if path.exists():
                    try:
                        with path.open() as stream:rows=list(csv.DictReader(stream))
                        if rows:progress['completed_epochs']=int(float(rows[-1]['epoch']))
                    except (ValueError,KeyError,TypeError):pass
                atomic_json(root/'status.json',dict(phase=phase,updated_utc=datetime.now(timezone.utc).isoformat(),
                    child_pid=child.pid,target_epochs=epochs,**progress,
                    notice='YOLOv8s refinement toward 90% precision. Validation only; no test reuse or automatic activation.'))
                if child.poll() is not None:break
                time.sleep(15)
        except BaseException:
            if child.poll() is None:child.terminate()
            raise
        if child.returncode:raise RuntimeError(f'{phase} failed ({child.returncode}); inspect pipeline.log')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset',type=Path)
    parser.add_argument('--base',type=Path,required=True)
    parser.add_argument('--baseline-validation',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--epochs',type=int,default=50)
    parser.add_argument('--imgsz',type=int,default=768)
    parser.add_argument('--batch',type=int,default=1)
    parser.add_argument('--lr',type=float,default=.001)
    parser.add_argument('--device',default='mps')
    parser.add_argument('--register',action='store_true',help='Register local progress with the website')
    args=parser.parse_args()
    if not 1<=args.epochs<=100 or args.imgsz<64 or args.batch<1 or args.lr<=0:
        parser.error('Invalid bounded training settings')
    if not args.base.is_file():parser.error('Trusted local pretrained checkpoint required')
    dataset,fingerprint=validated_dataset(args.dataset)
    baseline=json.loads(args.baseline_validation.read_text())
    if baseline['split']!='val' or baseline['dataset_manifest_sha256']!=fingerprint:
        parser.error('Baseline must be validation on this exact dataset manifest')
    repo=Path(__file__).resolve().parents[1];root=args.output.resolve()
    root.mkdir(parents=True,exist_ok=False)
    protocol=dict(precision_target=.9,scope='validation_only',dataset_manifest_sha256=fingerprint,
                  base_sha256=file_sha256(args.base),baseline_validation=baseline,
                  epochs=args.epochs,imgsz=args.imgsz,batch=args.batch,lr=args.lr,device=args.device,
                  seed=42,mosaic=.5,scale=.3,degrees=2,patience=15,
                  notice='Larger pretrained detector experiment; not a claim that capacity alone improves precision. All original data, holdout assignments and existing checkpoints are preserved. No automatic deployment or repeated test evaluation.')
    atomic_json(root/'protocol.json',protocol)
    if args.register:
        pointer=repo/'.local-road-health/training-job.json'
        if pointer.exists():atomic_json(root/'training-pointer-before.json',json.loads(pointer.read_text()))
        import os
        atomic_json(pointer,{'status':str(root/'status.json'),'pid':os.getpid()})
    try:
        execute(repo,root,'training',['train_detector.py',str(dataset),'--base',str(args.base.resolve()),
                '--output',str(root/'run'),'--epochs',str(args.epochs),'--imgsz',str(args.imgsz),
                '--batch',str(args.batch),'--lr',str(args.lr),'--device',args.device,'--seed','42',
                '--mosaic','.5','--scale','.3','--degrees','2','--patience','15'],args.epochs)
        execute(repo,root,'candidate_validation',['-m','tools.evaluate_detector',str(dataset),
                '--checkpoint',str(root/'run/weights/best.pt'),'--output',str(root/'candidate-validation'),
                '--split','val','--device',args.device,'--imgsz',str(args.imgsz),'--batch',str(args.batch),
                '--confidence',str(baseline['diagnostic']['confidence'])],args.epochs)
        candidate=json.loads((root/'candidate-validation/report.json').read_text())
        atomic_json(root/'validation-comparison.json',compare_validation(baseline,candidate))
        with (root/'run/results.csv').open() as stream:completed=len(list(csv.DictReader(stream)))
        atomic_json(root/'status.json',dict(phase='complete',updated_utc=datetime.now(timezone.utc).isoformat(),
                    completed_epochs=completed,
                    target_epochs=args.epochs,activated=False,
                    notice='Refinement training and validation complete. Review validation-comparison.json and precision-profile.json. Independent fresh holdout confirmation is still required; model remains experimental.'))
    except BaseException as exc:
        atomic_json(root/'status.json',dict(phase='failed',updated_utc=datetime.now(timezone.utc).isoformat(),
                    error=type(exc).__name__+': '+str(exc),activated=False,
                    notice='Refinement stopped. Preserve checkpoints and inspect the local pipeline log. No automatic activation.'))
        raise


if __name__=='__main__':main()
