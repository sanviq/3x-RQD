"""Separate validation/held-out evaluation with raw predictions and FP/FN examples."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path

import cv2
import numpy as np

from train_detector import validated_dataset
from tools.prepare_rdd2022 import CLASSES, file_sha256


def iou(a,b):
    intersection=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    return intersection/max(1e-12,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection)


def diagnostic_matches(truth,predictions,threshold=.25):
    preds=sorted([p for p in predictions if p['confidence']>=threshold],key=lambda p:-p['confidence'])
    used=set();tp=[];fp=[]
    for p in preds:
        candidates=[(iou(p['bbox'],g['bbox']),i) for i,g in enumerate(truth) if i not in used and g['class_id']==p['class_id']]
        overlap,index=max(candidates,default=(0,None))
        if overlap>=.5:used.add(index);tp.append(p)
        else:fp.append(p)
    return {'tp':tp,'fp':fp,'fn':[g for i,g in enumerate(truth) if i not in used]}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('dataset',type=Path);p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--split',choices=['val','test'],default='val')
    p.add_argument('--device',default='mps');p.add_argument('--imgsz',type=int,default=640);p.add_argument('--batch',type=int,default=4)
    p.add_argument('--confidence',type=float,default=.25,help='Diagnostic FP/FN threshold; AP uses the full confidence ranking')
    p.add_argument('--frozen-sha256',help='Required for held-out test; explicitly identify the frozen checkpoint')
    a=p.parse_args()
    if not 0<=a.confidence<=1 or a.imgsz<64 or a.batch<1:p.error('Invalid evaluation settings')
    dataset,fingerprint=validated_dataset(a.dataset)
    checksum=file_sha256(a.checkpoint)
    if a.split=='test' and a.frozen_sha256!=checksum:p.error('Freeze the final checkpoint and pass its exact SHA256 before evaluating test')
    os.environ['YOLO_AUTOINSTALL'] = 'false'
    from ultralytics import YOLO
    model=YOLO(str(a.checkpoint.resolve()))
    if model.task!='detect' or model.names!=dict(enumerate(CLASSES)):p.error('Checkpoint must be an RDD2022 four-class detector')
    output=a.output.resolve();output.mkdir(parents=True,exist_ok=False)
    metrics=model.val(data=str(dataset),split=a.split,imgsz=a.imgsz,batch=a.batch,device=a.device,workers=0,
                      conf=.001,plots=True,save_json=False,project=str(output),name='ultralytics',exist_ok=False)
    manifest=json.loads((dataset.parent/'manifest.json').read_text())
    records=[r for r in manifest if r['split']==a.split]
    index={str((dataset.parent/r['prepared_image']).resolve()):r for r in records}
    per_class={code:{'tp':0,'fp':0,'fn':0} for code in CLASSES}; totals=Counter(); examples=Counter()
    country_counts={}
    (output/'examples').mkdir()
    with (output/'predictions.jsonl').open('x') as f:
        # A directory uses streaming file loading; a Python list can eagerly load
        # thousands of high-resolution Norway images into unified memory.
        predictions=model.predict(source=str(dataset.parent/'images'/a.split),stream=True,
                                  imgsz=a.imgsz,batch=a.batch,device=a.device,conf=.001,verbose=False,max_det=300)
        seen=set()
        for result in predictions:
            path=str(Path(result.path).resolve());r=index[path];seen.add(path)
            truth=[{'class_id':c,'bbox':[x-w/2,y-h/2,x+w/2,y+h/2]} for c,x,y,w,h in r['labels']]
            coordinates=result.boxes.xyxyn.cpu().numpy()
            class_ids=result.boxes.cls.cpu().numpy().astype(int)
            confidences=result.boxes.conf.cpu().numpy()
            pred=[{'class_id':int(c),'confidence':float(score),'bbox':box.tolist()}
                  for c,score,box in zip(class_ids,confidences,coordinates)]
            match=diagnostic_matches(truth,pred,a.confidence)
            country=country_counts.setdefault(r['country'],{'images':0,'tp':0,'fp':0,'fn':0})
            country['images']+=1
            for kind in ('tp','fp','fn'):
                totals[kind]+=len(match[kind])
                country[kind]+=len(match[kind])
                for item in match[kind]:per_class[list(CLASSES)[item['class_id']]][kind]+=1
            f.write(json.dumps({'source_image':r['source_image'],'country':r['country'],'image_sha256':r['image_sha256'],
                                'ground_truth':truth,'predictions':pred,'diagnostic':match})+'\n')
            kinds=[k for k in ('fp','fn') if match[k]] or ['representative']
            for kind in kinds:
                if examples[kind]>=12:continue
                image=result.orig_img.copy();h,w=image.shape[:2]
                for items,color,prefix in ((truth,(0,200,0),'GT'),([x for x in pred if x['confidence']>=a.confidence],(0,0,230),'PRED')):
                    for item in items:
                        x1,y1,x2,y2=[int(v*s) for v,s in zip(item['bbox'],[w,h,w,h])]
                        cv2.rectangle(image,(x1,y1),(x2,y2),color,2)
                        label=f'{prefix} {list(CLASSES)[item["class_id"]]}'
                        if 'confidence' in item:label+=f' {item["confidence"]:.2f}'
                        cv2.putText(image,label,(x1,max(16,y1-3)),cv2.FONT_HERSHEY_SIMPLEX,.5,color,1)
                cv2.imwrite(str(output/'examples'/f'{kind}-{examples[kind]:02d}.jpg'),image);examples[kind]+=1
        if seen!=set(index):raise ValueError('Prediction inventory did not match the evaluated split')
    t=totals;precision=t['tp']/max(1,t['tp']+t['fp']);recall=t['tp']/max(1,t['tp']+t['fn'])
    for counts in country_counts.values():
        p=counts['tp']/max(1,counts['tp']+counts['fp']);r=counts['tp']/max(1,counts['tp']+counts['fn'])
        counts.update(precision=p,recall=r,f1=2*p*r/max(1e-12,p+r))
    report={'split':a.split,'checkpoint_sha256':checksum,'dataset_manifest_sha256':fingerprint,'images':len(records),
            'ultralytics_metrics':{k:float(v) for k,v in metrics.results_dict.items()},
            'per_class_metrics':{list(CLASSES)[int(c)]:{'precision':float(metrics.box.p[i]),'recall':float(metrics.box.r[i]),
                'f1':float(metrics.box.f1[i]),'map50':float(metrics.box.ap50[i]),'map50_95':float(metrics.box.ap[i])} for i,c in enumerate(metrics.box.ap_class_index)},
            'class_distribution':{code:v['tp']+v['fn'] for code,v in per_class.items()},
            'country_view_diagnostics':country_counts,
            'diagnostic':{'confidence':a.confidence,'iou':.5,'precision':precision,'recall':recall,'f1':2*precision*recall/max(1e-12,precision+recall),**dict(t),'per_class_counts':per_class},
            'notice':'Internal labelled holdout; not official challenge test accuracy. Ultralytics P/R use its operating-point convention; diagnostic P/R use the explicit threshold. No model improvement claim without a matched held-out baseline comparison.'}
    (output/'report.json').write_text(json.dumps(report,indent=2))
    # Reuse saved predictions: no extra model inference, GPU work or test tuning.
    from tools.detection_error_summary import summarize_errors
    with (output/'predictions.jsonl').open() as f:
        errors=summarize_errors((json.loads(line) for line in f),a.confidence)
    errors.update(split=a.split,checkpoint_sha256=checksum)
    (output/'error-summary.json').write_text(json.dumps(errors,indent=2))
    if a.split=='val':
        from tools.analyze_detector_errors import precision_profile
        with (output/'predictions.jsonl').open() as f:
            profile=precision_profile((json.loads(line) for line in f),split=a.split,checkpoint_sha256=checksum)
        (output/'precision-profile.json').write_text(json.dumps(profile,indent=2))
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
