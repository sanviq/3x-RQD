# Road Health · 3x-RQD

A road-inspection and maintenance prototype for government officers. Inspect road images, review possible damage, save GPS-linked surveys, and compare repair scenarios.

The application uses the team's **React + TypeScript frontend** in `frontend/` and a **Python + FastAPI backend** in `app/`. The road-damage detector is trained separately using real RDD2022 images.

[Visual tour](#a-quick-look-inside) · [Run locally](#run-locally) · [Using the app](#using-the-app) · [Model results](#current-detector-results) · [Dataset](#dataset-and-training) · [Documentation](#documentation)

[![Road Health demo dashboard showing sample inspection coverage and road priorities](docs/images/overview-demo.jpg)](docs/images/overview-demo.jpg)
*The team's real interface, running locally. The overview above uses clearly labelled demonstration roads and illustrative scores.*

## A quick look inside

### Find the roads that need attention

Explore connected segments, inspect their condition profile, and move from the map to a repair scenario. **This screenshot uses the sample network; its boxes, confidence values, and scores are fixtures.** Live surveys use records your team explicitly saves or imports.

![Sample road network and synthetic defect inspection panel](docs/images/network-demo.jpg)

### See the real data behind the detector

The dataset explorer contains attributed RDD2022 training examples. Its green boxes are **human ground-truth annotations**, not model predictions. Select a country/capture subset and inspect its original class labels before running analysis.

<p>
  <img src="data/examples/rdd2022/India_India_000115.jpg" width="31%" alt="Real RDD2022 training road image from India">
  <img src="data/examples/rdd2022/Norway_Norway_000009.jpg" width="31%" alt="Real RDD2022 training road image from Norway">
  <img src="data/examples/rdd2022/Japan_Japan_000000.jpg" width="31%" alt="Real RDD2022 training road image from Japan">
</p>

*India · Norway · Japan, left to right. These are dataset preview photographs, not detector outputs.*

<details>
<summary>Open the dataset explorer screenshot with human annotation boxes</summary>

![Real Indian RDD2022 training photograph with human-labelled crack and pothole boxes](docs/images/rdd2022-human-annotations.jpg)

</details>

*Road photograph: RDD2022 dataset authors, [CC BY 4.0](https://figshare.com/articles/dataset/21431547). The app displays a resized preview; original XML is preserved.*

### Drive it, repair it, compare it

The wheel camera shows the tire and suspension responding to annotated road relief. Select repairs and repeat the same route to compare the simulated response. **Road dimensions, defect depths, and vehicle behaviour in this view are assumptions, not measured telemetry.**

![Synthetic wheel-level driving simulation with adjustable road and vehicle assumptions](docs/images/driving-simulation.jpg)

[Try the walkthrough](#using-the-app) · [Understand the model results](#current-detector-results)

## Run locally

Requirements: **Python 3.11 or 3.12**, **Node.js 22.18+**, npm, and Git. The basic application needs no training dataset, GPU, API key, or cloud account.

### macOS / Linux

From the repository root:

```sh
./scripts/start-local.sh
```

The script creates `.venv-roadhealth` if needed, installs dependencies for a new environment, installs frontend dependencies, builds the team's frontend, and starts FastAPI.

- **Application:** http://127.0.0.1:8000
- **Interactive API documentation:** http://127.0.0.1:8000/docs
- Stop the server with **Ctrl+C**. If port 8000 is already in use, use the existing local server or stop it before launching another.

If an existing Python environment is missing dependencies:

```sh
.venv-roadhealth/bin/python -m pip install -r requirements-dev.txt
```

### Windows (PowerShell)

Open a terminal in the repository root—the folder containing `app/`, `frontend/`, and `dev.mjs`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm --prefix frontend ci
node dev.mjs
```

Python 3.11 is also supported; adjust the launcher version if needed.

Open **http://127.0.0.1:5173**. The helper starts the API on port 8000 and the frontend on port 5173. Ctrl+C stops both.

### Development with live reload

After installing dependencies, run `node dev.mjs` from the repository root on either platform. It uses `.venv-roadhealth` when available, otherwise `.venv`. Vite forwards `/api` requests to FastAPI.

For separate terminals, proxy configuration, and troubleshooting, see [RUNNING.md](RUNNING.md).

## Using the app

1. **Explore Demo mode.** The overview, map, charts, and repair planner use clearly labelled sample roads. These are examples, not real survey results.
2. **Open Surface inspection.** Upload an image, choose a video reference frame, or capture a camera image. Review the original image, detected candidates, bounding boxes, and confidence. Align the road footprint before using the simulation.
3. **Review detections.** Reject false positives. Without an accepted YOLO checkpoint, the default inspection workflow uses experimental OpenCV candidates; these are not validated model predictions. The advanced detector workspace also offers explicit demo annotations.
4. **Save a real survey in Live mode.** Supply the actual location and save the inspection, or use **Import GPS inspections → Preview → Save** to import your team's JSON records. Existing records are preserved. GPS is supplied by the user, not recovered from RDD2022 photos.
5. **Compare repair scenarios.** In Scenario lab, drive the original road, select repairs, and drive the same route again. Compare simulated suspension response, remaining defects, repair costs, and synthetic weather changes.
6. **Check Model evaluation.** Genuine detector reports are separated from illustrative charts. The local training status appears when a job is registered.

### Main workflows

- **Inspection:** road-defect candidates, original-image coordinates, class/confidence, review controls, image-quality checks, and optional scale-reference calibration.
- **Road network:** GeoJSON connectivity, capture assignment, saved GPS survey records, and segment-level summaries.
- **Repair planning:** configurable budgets, ranked recommendations, selected repairs, and explicit cost assumptions.
- **Scenario lab:** photo-based 3D driving, adjustable vehicle parameters, repair/deterioration comparisons, repair-photo previews, and synthetic weather tests.
- **Surface and material assessment:** texture/aggregate descriptors and separate user-supplied material test inputs.
- **Evaluation:** measured internal detection results, PR/confusion evidence in downloadable artifacts, calibration comparisons, and labelled demonstration charts.

The **Provisional Road Quality Score** is a configurable observed-defect index. It is separate from detection confidence and is **not** a validated engineering condition grade. See [the score definition and limitations](ROAD_QUALITY_SCORE.md).

## Current detector results

The expanded **YOLOv8n** experiment completed **50 additional fine-tuning epochs**. The saved best checkpoint was compared with the previous pipeline on the **same 511 held-out images**.

At confidence **0.35** and class-correct bounding-box IoU **≥ 0.50**:

- **Precision:** 53.8% → **59.2%**.
- **Recall:** 13.1% → **25.1%**.
- **mAP@0.50:** 24.5% → **32.4%**.

These results support an improvement on this internal test. They do **not** establish field accuracy, national road-quality rankings, or reliable road-health scores. The old pipeline used 640 px inference and the candidate used 768 px; the comparison is between complete pipelines.

**Status: experimental; automatic activation disabled.** The model failed the recall requirement. **90% precision remains a project target**, with recall and per-class results reported alongside it. Increasing the confidence cutoff can hide most defects, so a high precision number alone is not success.

<details>
<summary><strong>See the measured results in the application</strong></summary>

![Model evaluation screen with real validation and held-out results, separated from current training progress](docs/images/model-evaluation.jpg)

*Recorded expanded YOLOv8n results. Training progress changes as follow-up experiments run; the published baseline comparison remains separate.*

</details>

The follow-up experiment uses **YOLOv8s**, initialized from official pretrained weights, for up to 50 epochs at 768 px. A completed validation-only 1024 px trial performed worse and was rejected. This refinement does not re-evaluate the previously exposed test or activate a model without fresh confirmation. [Experiment protocol](MODEL_IMPROVEMENT.md#follow-up-yolov8s-experiment).

- [Measured reports and activation decision](docs/datasets/results/improvement-v2/README.md)
- [Checkpoint, dataset, and evaluation evidence](https://github.com/sanviq/3x-RQD/releases/tag/rdd2022-improvement-v2)
- [Precision target and refinement method](docs/PRECISION_TUNING.md)

Check **Model evaluation** or `/api/research/training-status` for the current local experiment. Experiment results are not automatically promoted to the live detector.

## Dataset and training

The primary dataset is [RDD2022, released through CRDDC2022](https://figshare.com/articles/dataset/21431547), attributed to its authors under **CC BY 4.0**. Original Pascal VOC XML annotations are retained and valid boxes are converted to YOLO labels.

The model's four class IDs are:

- `0` · **D00:** longitudinal crack.
- `1` · **D10:** transverse crack.
- `2` · **D20:** alligator crack.
- `3` · **D40:** pothole.

The expanded subset contains **5,250 genuine image/XML pairs**: 750 each from China Drone, China MotorBike, Czech, India, Japan, Norway, and United States. These are seven capture subsets across six countries; Indian state coverage is unknown.

After protections against previously exposed or related images crossing splits, **4,165 images** were retained: **2,851 train / 803 validation / 511 test**. This is a compact, class-enriched development sample, not a representative survey of every country.

The selected-original archive is approximately **1.28 GB**, rather than the complete 12+ GB release. Large datasets and weights live in **GitHub Releases**, outside Git history and the frontend bundle. The repository contains source code, small attributed examples, audit summaries, and measured reports. Running the website does not load the training dataset.

To reproduce data preparation, training, resuming, and evaluation, use:

- [Dataset source, class mapping, and preparation](docs/datasets/README.md)
- [Expanded experiment settings and integration](MODEL_IMPROVEMENT.md)
- [Compact dataset workflow](docs/datasets/COMPACT.md)

Fine-tuning uses trusted pretrained detection weights, configurable image size/batch/epochs/learning rate/seed, and separate best/resume checkpoints. Selection uses validation data. Final confirmation requires an independent holdout; previously inspected test results must not become tuning data while still being called an untouched test.

## Evidence and limitations

- **Demo, measured, estimated, and simulated results are distinct.** Sample roads and synthetic charts are labelled.
- **No detections does not mean a healthy road.** Insufficient model evidence requires review or repeat capture.
- **Boxes are not segmentation masks.** RDD2022 box annotations do not validate exact damaged pixel area or a 3D defect shape.
- **Physical measurements require calibration or sensors.** Ordinary photos do not verify defect depth, road slope, friction, binder adhesion, water resistance, or material composition.
- **Simulation is illustrative.** Vehicle parameters, deterioration, repair outcomes, and costs are assumptions unless independent measurements are supplied. Synthetic rain/glare tests do not prove real-weather robustness.
- **Country comparisons describe the sample.** Camera view, resolution, class mix, and annotation patterns can be compared; national road-quality claims need representative GPS-linked surveys and supporting data.

## Project layout

- `frontend/` — the team's React/TypeScript interface, driving simulation, and browser tests.
- `app/` — FastAPI analysis, detection adapters, scoring, local storage, and APIs.
- `tools/` — dataset collection/auditing, preparation, detector evaluation, and experiment utilities.
- `tests/` — backend, calibration, detection-contract, and dataset-pipeline tests.
- `docs/` — implementation notes, data provenance, audits, and measured reports.
- `scripts/start-local.sh` / `dev.mjs` — local launch helpers.

## Checks

Run from the repository root after installing development dependencies:

```sh
.venv-roadhealth/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

On Windows, use `.\.venv\Scripts\python.exe -m pytest -q` for the backend command. Passing software tests verifies implementation behavior, not real-road detection accuracy.

## Documentation

- [Local setup and launch](RUNNING.md)
- [Backend integration and API contracts](docs/IMPLEMENTATION.md)
- [GPS inspection import and sharing](docs/GPS_INSPECTION_IMPORT.md)
- [Defect detection and geometry](DETECTION.md)
- [Network and image analysis](NETWORK_AND_ANALYSIS.md)
- [Scenario lab](SCENARIO_LAB.md)
- [Repair-photo views](REPAIR_PHOTO_VIEWS.md)
- [Weather lab](WEATHER_LAB.md)
- [Surface-analysis backend reference](docs/SURFACE_ANALYSIS.md)
- [Model training and integration](MODEL_IMPROVEMENT.md)
