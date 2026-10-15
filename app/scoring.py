"""Experimental baseline and optional locally trained regression model."""
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
        raise ValueError("Incompatible model feature schema. Retrain the model.")
    return artifact


def score(features, artifact=None):
    if features["brightness_std"] < 8 / 255 or features["laplacian_variance"] < 25:
        return {"road_quality_index": None, "scale": "0 (low) to 100 (high)",
                "band": "unassessable", "method": "insufficient_visual_detail",
                "validated": False,
                "interpretation": "Upload a sharper, well-lit surface crop with visible texture."}
    if artifact is not None:
        vector = np.array([[features[name] for name in FEATURE_NAMES]])
        value = float(np.clip(artifact["model"].predict(vector)[0], 0, 100))
        method = "trained_random_forest"
    else:
        # These coefficients are deliberately transparent, arbitrary starting values.
        penalty = (55 * min(1, features["dark_linear_fraction"] / 0.08)
                   + 25 * min(1, features["dark_region_fraction"] / 0.25)
                   + 20 * (1 - features["packing_uniformity"]))
        value = float(np.clip(100 - penalty, 0, 100))
        method = "experimental_heuristic"
    return {"road_quality_index": round(value, 2), "scale": "0 (low) to 100 (high)",
            "band": "good" if value >= 75 else "fair" if value >= 50 else "poor",
            "method": method, "validated": False,
            "interpretation": "Research prototype; not PCI, IRI, skid resistance, or a structural/safety assessment."}
