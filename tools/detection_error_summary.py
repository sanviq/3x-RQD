"""Explain fixed-threshold errors without selecting a model or touching test splits."""
from collections import Counter
from tools.evaluate_detector import diagnostic_matches, iou
from tools.prepare_rdd2022 import CLASSES


def summarize_errors(records, threshold):
    codes=tuple(CLASSES)
    classes={code:Counter() for code in codes}
    sizes={name:Counter() for name in ('small_under_1pct','medium_1_to_10pct','large_over_10pct')}
    fp_types=Counter()
    for row in records:
        truth=row['ground_truth'];match=diagnostic_matches(truth,row['predictions'],threshold)
        for kind,items in match.items():
            for item in items:classes[codes[item['class_id']]][kind]+=1
        for kind,items in (('labels',truth),('missed',match['fn'])):
            for item in items:
                x1,y1,x2,y2=item['bbox'];area=(x2-x1)*(y2-y1)
                size='small_under_1pct' if area<.01 else 'medium_1_to_10pct' if area<.1 else 'large_over_10pct'
                sizes[size][kind]+=1
        for prediction in match['fp']:
            same=[g for g in truth if g['class_id']==prediction['class_id']]
            wrong=[g for g in truth if g['class_id']!=prediction['class_id']]
            if any(iou(prediction['bbox'],g['bbox'])>=.5 for g in same):reason='duplicate_same_class'
            elif any(iou(prediction['bbox'],g['bbox'])>=.5 for g in wrong):reason='overlapping_wrong_class'
            elif any(iou(prediction['bbox'],g['bbox'])>=.1 for g in truth):reason='partial_overlap_or_localization'
            else:reason='unmatched_background_or_unlabelled_damage'
            fp_types[reason]+=1
    per_class={}
    for code,counts in classes.items():
        tp,fp,fn=(counts[k] for k in ('tp','fp','fn'))
        p=tp/(tp+fp) if tp+fp else None
        r=tp/(tp+fn) if tp+fn else None
        per_class[code]={'tp':tp,'fp':fp,'fn':fn,'precision':p,'recall':r}
    return {'confidence':threshold,'iou':.5,'per_class':per_class,
            'misses_by_box_area':{k:{'labels':v['labels'],'missed':v['missed']} for k,v in sizes.items()},
            'false_positive_categories':dict(fp_types),
            'notice':'Annotation-relative error categories, not confirmed physical causes. Unmatched predictions may include unlabelled damage. Box size is not measured defect area. No hyperparameters or activation decisions are changed.'}
