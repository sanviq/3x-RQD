
"""Weather geometry/model/metric regression tests (pytest)."""
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import hashlib
import cv2
import numpy as np
import pytest
from PIL import Image
import app.weather_compare as weather

PHOTO=Path(__file__).parent/"fixtures/pothole-road.jpg"
QUAD=[[0,0],[1,0],[1,1],[0,1]]

@pytest.mark.parametrize("condition",weather.CONDITIONS)
def test_every_condition_preserves_shape_source_and_homography(condition):
    rng=np.random.default_rng(5)
    image=rng.integers(30,170,(1081,1739,3),dtype=np.uint8);before=image.copy()
    road=np.asarray([[0,0],[1738,0],[1738,1080],[0,1080]],np.float32)
    altered,matrix,effect,valid=weather.apply_condition(image,condition,.6,road)
    assert altered.shape==image.shape and effect.shape==image.shape[:2] and valid.shape==image.shape[:2]
    np.testing.assert_array_equal(image,before)
    points=np.asarray([[0,0],[600,450],[1738,1080]],np.float32)
    np.testing.assert_allclose(weather.project(weather.project(points,matrix),np.linalg.inv(matrix)),points,atol=.001)
    assert np.any(altered!=image)


def test_model_receives_native_copy_and_uses_original_pixel_coordinates(monkeypatch):
    seen=[]
    monkeypatch.setattr(weather.detection,"model_status",lambda:{"configured":True})
    monkeypatch.setattr(weather.detection,"_model",SimpleNamespace(names={0:"D40",1:"D00"}))
    def predict(image,mode,confidence,resolution):
        seen.append((image.shape,mode,resolution))
        return [SimpleNamespace(class_name="pothole",polygon=[(.2,.3),(.4,.3),(.4,.5),(.2,.5)],
                 bbox=(.2,.3,.4,.5),confidence=.87,severity=.5,detection_label="Pothole",detection_code="D40")]
    monkeypatch.setattr(weather.detection,"predict",predict)
    image=np.full((1081,1739,3),100,np.uint8);road=np.full(image.shape[:2],255,np.uint8)
    records,engine,status=weather.infer(image,road,.35,640)
    assert seen==[((1081,1739,3),"model",640)]
    assert engine=="trained_yolo" and records[0]["geometry"]=="model_segmentation"
    np.testing.assert_allclose(records[0]["polygon"][0],[1739*.2,1081*.3])
    assert status["weather_class_coverage"]==["Crack","Pothole"]


def test_detection_boxes_are_not_reported_as_segmentation(monkeypatch):
    monkeypatch.setattr(weather.detection,"model_status",lambda:{"configured":True})
    monkeypatch.setattr(weather.detection,"_model",SimpleNamespace(names={0:"pothole"}))
    d=SimpleNamespace(class_name="pothole",polygon=[],bbox=(.2,.3,.4,.5),confidence=.8,severity=.5,detection_label=None,detection_code=None)
    monkeypatch.setattr(weather.detection,"predict",lambda *args:[d])
    records,_,_=weather.infer(np.zeros((300,600,3),np.uint8),np.ones((300,600),np.uint8),.35,640)
    assert records[0]["geometry"]=="bounding_box_estimate"
    np.testing.assert_allclose(records[0]["polygon"],[[120,90],[240,90],[240,150],[120,150]])


def test_masks_clip_to_road_and_map_back_from_perspective():
    image=np.full((427,640,3),100,np.uint8)
    q=np.asarray([[200,100],[440,100],[639,426],[0,426]],np.float32)
    road=weather.points_mask(q,image.shape[:2])
    _,matrix,effect,valid=weather.apply_condition(image,"perspective",.8,q)
    poly=np.asarray([[250,200],[350,200],[350,260],[250,260]],np.float32)
    raw=[{"kind":"Pothole","polygon":weather.project(poly,matrix),"confidence":.8,"severity":.6,"geometry":"model_segmentation"}]
    records,summary=weather.prepare_records(raw,matrix,road,cv2.warpPerspective(road,matrix,(640,427)),valid,effect,"perspective",{"repeat_capture":False})
    np.testing.assert_allclose(weather.box(records[0]["reference_polygon"]),weather.box(poly),atol=2)
    assert summary["affected_pixel_area"]<=summary["visible_road_pixel_area"]
    assert records[0]["physical_dimensions"] is None


