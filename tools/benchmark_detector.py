"""Bounded two-epoch benchmark on training/validation only; never enables production inference."""
import argparse
import json
import math
import os
from pathlib import Path
import random
import time

from train_detector import validated_dataset
from tools.prepare_rdd2022 import file_sha256


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('dataset',type=Path);p.add_argument('--base',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--device',default='mps')
    p.add_argument('--batch',type=int,default=2);p.add_argument('--imgsz',type=int,default=640)
    p.add_argument('--train-images',type=int,default=96);p.add_argument('--val-images',type=int,default=32)
    a=p.parse_args()
    if a.batch<1 or a.imgsz<64 or not 4<=a.train_images<=256 or not 4<=a.val_images<=64:p.error('Benchmark sizes outside bounded limits')
    if not a.base.is_file():p.error('Trusted local pretrained checkpoint required')
    dataset,fingerprint=validated_dataset(a.dataset)
    output=a.output.resolve();output.mkdir(parents=True,exist_ok=False)
    records=json.loads((dataset.parent/'manifest.json').read_text());rng=random.Random(42)
    counts={}
    for split,limit in [('train',a.train_images),('val',a.val_images)]:
        available=[r for r in records if r['split']==split];rng.shuffle(available)
        selected=available[:limit];counts[split]=len(available)
        (output/f'{split}.txt').write_text(''.join(str(dataset.parent/r['prepared_image'])+'\n' for r in selected))
    import yaml
    config={'path':str(output),'train':str(output/'train.txt'),'val':str(output/'val.txt'),'names':{0:'D00',1:'D10',2:'D20',3:'D40'}}
    (output/'benchmark.yaml').write_text(yaml.safe_dump(config))
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    from ultralytics import YOLO
    import torch
    model=YOLO(str(a.base.resolve()))
    times=[];state={}
    def start(trainer):state['start']=time.monotonic()
    def end(trainer):times.append(time.monotonic()-state['start'])
    model.add_callback('on_train_epoch_start',start)
    model.add_callback('on_train_epoch_end',end)
    started=time.monotonic()
    model.train(data=str(output/'benchmark.yaml'),epochs=2,imgsz=a.imgsz,batch=a.batch,device=a.device,
                workers=0,seed=42,deterministic=True,optimizer='AdamW',lr0=.001,cache=False,
                project=str(output),name='benchmark-only',exist_ok=False,plots=False,save=False,val=True)
    actual_train=min(a.train_images,counts['train'])
    epoch_estimate=times[-1]*math.ceil(counts['train']/a.batch)/math.ceil(actual_train/a.batch)
    report={'notice':'Resource pilot only. Its weights/metrics are not a trained final detector or evidence of accuracy. Linear extrapolation excludes full validation, thermal throttling and checkpoint overhead.',
            'dataset_manifest_sha256':fingerprint,'base_sha256':file_sha256(a.base),'device':a.device,
            'torch':torch.__version__,'imgsz':a.imgsz,'batch':a.batch,'train_epoch_seconds':times,
            'benchmark_wall_seconds':time.monotonic()-started,'full_train_images':counts['train'],
            'estimated_training_only_hours_50_epochs':epoch_estimate*50/3600,
            'estimated_training_only_hours_100_epochs':epoch_estimate*100/3600}
    (output/'benchmark-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))


if __name__=='__main__':main()
