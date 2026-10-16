# Road Health local integration

## Source and preservation

The active UI is the React/TypeScript frontend from `sanviq/3x-RQD`, commit `b137720` (Add frontend to road health project). Its styling, navigation, six Bengaluru demo segments, scenario lab, surface-analysis workflow, and demonstration formulas remain in place. Original source edits are limited to mounting additive backend components, replacing live-workspace placeholder states, and removing one redundant abort call that TypeScript rejected after control-flow narrowing. Original demo behavior is intentionally preserved.

## Run locally

From the project root:

```sh
./scripts/start-local.sh
```

This creates `.venv-roadhealth` if needed, installs Python dependencies, installs the existing frontend lockfile when needed, builds `frontend/dist`, and runs FastAPI on `http://127.0.0.1:8000`. Python 3.12 and Node 22.12+ are recommended. Stop with Ctrl+C. Swagger is at `/docs`.

For frontend development, use two terminals:

```sh
.venv-roadhealth/bin/python -m uvicorn app.main:app --reload
```

```sh
cd frontend
npm ci
npm run dev
```

Vite strips `/api` before forwarding requests. The backend accepts the original root `/health` and `/analyze` contracts and the new routes both with and without `/api`. Production serves the team frontend and `/api/*` from the same origin; no CORS change is required.

## What connects to the backend

Surface inspection's original image, frame capture, granular measurements, calibration, overlay and legacy surface score still use `/analyze` with their original schema.

A new **Road-defect analysis** panel below the original inspector provides:

- Explicit demo fixtures or optional local YOLO inference with adjustable confidence and 320/640/960/1280 pixel resolution.
- Image analysis, bounded video uploads and camera sessions with per-frame class-aware IoU tracking.
- Clickable normalized defect boxes; class, confidence, severity, cropped evidence, calibrated size and area when valid, segmentation/box overlays and severity heatmaps.
- Inference time and end-to-end compute FPS measured on the current host. Demo timings are fixture-generation timings, never an AI benchmark. Transport and capture are excluded.
- Image suitability flags; low-detail/poor-quality captures have their public score withheld. Confidence is an object-detector proxy, not calibrated road-assessment correctness.
- IMU pitch and roll; elevation-derived inclination and calibrated camera-plane inclination with distinct approximate labels.
- Transparent count-density, union-area and severity penalties, optional inclination policy, configurable group weights, penalty allocations and Good/Moderate thresholds.
- Selective repairs, explicit per-defect edits, added synthetic defects and illustrative deterioration, recalculated by the backend.
- A rotatable, zoomable surface mesh from `/twin`. Unmeasured displacements are schematic; actual depth fields require a depth sensor or validated reconstruction source. Horizontal geometry is schematic unless uniformly calibrated.
- A reproducible before/after driving-pipeline experiment. Synthetic top-down road/car frames are submitted to the same inspection function; the route, lane, seed and speed stay fixed. This complements the existing teammate-authored schematic 3D driving view. It is not Unity, a physical vehicle model, or a validated car-mounted camera simulator.
- Original/altered inference under synthetic shadow, low light, glare, brightness, blur, perspective and rain effects. Demo confidence/counts intentionally remain fixed. These are not real-weather benchmarks.
- Explicit GPS-linked local saving of annotations, sensor inputs, policy and processed evidence previews.

**Live workspace → Overview / Road network** reads saved records, summarizes distance-weighted scores and declared inspected lengths, displays an interactive geographic coordinate plot, reveals evidence/defects/penalties and plots quality, sampled defect-density proxies and available pitch against distance. The coordinate plot has no street basemap; connecting lines indicate declared segment order, not verified road alignment. Demo saves retain a Demo provenance badge, even in Live workspace.

**Live workspace → Repair planner** uses backend greedy optimization (score gain × segment length / assumed cost), immediate budget recomputation, custom repair selection, assumed unit costs and a selected/unselected coordinate map. Costs extrapolate frame coverage to segment area and are unvalidated. Only selected treatment removes annotations; inclination remains in the score.

**Model evaluation** keeps the team's report importer and synthetic example. An additive raw-data evaluator calculates class-aware box metrics from unique image IDs, complete ground truth and submitted predictions. It produces precision/recall/F1, AP50, 101-point interpolated mAP50–95, per-class PR data and confusion counts. No fake evaluation data is bundled. The downloadable format example is explicitly not a benchmark. Segmentation mAP is not implemented.

**Material samples** keeps the team's separate measured-mass workflow. `/material` additionally validates dry/loose/recovered metal/sieve masses and returns explicit ratios for API clients. None of these endpoints infers verified composition, friction, binder adhesion or water resistance from imagery.

## API use

All routes below are available under `/api` in production and without the prefix behind the supplied Vite proxy. Open `/docs` for field constraints and complete schemas.

