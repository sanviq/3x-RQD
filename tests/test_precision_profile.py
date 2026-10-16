import pytest

from tools.analyze_detector_errors import precision_profile
from tools.evaluate_detector import diagnostic_matches


def box(class_id=0, confidence=None, bbox=None):
    item={'class_id':class_id,'bbox':bbox or [.1,.1,.3,.3]}
    if confidence is not None:item['confidence']=confidence
    return item


def test_precision_filter_retains_recall_floor_and_reveals_unsupported_classes():
    records=[{'ground_truth':[box()], 'predictions':[box(confidence=.8),box(confidence=.2)]}]
    report=precision_profile(records,split='val',checkpoint_sha256='frozen')
    selected=report['precision_priority_operating_point']
    assert selected['confidence']==.21
    assert (selected['tp'],selected['fp'],selected['fn'])==(1,0,0)
    assert selected['precision']==selected['recall']==1
    assert report['precision_targets_with_recall_floor']['0.90']['recall']==1
    assert selected['per_class']['D10']['recall'] is None
    assert report['checkpoint_sha256']=='frozen'


def test_filter_cannot_manufacture_success_by_suppressing_everything():
    records=[{'ground_truth':[box()], 'predictions':[box(1,.9)]}]
    profile=precision_profile(records,split='val',checkpoint_sha256='a')
    assert profile['precision_priority_operating_point'] is None
    assert profile['precision_targets_with_recall_floor']['0.90'] is None
    assert profile['threshold_sweep'][-1]['precision'] is None
    assert profile['threshold_sweep'][-1]['recall']==0
    with pytest.raises(ValueError,match='validation only'):
        precision_profile(records,split='test',checkpoint_sha256='a')


def test_single_matching_pass_matches_full_rematching_at_every_threshold():
    # Duplicate boxes, tied scores, wrong classes, partial overlap and empty images.
    records=[{'ground_truth':[box(),box(1,bbox=[.5,.5,.9,.9])],
              'predictions':[box(confidence=.65),box(confidence=.65),box(1,.42),
                             box(1,.42,[.5,.5,.9,.9]),box(0,.015,[.15,.15,.35,.35])]},
             {'ground_truth':[], 'predictions':[box(3,.3)]},
             {'ground_truth':[box(2)], 'predictions':[]}]
    profile=precision_profile(records,split='val',checkpoint_sha256='a')
    for point in profile['threshold_sweep']:
        matches=[diagnostic_matches(r['ground_truth'],r['predictions'],point['confidence']) for r in records]
        for kind in ('tp','fp','fn'):
            assert point[kind]==sum(len(m[kind]) for m in matches)


def test_ninety_percent_target_rejects_high_precision_with_most_damage_missed():
    records=[{'ground_truth':[box()], 'predictions':[box(confidence=.9)]}]
    records.extend({'ground_truth':[box()], 'predictions':[]} for _ in range(9))
    report=precision_profile(records,split='val',checkpoint_sha256='a')
    assert report['threshold_sweep'][0]['precision']==1
    assert report['threshold_sweep'][0]['recall']==.1
    assert report['precision_targets_with_recall_floor']['0.90'] is None
