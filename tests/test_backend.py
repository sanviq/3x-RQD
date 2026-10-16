import csv

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.features import decode_image, extract_features
from app.main import app
from app.scoring import load_model, score
from train import train


def chip_image():
    image = np.full((256, 256, 3), 50, np.uint8)
    for x in range(32, 240, 40):
        for y in range(32, 240, 40):
            cv2.circle(image, (x, y), 10, (180, 180, 180), -1)
    return image


def test_calibration_changes_units_not_detection():
    first, _ = extract_features(chip_image(), 1)
    second, _ = extract_features(chip_image(), 2)
    assert first["chip_candidate_count"] > 0
    assert first["features"] == second["features"]
    a, b = first["physical_measurements"], second["physical_measurements"]
    assert b["area_sq_ft"] == 4 * a["area_sq_ft"]
    assert b["chip_candidates_per_sq_ft"] == a["chip_candidates_per_sq_ft"] / 4
    assert b["mean_chip_diameter_mm"] == 2 * a["mean_chip_diameter_mm"]


def test_uncalibrated_and_constant_image():
    result, _ = extract_features(np.full((128, 128, 3), 100, np.uint8))
    assert result["chip_candidate_count"] == 0
    assert all(v is None for v in result["physical_measurements"].values())
    assert all(np.isfinite(v) for v in result["features"].values())
    assert score(result["features"])["road_quality_index"] is None


def test_upload_validation_and_response():
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.post("/analyze", files={"image": ("bad.jpg", b"bad")}).status_code == 422
        _, encoded = cv2.imencode(".png", chip_image())
        files = {"image": ("road.png", encoded.tobytes(), "image/png")}
        assert client.post("/analyze", files=files, data={"mm_per_pixel": -1}).status_code == 422
        result = client.post("/analyze", files=files, data={"include_overlay": True})
        assert result.status_code == 200
        body = result.json()
        assert body["assessment"]["road_quality_index"] is None
        assert body["assessment"]["band"] == "unassessable"
        assert body["assessment"]["validated"] is False
        assert body["inclination"]["degrees"] is None
        assert body["overlay_png_base64"]


def test_physical_area_survives_processing_resize():
    image = cv2.resize(chip_image(), (1500, 1200))
    result, _ = extract_features(image, 0.5)
    assert result["image"]["processed_width"] == 1024
    assert np.isclose(result["physical_measurements"]["area_sq_ft"],
                      1500 * 1200 * 0.5 ** 2 / 92903.04)


def test_training_artifact_and_prediction(tmp_path):
    csv_path = tmp_path / "labels.csv"
    with csv_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["image_path", "quality_score", "route_id"])
        for index in range(24):
            image = chip_image()
            cv2.line(image, (10, 10), (200, 200), (0, 0, 0), 1 + index % 8)
            path = tmp_path / f"road_{index}.png"
            assert cv2.imwrite(str(path), image)
            writer.writerow([path.name, 95 - (index % 8) * 10, f"route_{index // 8}"])
    output = tmp_path / "model.joblib"
    metrics = train(csv_path, output)
    assert metrics["train_images"] + metrics["test_images"] == 24
    # Entire held-out route (8 images) is absent from fitting.
    assert metrics["test_images"] == 8
    assert len(metrics["test_routes"]) == 1
    artifact = load_model(output)
    result, _ = extract_features(chip_image())
    assessment = score(result["features"], artifact, capture_type="surface_crop")
    assert assessment["method"] == "trained_random_forest"
    assert assessment["road_quality_index"] is None
    assert 0 <= assessment["visual_proxy_index"] <= 100
    assert output.with_suffix(".metrics.json").exists()


def test_selected_road_excludes_scenery_from_all_descriptors():
    quad = [[32/127, 32/127], [95/127, 32/127],
            [95/127, 95/127], [32/127, 95/127]]
    y, x = np.indices((128, 128))
    texture = (60 + ((x * 19 + y * 31 + x * y) % 150)).astype(np.uint8)
    road = (x >= 32) & (x <= 95) & (y >= 32) & (y <= 95)
    dark = np.zeros((128, 128, 3), np.uint8)
    bright = np.full_like(dark, 255)
    dark[road] = texture[road, None]
    bright[road] = texture[road, None]
    first, overlay = extract_features(dark, 1, quad)
    second, _ = extract_features(bright, 1, quad)
    assert first["features"] == second["features"]
    assert first["chip_candidate_count"] == second["chip_candidate_count"]
    assert first["analysis_region"]["processed_pixel_count"] == 4096
    assert np.isclose(first["physical_measurements"]["area_sq_ft"], 4096 / 92903.04)
    assert overlay.shape == dark.shape


def test_selected_road_rejects_insufficient_region():
    import pytest
    with pytest.raises(ValueError, match="too small"):
        extract_features(chip_image(), road_quad=[[.5, .5], [.501, .5], [.501, .501], [.5, .501]])