- `GET /health`: original surface-regressor status, separate from road detector status.
- `POST /analyze`: original JPEG/PNG/WebP surface contract, 12 MiB and 20 MP limits. Additional `large_gap_fraction_proxy` is the proportion of nearest-center equivalent-circle gaps larger than the mean chip diameter, not verified ravelling.
- `GET /status`: detector configuration, canonical classes and edge limitations.
- `POST /inspect`: optional image, mode (`demo` or `model`), confidence, resolution, scale, inclination JSON, policy JSON, stress effect/strength and optional stream ID. Model mode requires an uploaded frame and configured weights. Demo without an image produces a synthetic road.
- `POST /video`: 100 MiB upload, maximum 48 sampled frames, sample interval 1–300 frames, scale/inclination and scoring configuration. The service returns the bounded sample and tracking estimates, not a complete-video census. Temporary uploaded files are deleted in `finally`.
- `POST /streams`, `DELETE /streams/{id}`: explicit camera tracking sessions, 15-minute idle expiry, maximum 16 active sessions and 10,000 unique tracks per session. Send `session_id` with consecutive `/inspect` calls. Use a fresh session when the camera/source/model policy changes.
- `POST /assess`: normalized annotations plus optional calibration, inclination and policy.
- `POST /inclination`: calibrated IMU input, elevation estimate or calibrated plane reconstruction with reprojection RMSE. Camera intrinsics, camera-to-world rotation and matched plane points are required.
- `POST /simulate`: baseline assessment, explicit repaired IDs, per-defect severity/size edits, added defects and illustrative monthly severity growth. No validated forecast is implied.
- `POST /twin`: baseline assessment and selected repairs; returns vertices, faces, severity and nullable measured depths with geometry provenance.
- `POST /simulation/drive`: same-route before/after synthetic frame analysis and a unitless vibration proxy. Frames are top-down schematic road/car drawings, not a rendering of real road geometry.
- `GET /segments`, `PUT /segments/{id}`: explicit local SQLite saves; at most 200 records. Media uploads alone do not create records. Each save may include up to 5 MiB of inline JPEG previews. Original captures are not archived. An upsert replaces the same ID; the UI uses unique capture IDs.
- `POST /optimize`: validated segment inputs, budget, assumed treatment and mobilization costs.
- `POST /material`: user-supplied laboratory mass ratios.
- `POST /evaluate`: `frames` with unique `image_id`, `ground_truth`, and `predictions`; each annotation uses canonical class, normalized box and confidence. Ground-truth confidence should be 1. AP uses all submitted confidence-ranked predictions; P/R/F1 use the requested threshold. Confusion rows are actual classes; columns are predictions, including background.

Save location defaults to `.local-road-health/survey.sqlite3`, excluded from git. Set `ROAD_HEALTH_DATA_DIR` before server start to use another local directory. It contains explicit saves and should be backed up separately. All user data and model files stay local. No accounts, telemetry, GitHub push or public hosting are added.

## Adding real data later

Demo mode needs no dataset. Real operation requires trusted road-specific weights, representative captures and independent validation. Install the optional model dependencies and restart:

```sh
.venv-roadhealth/bin/python -m pip install -r requirements-model.txt
ROAD_HEALTH_MODEL=/absolute/path/road-best.pt \
  .venv-roadhealth/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Canonical classes are `pothole`, `crack`, `repair_patch`, `ravelling`, `loose_chips`, `metallic_debris`, `uneven_surface`, `other`. RDD-style D00/D10/D20 map to crack and D40 to pothole. Extend `ALIASES` for your model. Unsupported classes fail visibly rather than being silently treated as road defects. A visible metallic-debris class is an appearance label, not verified composition.

Use detection weights for boxes or segmentation weights for masks. Bounding boxes are not invented segmentation. Severity is an image-space policy estimate, not measured structural damage or depth. Generic COCO models do not recognize these road classes.

The existing `train.py` trains a separate tabular-feature surface-score regressor; it does not train YOLO. Optional detector training is explicit:

```sh
.venv-roadhealth/bin/python train_detector.py /path/to/prepared/data.yaml \
  --base /path/to/trusted-local-yolov8n.pt \
  --output /path/to/new-run --device cpu
```

Supply YOLO images/labels and dataset YAML with complete class names. Split entire routes/nearby frames/repeated visits between train/validation/test to reduce leakage. Do not use training examples as evaluation evidence. Sensor road alignment, planar scale calibration and actual depth need their own acquisition/validation. Costs, deterioration rules and road scoring require engineering calibration.

For Raspberry Pi 5, begin with a nano-sized model, 320-pixel inference and sparse capture. Consider tested NCNN/ONNX exports, cooling and a measured per-device benchmark. This code does not claim real-time Pi performance or ship Pi-specific acceleration.

## Verification

```sh
.venv-roadhealth/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run test:core
npm --prefix frontend run test:api-core
npm --prefix frontend run build
```

These check software behavior, not real-road model accuracy. Browser QA is performed separately against the actual local backend. Camera permission/hardware and genuine model-weight inference cannot be verified without the corresponding device and weights.

Latest local verification (16 October 2026): 21 Python tests passed; 31 frontend tests passed (including the original 27); 10 core and 8 API-core checks passed; TypeScript/production build passed; dependency install audit reported no vulnerabilities. Browser checks confirmed preserved demo UI, defect analysis, selective repair recalculation, mesh generation, synthetic before/after pipeline, synthetic weather comparison, explicit GPS save, live network retrieval and zero-budget optimization. The synthetic QA save was removed afterwards.

Actual running-server multipart checks also passed for surface uploads with calibration/zero pitch/overlay, explicit failure without model weights, bounded video tracking, and raw evaluation. Automated Chrome file attachment was unavailable because the browser extension does not have file-URL access; no browser permission settings were changed. Manual upload through the app remains available. Real camera hardware, actual trained-weight inference, Raspberry Pi performance and real-road accuracy remain unverified.
