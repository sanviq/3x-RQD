"""Surface descriptors and optional locally trained regression; never confuse proxies with road health."""
from pathlib import Path
import joblib
import numpy as np
from app.features import FEATURE_NAMES, FEATURE_VERSION

DEFAULT_MODEL = Path(__file__).resolve().parents[1] / "models" / "road_quality.joblib"


def load_model(path=DEFAULT_MODEL):
    # joblib can execute code. Only load your own local training artifacts.
    if not Path(path).exists():
        return None
    artifact = joblib.load(path)
    if artifact.get("feature_version") != FEATURE_VERSION or artifact.get("feature_names") != FEATURE_NAMES:
        raise ValueError("Incompatible model feature schema. Use matching weights; do not reuse weights from an earlier feature version.")
    return artifact


def score(features, artifact=None, capture_type="road_scene"):
    reasons = []
    if capture_type != "surface_crop":
        reasons.append("Perspective captures support road-region texture descriptors, but cannot establish calibrated aggregate dimensions or a road-health grade. Use a sharp, uniformly scaled close-up for aggregate sizing.")
    if features["brightness_std"] < 8 / 255 or features["laplacian_variance"] < 25:
        reasons.append("Insufficient texture detail or contrast. Use a sharp, well-lit surface crop.")
    if features["brightness_mean"] < 25 / 255 or features["brightness_mean"] > 235 / 255:
        reasons.append("Extreme exposure makes surface measurements unreliable.")
    if features["chip_count_per_megapixel"] <= 0 or features["chip_coverage_fraction"] <= 0:
        reasons.append("No aggregate candidates were resolved. Missing detections are not evidence of a healthy road.")
    result = {"road_quality_index": None, "scale": "0 (low) to 100 (high)",
              "band": "unassessable", "method": "unsuitable_capture" if reasons else "no_trained_model",
              "validated": False, "reasons": reasons, "visual_proxy_index": None,
              "interpretation": "No road-health verdict is available. Texture descriptors do not establish road condition, defect classes, or confidence."}
    if reasons:
        result["interpretation"] = " ".join(reasons)
        return result
    if artifact is None:
        # Retained solely as an inspectable research descriptor. It has no condition band.
        penalty = (55 * min(1, features["dark_linear_fraction"] / 0.08)
                   + 25 * min(1, features["dark_region_fraction"] / 0.25)
                   + 20 * (1 - features["packing_uniformity"]))
        result["visual_proxy_index"] = round(float(np.clip(100 - penalty, 0, 100)), 2)
        result["interpretation"] = "No trained road-condition model is installed. The diagnostic texture index is an arbitrary heuristic, not a road-health score or confidence. No good/fair/poor label is assigned."
        return result
    vector = np.array([[features[name] for name in FEATURE_NAMES]])
    predicted = float(artifact["model"].predict(vector)[0])
    if not np.isfinite(predicted):
        result["method"] = "invalid_model_output"
        result["interpretation"] = "The model returned a non-finite prediction; no condition verdict is available."
        return result
    # A local regressor is still unvalidated; it must not silently acquire condition labels.
    result["method"] = "trained_random_forest"
    result["visual_proxy_index"] = round(float(np.clip(predicted, 0, 100)), 2)
    result["interpretation"] = "Unvalidated local regression prediction, shown only as a diagnostic index. Independent labeled evaluation is required before assigning road-health bands."
    return result
