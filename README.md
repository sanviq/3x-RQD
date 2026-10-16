# Road Health — local application

The active dashboard is the team's React/TypeScript application in `frontend/`. FastAPI provides granular analysis, an optional road-defect detector, tracking, assessment, repair planning, local GPS survey records, a mesh API, simulation and evaluation.

Start locally from this folder:

```sh
./scripts/start-local.sh
```

Open http://127.0.0.1:8000 (API docs: http://127.0.0.1:8000/docs). Demo mode works without a training dataset. For real detections, install optional dependencies and configure trusted road-specific weights. The startup script does not push code or publish the application.

See [local integration, API, model setup and limitations](docs/IMPLEMENTATION.md). The original surface-analysis endpoint and its calibration contract are preserved below.

For detector development, see [RDD2022 provenance, team download, preparation, training and evaluation](docs/datasets/README.md). The repository includes a tiny attributed real-data gallery; the compact training dataset and checkpoints are GitHub Release assets. See [the compact multinational workflow](docs/datasets/COMPACT.md). Downloading data does not replace demo mode with a trained detector.

---

# Road Quality Measurement — backend starter

Python/FastAPI backend for close-up road-surface analysis. Upload a road crop to
obtain aggregate-chip candidates, texture/boundary/spacing proxies, optional
physical measurements, and diagnostic image descriptors. No road-health grade
is issued without a validated condition model.
The repository includes an attributed RDD2022 example gallery. Detector checkpoints and compact training data are distributed as release assets; they are not silently loaded by the granular surface-analysis endpoint.

## Full application

See [RUNNING.md](RUNNING.md) for Windows setup, launching both services with `node dev.mjs`, uploaded-photo driving, repairs, weather effects and verification status. Use Python 3.11/3.12 and Node 24 LTS (or 22.18+). The existing backend setup below is also supported.

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
  -F 'capture_type=surface_crop' \
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
potential dark linear distress. The React workspace is in `frontend/`; Swagger `/docs` is available for API inspection. No uploaded images are stored.

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

The old formula is retained only as a diagnostic visual index:

`clip(100 - [55*min(1,L/0.08) + 25*min(1,D/0.25) + 20*(1-U)], 0, 100)`

L is dark linear area, D is dark area and U is candidate coverage uniformity.
These coefficients are arbitrary and do not measure road health or confidence.
Zero candidates now produces U=0, correcting the previous false-perfect value.

With no validated model, the API returns `road_quality_index=null` and
`band=unassessable`. A suitable surface crop can return `visual_proxy_index`;
no good/fair/poor label is assigned. Local unvalidated regression predictions
are also diagnostic only. `capture_type=road_scene` (the default), insufficient
detail (brightness std <8/255 or Laplacian variance <25), extreme mean exposure
(<25/255 or >235/255), and zero candidates withhold the diagnostic index.
Scene captures also withhold physical aggregate measurements. Capture type is
user-declared; this is not automatic road recognition. Feature schema is
`surface-v3`; older weights must not be reused.

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
report `validated=false` and expose predictions only as diagnostic indices until independent field validation is implemented.
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

## Road defect candidates and wheel simulation

POST /detect-defects returns OpenCV candidate polygons, original pixel bounding boxes, rectified-road coordinates, visual severity and uncalibrated evidence confidence. POST /analyze includes the same defect_detection object. Depth and physical dimensions remain null. The React upload workflow calls detection automatically and maps reviewed candidates into the wheel-level suspension simulation. No hardcoded sample defects are inserted for uploaded media. See DETECTION.md for documented approximations, test commands and limitations.

## Integrated network and detector workflows

The road-network page retains both imported GeoJSON connectivity and saved GPS survey records. Surface inspection retains the separate optional detector workspace, dataset gallery and local-save workflow, alongside automatic road-region texture analysis and wheel-level simulation. See [NETWORK_AND_ANALYSIS.md](NETWORK_AND_ANALYSIS.md).
