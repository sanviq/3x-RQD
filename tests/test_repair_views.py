
"""Backend regression cases; the same supplied photo is also checked via live HTTP."""
import cv2
import numpy as np
from pathlib import Path
from app.repair_views import PhotoSettings, PhotoDefect, render_views, growth, blend
from app.features import decode_image

PHOTO = Path(__file__).parent/"fixtures/pothole-road.jpg"
QUAD = [[.44,.23],[.56,.23],[.99,.99],[.01,.99]]

def pixels(url):
    import base64
    return cv2.imdecode(np.frombuffer(base64.b64decode(url.split(",")[1]),np.uint8),cv2.IMREAD_UNCHANGED)

def test_real_photo_three_views_and_unchanged_surroundings():
    image=decode_image(PHOTO.read_bytes())
    result=render_views(image,QUAD,None,None,PhotoSettings(months=6,engine="opencv"))
    assert result["repair_count"]>0
    assert result["forecast_validated"] is False
    source=pixels(result["images"]["source"])
    repair=pixels(result["images"]["repaired"])
    prediction=pixels(result["images"]["predicted"])
    mask=pixels(result["masks"]["repair"])>0
    future=pixels(result["masks"]["prediction"])>0
    assert np.any(repair[mask]!=source[mask])
    np.testing.assert_array_equal(repair[~mask],source[~mask])
    np.testing.assert_array_equal(prediction[~future],source[~future])
    assert np.any(prediction!=repair)

def test_horizon_and_inputs_drive_monotonic_aging():
    good=growth(.7,PhotoSettings(months=3,repair_quality=1,traffic="light",weather="dry"))
    bad=growth(.7,PhotoSettings(months=12,repair_quality=.1,traffic="heavy",weather="wet"))
    assert bad["linear_scale"]>good["linear_scale"]
    assert bad["patch_degradation"]>good["patch_degradation"]
    assert bad["severity"]>=good["severity"]
    assert growth(.7,PhotoSettings(months=0))["patch_degradation"]==0

def test_missing_diffusion_falls_back_without_duplicating_source(monkeypatch):
    monkeypatch.setenv("ROAD_HEALTH_INPAINT_MODEL","")
    result=render_views(decode_image(PHOTO.read_bytes()),QUAD,None,None,PhotoSettings(engine="diffusers"))
    assert result["engine_used"]=="opencv_telea"
    assert result["fallback_reason"]
    assert result["images"]["source"]!=result["images"]["repaired"]

def test_generated_pixels_are_composited_inside_mask_only(monkeypatch):
    import app.repair_views as module
    monkeypatch.setattr(module,"_diffusers_repair",lambda image,mask,key:blend(image,np.full_like(image,90),mask))
    result=render_views(decode_image(PHOTO.read_bytes()),QUAD,None,None,PhotoSettings(engine="diffusers"))
    assert result["engine_used"]=="diffusers_inpainting"
    mask=pixels(result["masks"]["repair"])>0
    a,b=pixels(result["images"]["source"]),pixels(result["images"]["repaired"])
    np.testing.assert_array_equal(a[~mask],b[~mask])

def test_no_defects_do_not_invent_patches():
    image=np.full((128,128,3),110,np.uint8)
    result=render_views(image,QUAD,None,None,PhotoSettings())
    assert result["repair_count"]==0
    assert result["defects"]==[]
    assert result["images"]["source"]==result["images"]["predicted"]