def test_metrics_require_real_annotations_and_use_one_to_one_matches():
    assert weather.evaluate([],None)["f1"] is None
    a={"id":"known","kind":"Pothole","reference_polygon":[[10,10],[20,10],[20,20],[10,20]]}
    metric=weather.evaluate([{**a,"id":"p1"},{**a,"id":"p2"}],[a])
    assert (metric["tp"],metric["fp"],metric["fn"])==(1,1,0)
    assert metric["precision"]==.5 and metric["recall"]==1 and metric["f1"]==pytest.approx(2/3)
    assert weather.evaluate([],[])["f1"] is None


def test_exact_bundled_bytes_only_supply_ground_truth():
    p=Path(__file__).parent.parent/"data/examples/rdd2022/India_India_000114.jpg"
    with Image.open(p) as im: w,h=im.size
    known=weather.bundled_annotations(hashlib.sha256(p.read_bytes()).hexdigest(),w,h,1)
    assert known and all(a.kind in {"Pothole","Crack"} for a in known)
    assert weather.bundled_annotations(hashlib.sha256(PHOTO.read_bytes()).hexdigest(),640,427,1) is None


def test_native_comparison_metadata_exif_and_no_invented_accuracy(monkeypatch):
    monkeypatch.setattr(weather.detection,"model_status",lambda:{"configured":False})
    with Image.open(PHOTO) as original:
        exif=original.getexif();exif[274]=6;buffer=BytesIO();original.save(buffer,format="JPEG",exif=exif)
    data=buffer.getvalue()
    result=weather.compare_weather(data,"upright.jpg",["low_light"],.6,QUAD,True,.35,640,None)
    try:
        assert (result["metadata"]["width"],result["metadata"]["height"])==(427,640)
        assert result["metadata"]["sha256"]==hashlib.sha256(data).hexdigest()
        assert result["ground_truth_supplied"] is False
        assert all(f["metrics"]["f1"] is None for f in result["frames"])
    finally:
        token=result["frames"][0]["image_path"].split("/")[2]
        weather._remove(weather._jobs.pop(token)["dir"])


def test_bad_ground_truth_rejected():
    with pytest.raises(ValueError):
        weather.GroundTruth(id="bad",kind="Pothole",polygon=[[0,0],[2,0],[0,1]])
    with pytest.raises(ValueError):
        weather.GroundTruth(id="flat",kind="Pothole",polygon=[[0,0],[.5,.5],[1,1]])


def test_smooth_road_does_not_seed_demo_defects(monkeypatch):
    monkeypatch.setattr(weather.detection,"model_status",lambda:{"configured":False})
    image=np.full((427,640,3),110,np.uint8)
    records,engine,_=weather.infer(image,np.full(image.shape[:2],255,np.uint8),.35,640)
    assert records==[] and engine=="opencv_candidates"


def test_native_cv_option_never_calls_resize(monkeypatch):
    from app.defects import detect_defects
    def forbidden(*args,**kwargs): raise AssertionError("Native input must not be resized")
    monkeypatch.setattr(cv2,"resize",forbidden)
    result=detect_defects(np.full((1081,1739,3),110,np.uint8),native_resolution=True)
    assert result["image"]=={"width":1739,"height":1081}


def test_comparison_respects_registry_operating_point(monkeypatch):
    monkeypatch.setattr(weather.detection,"model_status",lambda:{"configured":True,"confidence":.61,"imgsz":768})
    seen=[]
    def infer(image,road,confidence,resolution):
        seen.append((confidence,resolution))
        return [],"trained_yolo",{"configured":True,"weather_class_coverage":["Pothole","Crack"]}
    monkeypatch.setattr(weather,"infer",infer)
    result=weather.compare_weather(PHOTO.read_bytes(),"road.jpg",["rain"],.5,QUAD,False,None,None,None)
    try:
        assert seen==[(.61,768),(.61,768)]
        assert result["configuration"]["confidence"]==.61
    finally:
        token=result["frames"][0]["image_path"].split("/")[2]
        weather._remove(weather._jobs.pop(token)["dir"])
