"""Regression evidence, not a measurement of detector accuracy on a population."""
from pathlib import Path
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.defects import detect_defects, parse_quad
from app.main import app

PHOTO = Path(__file__).parent / "fixtures" / "pothole-road.jpg"
QUAD = [[.44, .23], [.56, .23], [.99, .99], [.01, .99]]


def test_real_photo_contains_foreground_water_filled_candidate():
    image = cv2.imread(str(PHOTO))
    result = detect_defects(image, QUAD)
    # Human-inspected foreground cavity. These coordinates belong to the test only.
    def contains_foreground(d):
        b = d["bbox"]
        return b["x"] <= 375 <= b["x"]+b["width"] and b["y"] <= 336 <= b["y"]+b["height"]
    assert any(d["kind"] == "Pothole" and contains_foreground(d) for d in result["defects"])
    assert result["confidence_calibrated"] is False
    assert result["requires_review"] is True
    assert all(d["depth_mm"] is None and d["physical_dimensions"] is None for d in result["defects"])
    assert all(0 <= d["confidence"] <= 1 and 0 <= d["severity"] <= 1 for d in result["defects"])


def test_smooth_and_low_detail_images_have_no_manufactured_defects():
    for tone in [0, 100, 255]:
        result = detect_defects(np.full((256, 384, 3), tone, np.uint8))
        assert result["defects"] == []
    rng = np.random.default_rng(13)
    smooth = np.clip(120+rng.normal(0, 2, (256, 384, 3)), 0, 255).astype(np.uint8)
    assert detect_defects(smooth)["defects"] == []


def test_original_and_road_polygons_round_trip():
    image = cv2.imread(str(PHOTO))
    result = detect_defects(image, QUAD)
    transform = cv2.getPerspectiveTransform(np.array([[0, 0], [1, 0], [1, 1], [0, 1]], np.float32),
                                             np.array(QUAD, np.float32))
    for d in result["defects"]:
        p = np.array([[v["x"], v["y"]] for v in d["road_polygon"]], np.float32)
        original = cv2.perspectiveTransform(p.reshape(-1, 1, 2), transform).reshape(-1, 2)
        assert np.allclose(original, [[v["x"], v["y"]] for v in d["polygon"]], atol=2e-4)


@pytest.mark.parametrize("quad", ["invalid", "[]", "[[0,0],[1,1],[1,0],[0,1]]"])
def test_invalid_footprints_rejected(quad):
    with pytest.raises(ValueError):
        parse_quad(quad)


def test_real_http_contract_and_existing_analysis_include_geometry():
    with TestClient(app) as client:
        body = PHOTO.read_bytes()
        files = {"image": ("pothole.jpg", body, "image/jpeg")}
        detection = client.post("/detect-defects", files=files)
        assert detection.status_code == 200 and detection.json()["defects"]
        analysis = client.post("/analyze", files=files)
        assert analysis.status_code == 200
        assert analysis.json()["defect_detection"]["method"] == "opencv_multiscale_contours"
        assert analysis.json()["assessment"]["road_quality_index"] is None
        assert client.post("/detect-defects", files=files, data={"road_quad": "[]"}).status_code == 422
        assert client.post("/detect-defects", files={"image": ("bad.jpg", b"invalid")}).status_code == 422
