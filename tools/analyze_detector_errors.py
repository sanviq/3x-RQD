"""Validation-only operating-point sweep and missed-box size analysis."""
import argparse
import json
from collections import Counter
from pathlib import Path
from tools.evaluate_detector import diagnostic_matches


def analyze(folder):
    folder=Path(folder); report=json.loads((folder/'report.json').read_text())
    if report['split']!='val':raise ValueError('Threshold selection is allowed on validation only')
    records=[json.loads(line) for line in (folder/'predictions.jsonl').read_text().splitlines()]
    sweep=[]
    for threshold in [.05,.10,.15,.20,.25,.30,.35,.40,.45,.50,.60,.70,.80]:
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
