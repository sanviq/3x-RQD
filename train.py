"""Train from CSV: image_path,quality_score,route_id. Paths resolve beside CSV."""
import argparse
import csv
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import GroupShuffleSplit

from app.features import FEATURE_NAMES, FEATURE_VERSION, decode_image, extract_features
from app.scoring import DEFAULT_MODEL


def train(csv_path: Path, output: Path):
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not {"image_path", "quality_score", "route_id"}.issubset(reader.fieldnames or []):
            raise ValueError("CSV needs image_path, quality_score, route_id columns.")
        rows = list(reader)
    if len(rows) < 20:
        raise ValueError("Provide at least 20 labeled images (many more are recommended).")
    paths, targets, groups, vectors = [], [], [], []
    for row in rows:
        path = (csv_path.parent / row["image_path"]).resolve()
        target = float(row["quality_score"])
        group = row["route_id"].strip()
        if not np.isfinite(target) or not 0 <= target <= 100 or not group:
            raise ValueError("Scores must be finite in [0,100]; route_id must be nonempty.")
        result, _ = extract_features(decode_image(path.read_bytes()))
        paths.append(path)
        targets.append(target)
        groups.append(group)
        vectors.append([result["features"][name] for name in FEATURE_NAMES])
    if len(set(paths)) != len(paths):
        raise ValueError("Duplicate image paths are not allowed.")
    if len(set(groups)) < 3 or np.std(targets) < 1:
        raise ValueError("Use at least three distinct routes and varied quality scores, including poor roads.")
    x, y = np.array(vectors), np.array(targets)
    split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(split.split(x, y, groups))
    model = RandomForestRegressor(n_estimators=200, min_samples_leaf=2,
                                  random_state=42, n_jobs=-1)
    model.fit(x[train_idx], y[train_idx])
    predictions = model.predict(x[test_idx])
    metrics = {"mae": float(mean_absolute_error(y[test_idx], predictions)),
               "rmse": float(np.sqrt(mean_squared_error(y[test_idx], predictions))),
               "train_images": len(train_idx), "test_images": len(test_idx),
               "test_routes": sorted(set(np.array(groups)[test_idx])),
               "note": "One route-disjoint holdout; not a certification or independent field validation."}
    # Preserve this evaluated split model rather than silently refitting on the holdout.
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_names": FEATURE_NAMES,
                 "feature_version": FEATURE_VERSION, "metrics": metrics}, output)
    output.with_suffix(".metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()
    print(json.dumps(train(args.csv.resolve(), args.output), indent=2))
