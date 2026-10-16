from copy import deepcopy

import pytest

from tools.run_precision_refinement import compare_validation


def report():
    return {'split':'val','images':803,'dataset_manifest_sha256':'same','checkpoint_sha256':'candidate',
            'class_distribution':{'D00':4,'D10':3,'D20':2,'D40':1},
            'diagnostic':{'confidence':.35,'precision':.6,'recall':.25,'f1':.35},
            'ultralytics_metrics':{'metrics/mAP50(B)':.33}}


@pytest.mark.parametrize('field,value',[
    ('split','test'),('dataset_manifest_sha256','different'),('images',804),
    ('class_distribution',{'D00':10}),
])
def test_refinement_cannot_reuse_test_or_compare_different_data(field,value):
    candidate=report();candidate[field]=value
    with pytest.raises(ValueError,match='same validation'):compare_validation(report(),candidate)


def test_refinement_reports_actual_changes_without_promoting_or_hiding_regression():
    baseline=report();candidate=deepcopy(baseline)
    candidate['diagnostic'].update(precision=.9,recall=.1)
    result=compare_validation(baseline,candidate)
    assert result['diagnostic_deltas']['precision']==pytest.approx(.3)
    assert result['diagnostic_deltas']['recall']==pytest.approx(-.15)
    assert result['activation_enabled'] is False and result['requires_fresh_holdout'] is True
    candidate['diagnostic']['confidence']=.8
    with pytest.raises(ValueError,match='confidence policy'):compare_validation(baseline,candidate)
