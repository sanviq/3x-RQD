For full backend/frontend launch and the uploaded-road simulations, see [../RUNNING.md](../RUNNING.md).

# Road Health frontend

A responsive React + TypeScript workspace for road-surface inspection, with plain CSS and Vite. The design takes its cream surfaces, restrained lavender navigation, brown feature cards, and rounded frame from the supplied reference.

## Start

Use Node.js 24 LTS or 22.18+ (Node 24 is suitable).

~~~powershell
cd "C:\Users\Umesh Krishnaswamy\Downloads\road-health\frontend\frontend"
npm install
npm run dev
~~~

Open the localhost URL printed by Vite. Dependencies are declared in package.json. Commit the generated package-lock.json after a successful install, then use npm ci for reproducible installation.

Run the existing FastAPI application separately on http://127.0.0.1:8000. The repository root contains the Python backend and the shared launch helper. See ../RUNNING.md for backend setup and the revised scoring behavior. The Vite development server forwards /api/health and /api/analyze to FastAPI, removing /api. No CORS change is needed for this arrangement.

Copy .env.example to .env.local only if you need to override the base URL. VITE_API_BASE_URL defaults to /api. Never put secrets in Vite environment variables.

## What works

- Live image upload, original-resolution validation, optional calibration and measured sensor pitch.
- Exact multipart form contract, service health with retry, cancellation, stale-response protection, and readable API errors.
- Original/returned overlay view, abstaining condition assessment, diagnostic texture index, all warnings, calibrated measurements, all 17 technical features, and JSON exports retaining original assessments from legacy servers.
- Local video playback and secure-context live camera capture of individual JPEG reference frames (maximum side 2560 px) for the same surface API.
- Six explicitly synthetic GPS-linked segments with selectable map routes, condition profile, defect drill-down, and configurable example scoring weights.
- Greedy budget planning, selected repair scenarios, cost assumptions, and scenario JSON export.
- Immediate uploaded-road driving preview, editable road footprint, original scene/video overlay, perspective-corrected 3D cameras, selective repairs, synthetic deterioration, image contrast and manual severity layers, weather stress and driving comparisons.
- Independent evaluation JSON import, precision/recall/F1/mAP, precision–recall curve, confusion matrix, and class distribution.
- A manual material-sample record workflow using measured masses; it does not infer composition from images.
- Search, local settings, desktop/tablet/mobile layouts, native dialogs, accessible labels/focus, and reduced-motion support.

The initial workspace uses sample data so the design is useful without a backend. Use “Live workspace” to remove network fixtures. Image analysis always calls the actual API unless “Explore a sample” is explicitly selected.

## Boundaries

The current API does not provide verified defect classes, object tracking, YOLO inference, model confidence, inference timing/FPS, GPS history, real maps, depth, material composition, or forecasts. The corresponding broader product views use labeled fixtures or schematic simulations. They do not establish model accuracy.

Camera capture requests permission only after “Start camera.” Images and analysis responses remain in memory; the frontend adds no persistence, telemetry, accounts, or upload history. The original image/reference frame is uploaded automatically for defect candidates after decode and footprint edits; full road-region texture/aggregate analysis and its diagnostic overlay are also requested automatically. Use “Analyze surface” after editing calibration settings. Image-file calibration uses original pixels after EXIF orientation; uploaded images are not resized by the API client. Simulations rectify a user-selected road area locally. Video/camera reference frames are separate JPEGs capped at a 2560 px maximum side.

## Scripts and checks

| Command | Purpose |
| --- | --- |
| npm run dev | Local development and API proxy |
| npm run build | TypeScript check, then production build |
| npm run preview | Local production build preview (also proxies local /api) |
| npm run lint | ESLint |
| npm test | Focused validation, API, request-lifecycle, and planning tests |
| npm run test:e2e | Desktop and mobile Playwright tests with mocked API responses |
| npm run test:api-core | Dependency-free multipart/response/error checks against Node-transformed source |
| npm run test:core | Dependency-free checks on the actual pure TypeScript utilities (Node 22.18+/24) |

Install the Playwright browser once before browser testing:

~~~powershell
npx playwright install chromium
npm run build
npm run lint
npm test
npm run test:e2e
~~~

Browser tests use a labeled synthetic 64×64 image fixture and mocked API responses. They do not establish real-road accuracy or replace a smoke test against your FastAPI server.

## Production

Build assets into frontend/dist with npm run build. Serve them from a static web server and reverse proxy /api/* to FastAPI, stripping /api. Vite's development proxy is not included in built JavaScript. Configure your web server accordingly. Allow multipart request overhead above the 12 MiB file limit. A direct cross-origin API URL requires separately configured backend CORS.

## Evaluation import format

The report stays in memory. Metrics are fractions from 0 to 1. Confusion rows are actual classes and columns are predicted classes.

~~~json
{
  "dataset": "Held-out dataset; document IoU, averaging, model version, and provenance here",
  "precision": 0.83,
  "recall": 0.76,
  "f1": 0.793,
  "map": 0.71,
  "labels": ["Pothole", "Crack"],
  "confusion": [[22, 2], [3, 19]],
  "counts": [24, 22],
  "pr": [{"recall": 0, "precision": 1}, {"recall": 1, "precision": 0.25}]
}
~~~

All numbers above are format examples. Replace them with genuine evaluation output.

## Structure

- src/api — typed calls and defensive runtime validation.
- src/hooks — health and cancellable image-analysis lifecycle.
- src/components — the single-screen workspace views.
- src/data/demo.ts — explicit fixtures, demo scoring and optimizer.
- src/utils — file/calibration validation, units, JSON export.
- tests and e2e — focused automated checks.
- scripts/check-core.mjs — dependency-free checks.

See ../RUNNING.md for simulation workflows and current verification status.

## Wheel camera

The upload preview and driving lab default to the wheel-level road test. Annotated relief, tire contact, spring travel and camera movement share the same road coordinates. Uploaded photos supply texture; actual API candidate coordinates drive the geometry; depth uses a documented visual-severity prior and dimensions remain assumed. WebGL2 adds lighting, tread, metal surfaces and a suspension inspection opening without new dependencies; unsupported devices receive a labelled Canvas fallback. See ../RUNNING.md for vehicle assumptions, demo controls and verified checks.

Automatic candidate detection uses POST /api/detect-defects. Review original-image outlines and exclude false positives before interpreting the simulated response. See ../DETECTION.md for the complete pipeline and npm run test:defects-live for real-server regression checks.

The GPU digital twin, repair/deterioration comparison worker, contour-based quantities, severity heatmap and isolated weather stress workflow are documented in ../SCENARIO_LAB.md. The existing upload/detector/wheel pipeline is retained.

See [NETWORK_AND_ANALYSIS.md](../NETWORK_AND_ANALYSIS.md) for real GeoJSON networks, shared junctions, actual capture assignment and source-to-twin registration.
