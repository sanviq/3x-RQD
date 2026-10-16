"""Validation-only operating-point sweep and missed-box size analysis."""
import argparse
import json
from collections import Counter
from pathlib import Path
from tools.evaluate_detector import diagnostic_matches
from tools.prepare_rdd2022 import CLASSES


def precision_profile(records, *, split, checkpoint_sha256):
    """Validation-only precision choices, retaining missed detections and class support."""
    if split != 'val':
        raise ValueError('Threshold selection is allowed on validation only')
    records=list(records)
    # Matching is confidence ordered. Removing a low-confidence suffix cannot
    # change earlier matches, so match once rather than 99 times per image.
    events=[]; support=Counter()
    for row in records:
        support.update(g['class_id'] for g in row['ground_truth'])
        match=diagnostic_matches(row['ground_truth'],row['predictions'],0)
        for kind in ('tp','fp'):
            events.extend((p['confidence'],p['class_id'],kind) for p in match[kind])
    def metrics(counts, labels):
        tp,fp=counts['tp'],counts['fp'];fn=labels-tp
        p=tp/(tp+fp) if tp+fp else None
        r=tp/labels if labels else None
        return dict(tp=tp,fp=fp,fn=fn,precision=p,recall=r,
                    f1=2*p*r/(p+r) if p is not None and r is not None and p+r else 0)
    sweep=[]
    for percent in range(1,100):
        threshold=percent/100; counts=Counter(); classes={i:Counter() for i in range(len(CLASSES))}
        for confidence,class_id,kind in events:
            if confidence>=threshold:
                counts[kind]+=1;classes[class_id][kind]+=1
        sweep.append(dict(confidence=threshold,**metrics(counts,sum(support.values())),
                          per_class={code:metrics(classes[i],support[i]) for i,code in enumerate(CLASSES)}))
    eligible=[s for s in sweep if s['precision'] is not None and s['precision']>=.5
              and s['recall'] is not None and s['recall']>=.3]
    selected=max(eligible,key=lambda s:(s['precision'],s['recall'],-s['confidence'])) if eligible else None
    targets={}
    for target in (.5,.7,.8,.9):
        candidates=[s for s in sweep if s['precision'] is not None and s['precision']>=target
                    and s['recall'] is not None and s['recall']>=.3]
        targets[f'{target:.2f}']=max(candidates,key=lambda s:(s['recall'],s['precision'],-s['confidence'])) if candidates else None
    return dict(split=split,checkpoint_sha256=checkpoint_sha256,threshold_sweep=sweep,
                precision_priority_operating_point=selected,
                precision_targets_with_recall_floor=targets,
                selection_constraints=dict(minimum_precision=.5,minimum_recall=.3),
                notice='Validation recommendation only; not automatically activated. Highest precision on a 0.01 grid subject to recall >= .30 and precision >= .50. Null means no eligible setting. Per-class misses remain visible. Filtering does not improve mAP or prove field accuracy; verify a frozen policy on held-out data before activation.')


def analyze(folder):
    folder=Path(folder); report=json.loads((folder/'report.json').read_text())
    if report['split']!='val':raise ValueError('Threshold selection is allowed on validation only')
    records=[json.loads(line) for line in (folder/'predictions.jsonl').read_text().splitlines()]
    sweep=[]
    for threshold in [i/100 for i in range(1,100)]:
        counts=Counter()
        for row in records:
            match=diagnostic_matches(row['ground_truth'],row['predictions'],threshold)
            counts.update({k:len(v) for k,v in match.items()})
        p=counts['tp']/max(1,counts['tp']+counts['fp']);r=counts['tp']/max(1,counts['tp']+counts['fn'])
        sweep.append({'confidence':threshold,'precision':p,'recall':r,'f1':2*p*r/max(1e-12,p+r),**counts})
    sizes={name:Counter() for name in ('small_under_1pct','medium_1_to_10pct','large_over_10pct')}
    for row in records:
        match=diagnostic_matches(row['ground_truth'],row['predictions'],.35)
        for kind,objects in [('ground_truth',row['ground_truth']),('missed',match['fn'])]:
            for item in objects:
                x1,y1,x2,y2=item['bbox'];area=(x2-x1)*(y2-y1)
                bucket='small_under_1pct' if area<.01 else 'medium_1_to_10pct' if area<.1 else 'large_over_10pct'
                sizes[bucket][kind]+=1
    eligible=[s for s in sweep if s['precision']>=.5 and s['recall']>=.3]
    return {'split':'val','checkpoint_sha256':report['checkpoint_sha256'],'threshold_sweep':sweep,
            'selected_operating_point':max(eligible,key=lambda s:s['f1']) if eligible else None,
            'misses_by_normalized_box_area':{k:dict(v) for k,v in sizes.items()},
            'notice':'Operating point selected on validation only with precision >= .50 and recall >= .30. Area refers to annotation rectangles, not actual damage. No threshold can substitute for model quality.'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('folder',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output.write_text(json.dumps(analyze(a.folder),indent=2)+'\n')
