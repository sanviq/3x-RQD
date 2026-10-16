"""Reproducible RDD2022 fine-tuning. Runs only when explicitly invoked."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import subprocess

from tools.prepare_rdd2022 import CLASSES, file_sha256


def validated_dataset(path):
    import yaml
    path = Path(path).resolve()
    config = yaml.safe_load(path.read_text())
    if 'download' in config:
        raise ValueError('Dataset download hooks are not allowed; prepare the local dataset first.')
    if config.get('names') != dict(enumerate(CLASSES)):
        raise ValueError('Expected exact class mapping 0:D00, 1:D10, 2:D20, 3:D40')
    root = path.parent
    if Path(config.get('path','')).resolve() != root:
        raise ValueError('Dataset root must match the prepared directory')
    for split in ('train','val','test'):
        if config.get(split) != f'images/{split}' or not (root/config[split]).is_dir():
            raise ValueError('Expected local prepared train/val/test directories')
    audit = json.loads((root/'audit.json').read_text())
    if audit.get('status') != 'complete': raise ValueError('Dataset audit is incomplete')
    records = json.loads((root/'manifest.json').read_text())
    if not records: raise ValueError('Empty prepared dataset')
    groups = {}; pixels = {}
    for r in records:
        split=r['split']
        if split not in ('train','val','test'): raise ValueError('Unknown split')
        for index,key in ((groups,r['group']),(pixels,r['pixel_sha256'])):
            if key in index and index[key] != split: raise ValueError('Cross-split group or pixel leakage')
            index[key]=split
        image=root/r['prepared_image']
        if root not in image.resolve().parents or not image.is_file(): raise ValueError('Missing or unsafe prepared image')
        if file_sha256(image) != r['image_sha256']: raise ValueError('Prepared image changed: '+str(image))
        label=root/'labels'/split/Path(r['prepared_image']).with_suffix('.txt').name
        expected=''.join(f'{c} {x:.10f} {y:.10f} {w:.10f} {h:.10f}\n' for c,x,y,w,h in r['labels'])
        if label.read_text() != expected: raise ValueError('Prepared labels changed: '+str(label))
    # Extra files would otherwise enter Ultralytics without being represented in the audit.
    expected_paths={r['prepared_image'] for r in records}
    actual_paths={str(p.relative_to(root)) for p in (root/'images').rglob('*') if p.is_file()}
    if actual_paths != expected_paths: raise ValueError('Prepared image inventory differs from manifest')
    return path, file_sha256(root/'manifest.json')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('dataset',type=Path)
    p.add_argument('--base',type=Path,help='Trusted local pretrained detection checkpoint; never downloaded implicitly')
    p.add_argument('--output',type=Path,required=True,help='New run directory; existing runs are preserved')
    p.add_argument('--resume',type=Path,help='Existing last.pt; configuration and dataset identity must match')
    p.add_argument('--epochs',type=int,default=100)
    p.add_argument('--imgsz',type=int,default=640)
    p.add_argument('--batch',type=int,default=4)
    p.add_argument('--lr',type=float,default=.001)
    p.add_argument('--seed',type=int,default=42)
    p.add_argument('--device',default='mps')
    p.add_argument('--workers',type=int,default=0)
    p.add_argument('--mosaic',type=float,default=1.)
    p.add_argument('--scale',type=float,default=.5)
    p.add_argument('--degrees',type=float,default=0.)
    p.add_argument('--patience',type=int,default=100)
    a=p.parse_args()
    if a.epochs<1 or a.imgsz<64 or a.batch<1 or a.lr<=0 or a.workers<0:p.error('Invalid training settings')
    if not 0<=a.mosaic<=1 or not 0<=a.scale<=1 or not 0<=a.degrees<=15 or a.patience<1:p.error('Invalid augmentation or patience settings')
    if bool(a.base)==bool(a.resume):p.error('Choose exactly one of --base or --resume')
    checkpoint=(a.resume or a.base).resolve()
    if not checkpoint.is_file():p.error('Checkpoint must already exist locally')
    path, fingerprint=validated_dataset(a.dataset)
    output=a.output.resolve()
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    from ultralytics import YOLO
    model=YOLO(str(checkpoint))
    if model.task != 'detect':p.error('RDD2022 supplies boxes, not segmentation masks; use a detection checkpoint')
    config={**vars(a),'dataset':str(path),'dataset_manifest_sha256':fingerprint,'checkpoint_sha256':file_sha256(checkpoint),
            'versions':{k:importlib.metadata.version(k) for k in ('ultralytics','torch','torchvision','numpy','Pillow')},
            'python':sys.version,'optimizer':'AdamW','class_mapping':CLASSES}
    revision=subprocess.run(['git','rev-parse','HEAD'],cwd=Path(__file__).resolve().parent,capture_output=True,text=True)
    config['source_git_commit']=revision.stdout.strip() if revision.returncode==0 else None
    config={k:str(v) if isinstance(v,Path) else v for k,v in config.items()}
    if a.resume:
        previous=json.loads((output/'reproduction.json').read_text())
        if previous['dataset_manifest_sha256']!=fingerprint or previous['dataset']!=str(path):p.error('Resume dataset differs from original run')
        if checkpoint.parent != output/'weights' or checkpoint.name!='last.pt':p.error('Resume only this run\'s weights/last.pt')
        model.train(resume=True,device=a.device)
    else:
        output.mkdir(parents=True,exist_ok=False)
        (output/'reproduction.json').write_text(json.dumps(config,indent=2))
        model.train(data=str(path),epochs=a.epochs,imgsz=a.imgsz,batch=a.batch,lr0=a.lr,optimizer='AdamW',
                    seed=a.seed,deterministic=True,device=a.device,workers=a.workers,
                    project=str(output.parent),name=output.name,exist_ok=True,cache=False,
                    save=True,save_period=10,plots=True,mosaic=a.mosaic,scale=a.scale,degrees=a.degrees,patience=a.patience)
    best=output/'weights/best.pt'
    print(json.dumps({'best':str(best),'best_sha256':file_sha256(best) if best.exists() else None,
                      'notice':'Evaluate validation first. Freeze the checkpoint before held-out test evaluation. Do not configure the backend until reviewed.'},indent=2))


if __name__=='__main__':main()
