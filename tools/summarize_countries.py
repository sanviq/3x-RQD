"""Describe sampled, annotated captures without inventing national road-health rankings."""
import argparse
from collections import Counter
import json
from pathlib import Path
import numpy as np
from tools.prepare_rdd2022 import CLASSES, file_sha256


def summarize(manifest, evaluation=None):
    manifest=Path(manifest); records=json.loads(manifest.read_text());rows=[]
    measured=json.loads(Path(evaluation).read_text()) if evaluation else {}
    for subset in sorted({r['country'] for r in records}):
        images=[r for r in records if r['country']==subset]; counts=Counter(); coverages=[];small=0
        for r in images:
            mask=np.zeros((256,256),np.uint8)
            for c,x,y,w,h in r['labels']:
                counts[list(CLASSES)[c]]+=1
                small+=w*h<.01
                x1,y1=max(0,int((x-w/2)*256)),max(0,int((y-h/2)*256))
                x2,y2=min(256,int(np.ceil((x+w/2)*256))),min(256,int(np.ceil((y+h/2)*256)))
                mask[y1:y2,x1:x2]=1
            coverages.append(float(mask.mean()))
        n=len(images);total=sum(counts.values())
        rows.append({'subset':subset,'country':'China' if subset.startswith('China_') else subset,
                     'images':n,'splits':dict(Counter(r['split'] for r in images)),
                     'annotation_counts':{c:counts[c] for c in CLASSES},'annotation_boxes_per_image':total/n,
                     'mean_box_union_image_fraction':sum(coverages)/n,
                     'small_box_fraction':small/max(1,total),
                     'mean_original_megapixels':sum(r['width']*r['height']/1e6 for r in images)/n,
                     'detection_evaluation':measured.get('country_view_diagnostics',{}).get(subset),
                     'road_health_score':None})
    return {'provenance':'real_rdd2022_human_annotations','images':len(records),'rows':rows,
            'manifest_sha256':file_sha256(manifest),'evaluation_split':measured.get('split'),
            'evaluation_checkpoint_sha256':measured.get('checkpoint_sha256'),
            'source':'https://figshare.com/articles/dataset/21431547','license':'CC BY 4.0',
            'coverage_method':'Approximate union of human bounding rectangles on a 256-square normalized image grid; includes background inside boxes and is not segmentation or physical damaged area.',
            'notice':'Class-enriched research samples, not representative road surveys. Compare these captures only, not national road quality. Drone and motorbike views are distinct. Differences may reflect camera angle, resolution, annotation size and class mix; climate, materials, maintenance quality and causal explanations are not established.',
            'needed_for_country_quality_comparison':['Representative route sampling and inspected distances','Matched cameras, calibration and capture conditions','Independent condition/severity ratings','Traffic, weather, construction and maintenance records','Country- and route-disjoint detector validation']}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest',type=Path);p.add_argument('--evaluation',type=Path);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output.write_text(json.dumps(summarize(a.manifest,a.evaluation),indent=2)+'\n')
