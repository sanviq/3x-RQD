"""Synthetic geometry contract tests. These do NOT establish real detection/score accuracy."""
import copy
import math
import numpy as np
import pytest
from fastapi import HTTPException
from app import road_quality_score as q

META={"width":640,"height":480,"sha256":"test","source_file_unchanged":True,"quality":{"flags":[]}}

def defect(id="A",x=.3,y=.4,w=.2,h=.2,severity=.8,confidence=.8):
    return {"id":id,"kind":"Pothole","polygon":[{"x":x,"y":y},{"x":x+w,"y":y},{"x":x+w,"y":y+h},{"x":x,"y":y+h}],"severity":severity,"confidence":confidence,"provenance":"opencv_candidate"}

def detection(ds,w=640,h=480,quad=None):
    return {"image":{"width":w,"height":h},"road_quad":quad or q.FULL_QUAD,"method":"opencv_multiscale_contours","defects":ds}

def score(ds,**kwargs):return q.calculate(detection(ds),META,**kwargs)

def test_empty_and_uncalibrated_are_explicit():
    a=score([])
    assert a["score"]==100 and a["rating"]=="Excellent"
    assert a["status"]=="provisional" and a["validated"] is False
    assert a["validation"]["mae"] is None and a["validation"]["pearson_r"] is None
    assert any("not proof" in v for v in a["uncertainty"])

def test_duplicate_and_overlapping_detections_never_add_penalties_twice():
    a=score([defect()]);b=score([defect(),defect("B")])
    assert a["score"]==b["score"]
    assert a["summary"]["affected_pixel_area"]==b["summary"]["affected_pixel_area"]
    assert sum(d["owned_pixel_area"] for d in b["defects"])==b["summary"]["unique_penalized_pixels"]
    assert sum(d["deduction_points"] for d in b["defects"])==pytest.approx(b["deduction_points"],abs=1e-4)

def test_count_alone_cannot_determine_the_score():
    small=score([defect(w=.04,h=.04)])
    large=score([defect(w=.4,h=.4)])
    assert small["summary"]["included_count"]==large["summary"]["included_count"]==1
    assert large["score"]<small["score"]

def test_severity_confidence_and_location_affect_risk():
    assert score([defect(severity=1)])["score"]<score([defect(severity=.1)])["score"]
    assert score([defect(confidence=1)])["score"]<score([defect(confidence=.1)])["score"]
    a=score([defect(x=.4,w=.2)])["defects"][0]
    b=score([defect(x=.01,w=.2)])["defects"][0]
    assert a["location_multiplier"]>b["location_multiplier"]

def test_exclusion_is_monotone_and_recalculates_owned_overlap():
    ds=[defect(),defect("B",x=.4,w=.3),defect("C",x=.1,w=.1)]
    original=score(ds);one=score(ds,excluded=["A"]);all_removed=score(ds,excluded=["A","B","C"])
    assert original["score"]<=one["score"]<=all_removed["score"]==100
    assert one["summary"]["excluded_count"]==1
    assert all_removed["summary"]["affected_pixel_area"]==0
    with pytest.raises(ValueError):score(ds,excluded=["wrong-snapshot-id"])

def test_native_resolution_normalization_and_disjoint_spatial_cells():
    ds=[defect()]
    a=q.calculate(detection(ds,320,240),META)
    b=q.calculate(detection(ds,1920,1440),META)
    assert abs(a["score"]-b["score"])<.5
    for v in (a,b):assert sum(c["road_pixels"] for c in v["cells"])==v["summary"]["visible_road_pixel_area"]

def test_road_footprint_clips_regions_and_source_detections_are_immutable():
    d=detection([defect(x=0,y=0,w=1,h=1)],quad=[[.3,0],[.7,0],[1,1],[0,1]])
    before=copy.deepcopy(d);a=q.calculate(d,META)
    assert d==before
    assert a["summary"]["affected_road_percent"]==100
    assert a["summary"]["visible_road_pixel_area"]<640*480

def test_zero_confidence_has_zero_deduction_without_inventing_confidence():
    a=score([defect(confidence=0)])
    assert a["score"]==100 and a["defects"][0]["confidence"]==0
    assert a["score_is_model_confidence"] is False

def test_box_and_water_uncertainty_are_discounted():
    d=defect();a=score([d])
    box={**d,"geometry_source":"bounding_box_schematic"};wet={**d,"appearance":"water or glare possible"}
    assert score([box])["score"]>=a["score"] and score([wet])["score"]>=a["score"]

@pytest.mark.parametrize("value,expected",[(0,"Critical"),(34.9,"Critical"),(35,"Poor"),(55,"Fair"),(75,"Good"),(90,"Excellent"),(100,"Excellent")])
def test_rating_boundaries(value,expected):assert q.rating(value,q.ScoreSettings())==expected

def test_caps_and_score_clamp():
    cfg=q.ScoreSettings(area_scale=10000,hotspot_scale=1000,spread_reference=.00001,opencv_discount=1,severity_discount=1,confidence_power=1)
    a=score([defect(x=0,y=0,w=1,h=1,severity=1,confidence=1)],cfg=cfg)
    assert a["score"]==0 and a["deduction_points"]==pytest.approx(100)
    with pytest.raises(ValueError):q.ScoreSettings(area_cap=100,hotspot_cap=50)
    with pytest.raises(ValueError):q.ScoreSettings(good=95,excellent=90)
    with pytest.raises(ValueError):q.ScoreSettings(area_scale=float("nan"))

def test_reference_metrics_are_defined_only_for_paired_finite_scores():
    m=q.reference_metrics([20,40],[10,50])
    assert m["mae"]==10 and m["pearson_r"]==pytest.approx(1)
    assert q.reference_metrics([50,50],[10,90])["pearson_r"] is None
    for a,b in (([],[]),([1],[float("nan")]),([1],[101])):
        with pytest.raises(ValueError):q.reference_metrics(a,b)

def test_snapshot_expiry_and_invalid_exclusion_request(monkeypatch):
    with pytest.raises(HTTPException) as exc:q.snapshot("missing-token")
    assert exc.value.status_code==410
    with pytest.raises(ValueError):q.Rescore(score_token="a"*32,excluded_ids=["A","A"])
    monkeypatch.setitem(q._snapshots,"expired",{"created":q.time.monotonic()-q.TTL-1})
    with pytest.raises(HTTPException):q.snapshot("expired")


def test_categorical_labels_never_become_invented_numeric_targets():
    m=q.categorical_metrics(["Good","Poor"],["Good","Critical"])
    assert m["n"]==2 and m["rating_agreement"]==.5
    assert m["confusion_matrix"]["Critical"]["Poor"]==1
    assert q.categorical_metrics([],[])["rating_agreement"] is None
    ref=q.Reference(score_token="a"*32,expert_rating="Poor")
    assert ref.expert_score is None


def test_snapshot_config_roundtrip_has_identical_fingerprint():
    import json
    original=q.ScoreSettings()
    restored=q.ScoreSettings.model_validate(original.model_dump())
    assert json.dumps(original.model_dump(),sort_keys=True)==json.dumps(restored.model_dump(),sort_keys=True)

def test_rdd_unsupported_types_are_unknown_not_confirmed_zeros():
    d=detection([]);d["method"]="yolo_rdd_detection"
    a=q.calculate(d,META)
    assert a["summary"]["by_type"]["Depression"] is None
    assert a["summary"]["by_type"]["Uneven surface"] is None


def test_boolean_expert_reference_is_not_a_numeric_rating():
    with pytest.raises(ValueError):q.Reference(score_token="a"*32,expert_score=True)
