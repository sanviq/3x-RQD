# Road Health — local application

The active dashboard is the team's React/TypeScript application in `frontend/`. FastAPI provides granular analysis, an optional road-defect detector, tracking, assessment, repair planning, local GPS survey records, a mesh API, simulation and evaluation.

Start locally from this folder:

```sh
./scripts/start-local.sh
```

Open http://127.0.0.1:8000 (API docs: http://127.0.0.1:8000/docs). Demo mode works without a training dataset. For real detections, install optional dependencies and configure trusted road-specific weights. The startup script does not push code or publish the application.

See [local integration, API, model setup and limitations](docs/IMPLEMENTATION.md). The original surface-analysis endpoint and its calibration contract are preserved below.

---

# Road Quality Measurement — backend starter

Python/FastAPI backend for close-up road-surface analysis. Upload a road crop to
obtain aggregate-chip candidates, texture/boundary/spacing proxies, optional
physical measurements, and an experimental 0–100 surface quality index.
This repository contains no training photos or pretrained model.

## Setup and run

Requires Python 3.10+ (Python 3.11 or 3.12 recommended).

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs for an interactive upload/testing interface.
`GET /health` reports whether a locally trained model is loaded.

```sh
curl -X POST http://127.0.0.1:8000/analyze \
  -F 'image=@/absolute/path/road.jpg' \
  -F 'mm_per_pixel=0.5' \
  -F 'include_overlay=true'
```

`mm_per_pixel` is optional and refers to the **original image** after EXIF
orientation. Supply it only for a top-down or rectified image with a uniform
known scale, e.g. 100 mm reference spanning 200 pixels gives 0.5 mm/pixel.
Physical outputs are null without calibration. Count per square foot is the
detected count divided by the entire crop area in square feet; it is a density
estimate, not a count in a separately sampled one-square-foot window. Cropped
edge chips are excluded, causing some density undercount. Maximum upload is
12 MiB and 20 megapixels; supported formats are JPEG, PNG and WebP.

Optional `pitch_degrees` records a user-supplied calibrated sensor measurement;
the API does not infer slope from a single photo. Pitch is not used in scoring.
`include_overlay=true` returns a base64 PNG: green candidate boundaries, red
potential dark linear distress. The team frontend provides the application UI; Swagger `/docs`
remains available for API testing. No uploaded images are stored.

## Features and method

- Grayscale, Gaussian smoothing, CLAHE, Otsu threshold, distance transform and
  marker-controlled watershed produce approximate bright chip candidates.
- Candidate count, visible coverage, equivalent diameter/variation, circularity,
  nearest-center equivalent-circle gap, and 4×4 spatial coverage uniformity
  describe size and apparent packing.
- Boundary edge support and gradient contrast describe boundary visibility.
- GLCM contrast/homogeneity, entropy, brightness and Laplacian variance describe
  texture, illumination and image detail.
- Black-hat morphology plus elongated-component filtering estimates dark linear
  regions; dark area fraction is another appearance proxy.

Pixel features refer to a crop resized to a maximum side of 1024 pixels. Keep
capture distance, resolution, illumination and surface type consistent for ML.
Physical measurements account for resizing. `chip_coverage_fraction` is visible
2D candidate coverage, not volumetric compaction or verified packing density.
Gap is an equivalent-circle approximation, not measured edge-to-edge spacing.
The unsegmented area does not identify binder/fines chemically or materially.

The fallback score subtracts up to 55 points for dark linear area, 25 for dark
area, and 20 for nonuniform coverage. Its thresholds are arbitrary prototype
settings; bands are good ≥75, fair ≥50, poor <50. Low-detail images receive a
null score and an unassessable band. These checks cannot reject every unsuitable
image; always read image warnings and inspect the overlay. No score is
a validated engineering quality grade, PCI, IRI, friction or safety measure.

## Train on your labeled images

Place images under `data/images/` and create `data/labels.csv` using
`data/labels.example.csv` as the column template (the example photos do not
exist). Label scores 0–100 using a consistent expert rubric. Use both good and
damaged roads: good examples alone cannot calibrate quality across the range.
Use at least 20 images from at least 3 routes to exercise the starter, and a
much larger representative dataset for meaningful evaluation. Group nearby
frames and repeat visits to the same segment under the same `route_id` to
reduce leakage; avoid duplicated photos even under different filenames.

```sh
python train.py data/labels.csv
```

The script extracts the same features, holds out entire routes, trains a random
forest regressor, and saves `models/road_quality.joblib` with MAE/RMSE in
`models/road_quality.metrics.json`. Only the training split is fitted. Restart
the server to use it. The API reports `trained_random_forest`, but continues to
report `validated=false` until independent field validation is implemented.
Load only trusted model files: joblib artifacts can execute Python code.

## Tests

```sh
pip install -r requirements-dev.txt
python -m pytest -q
```

Tests check calibration, degenerate images, upload validation and API output.
They do not establish real-road detection accuracy. Validate segmentation against
manually outlined chips (IoU, count error, size error), quality against expert
ratings on unseen routes (MAE, RMSE), and repeatability across lighting/surface
types. Cracks, potholes and binder identification need labeled masks and a
specialized segmentation model for reliable classification. Route-distance
aggregation and image-derived calibrated slope estimation are future work.

## Research references

- [FHWA surface texture guidance](https://www.fhwa.dot.gov/pavement/t504036.cfm):
  aggregate and mortar contribute differently to asphalt/concrete texture;
  visible texture alone is not a complete road-quality assessment.
- [scikit-image watershed](https://scikit-image.org/docs/stable/api/skimage.segmentation.html#skimage.segmentation.watershed)
  for separating touching candidate regions.
- [scikit-image region measurements](https://scikit-image.org/docs/stable/api/skimage.measure.html#skimage.measure.regionprops)
  and [GLCM texture features](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.graycomatrix).

Research informs the feature choices; it does not validate the starter score.
