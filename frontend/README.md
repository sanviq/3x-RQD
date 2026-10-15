# Road Health frontend

> Local backend integration is now available. The existing interface and demo workflows are preserved; additive detection, saved-survey, planning, mesh and raw-evaluation tools are documented in [the integration guide](../docs/IMPLEMENTATION.md). The original implementation notes below describe the initial frontend.

A responsive React + TypeScript workspace for road-surface inspection, with plain CSS and Vite. The design takes its cream surfaces, restrained lavender navigation, brown feature cards, and rounded frame from the supplied reference.

## Start

Use Node.js 22.12+ (Node 24 is suitable).

~~~powershell
cd "C:\Users\Umesh Krishnaswamy\Downloads\road-health\frontend"
npm install
npm run dev
~~~

Open the localhost URL printed by Vite. Dependencies are declared in package.json. Commit the generated package-lock.json after a successful install, then use npm ci for reproducible installation.

Run the existing FastAPI application separately on http://127.0.0.1:8000. This project does not contain or change your Python backend. The Vite development server forwards /api/health and /api/analyze to FastAPI, removing /api. No CORS change is needed for this arrangement.

Copy .env.example to .env.local only if you need to override the base URL. VITE_API_BASE_URL defaults to /api. Never put secrets in Vite environment variables.

## What works

- Live image upload, original-resolution validation, optional calibration and measured sensor pitch.
- Exact multipart form contract, service health with retry, cancellation, stale-response protection, and readable API errors.
- Original/returned overlay view, experimental assessment, all warnings, calibrated measurements, all 17 technical features, and exact JSON response export.
- Local video playback and secure-context live camera capture of individual original-resolution frames for the same surface API.
- Six explicitly synthetic GPS-linked segments with selectable map routes, condition profile, defect drill-down, and configurable example scoring weights.
- Greedy budget planning, selected repair scenarios, cost assumptions, and scenario JSON export.
- Schematic 3D road rotation/zoom, selective repairs, synthetic deterioration, severity map, visual weather stress, and an illustrative driving comparison.
- Independent evaluation JSON import, precision/recall/F1/mAP, precision–recall curve, confusion matrix, and class distribution.
- A manual material-sample record workflow using measured masses; it does not infer composition from images.
- Search, local settings, desktop/tablet/mobile layouts, native dialogs, accessible labels/focus, and reduced-motion support.

The initial workspace uses sample data so the design is useful without a backend. Use “Live workspace” to remove network fixtures. Image analysis always calls the actual API unless “Explore a sample” is explicitly selected.

## Boundaries

The current API does not provide verified defect classes, object tracking, YOLO inference, model confidence, inference timing/FPS, GPS history, real maps, depth, material composition, or forecasts. The corresponding broader product views use labeled fixtures or schematic simulations. They are extension points, not evidence that those models/services exist.

Camera capture requests permission only after “Start camera.” Images and analysis responses remain in memory; the frontend adds no persistence, telemetry, accounts, or upload history. Captured frames are uploaded only when the officer clicks “Analyze surface.” Calibration uses the original image pixels after EXIF orientation; uploads are not cropped or resized.

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

Build assets into frontend/dist with npm run build. Serve them from a static web server and reverse proxy /api/* to FastAPI, stripping /api. Vite's development proxy is not included in built JavaScript. See ../docs/nginx.example.conf. Allow multipart request overhead above the 12 MiB file limit. A direct cross-origin API URL requires separately configured backend CORS.

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

See ../docs/IMPLEMENTATION.md for the feature-to-capability mapping and verification status.
