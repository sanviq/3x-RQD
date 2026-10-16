
# Native-resolution Weather lab

## Upload-to-evidence path

ScenarioLab mounts NativeWeatherLab for an uploaded capture. It sends the actual original File and selected road quadrilateral to POST /weather-compare (also /api/weather-compare). The sample-only canvas experiment is retained separately. A simulated repair, 3D texture, cropped road plane or resized canvas is never substituted for this uploaded-file weather comparison.

The API decodes JPEG/PNG/WebP with EXIF orientation applied once. Original bytes, filename, byte count, SHA-256, raw/upright dimensions, EXIF orientation/metadata byte count and ICC metadata byte count are recorded. The uploaded original is never rewritten; the UI retains its File/Blob, always displays it in the Original panel, and offers an unchanged-original download. Display evidence is an upright lossless PNG derivative, with its metadata difference stated explicitly. Native width, height and aspect ratio are retained throughout the weather path. CSS Fit only scales the display; 100% and zoom/pan still use the native PNG and original-pixel SVG coordinates.

Existing safety limits apply: 12 MiB upload, 20 megapixels, at least 64 pixels per side. An unsupported/oversized capture is rejected, never silently resized. A comparison has one original and one to seven independently generated/analyzed conditions: rain, puddles, shadow, low light, glare, blur and perspective. These are documented synthetic stress tests, not measured weather conditions. All operations start from independent source copies. No source image is replaced by an altered image.

## Inference and evidence

- CLAHE on the LAB luminance channel plus bilateral denoising operates only on an inference copy. The displayed frame remains unfiltered. With preprocessing enabled, a second independent raw-image inference audits preprocessing-only and raw-only detections. This is disagreement evidence, not proof that enhancement increases accuracy. Raw audit IDs use a separate -raw- namespace; lost raw regions and their coordinates are included in the JSON report. The selected normalized road outline is retained in the configuration for reproduction.
- If trusted road-model weights are configured through the existing model registry or explicit local override, app.detection.predict runs actual YOLO inference for every frame. The temporary aspect-preserving model letterbox is handled by Ultralytics; its output geometry already refers to the input image. Normalized boxes/polygons are converted back to native pixels. Model segmentation polygons and detection-box estimates are explicitly different geometry types. Unless explicitly supplied in the request, confidence and model input size use the selected registry operating point (fallback 0.35 / 640); weather comparisons do not silently substitute a different operating point.
- No active weights means the existing adaptive OpenCV detector runs with native_resolution=True. It uses multiscale black-hat/local contrast, a separate thin-line family, bright basins with contrasting rims, texture/shape checks and overlapping-region suppression. It returns untrained, review-required appearance candidates, never demo defects. The existing preview-sized detector behavior elsewhere is unchanged. Large morphology kernels use a rectangular structuring element for performance on native images. Native input is never resized.
- Only classes actually supported by the selected model are marked assessed. RDD2022 covers D00/D10/D20 cracks and D40 potholes; it does not establish wear, patch or depression accuracy. The fallback only proposes pothole/crack/depression/uneven-surface appearances. Unsupported types are null / Not assessed, not zero.
- Confidence is uncalibrated; CV confidence is an evidence heuristic. Severity is a visual area/contrast estimate, not engineering severity, depth or force. Model severity uses the existing area/class proxy in detection.py. No new road-health score or physical dimensions are reported.

Perspective uses a recorded forward homography H into an unchanged-size canvas and H inverse back to the EXIF-oriented original. Blank border pixels are excluded. Detections are clipped to the transformed road outline and valid image, then mapped back into the same original-pixel coordinate system. Other conditions use identity geometry. Per-detection pixel areas and union affected area are rasterized in original coordinates within the selected road ROI; they are not calibrated physical areas or automatic road segmentation. Boxes are region estimates, not measured damaged pixel masks.

Class-aware greedy one-to-one bounding-box IoU >= 0.30 associates independently inferred original/condition regions. The response reports added and missed IDs, matched location overlap, area/severity/confidence deltas, quality flags, preprocessing disagreement and synthetic-effect overlap. Additional detections may be artifacts or baseline misses, not newly created physical damage. Glare, reflections, shadows and occlusion cannot reliably be disambiguated from a single uncalibrated 2D photograph; uncertain candidates remain explicitly flagged. Severe blur/occlusion cannot be reversed by enhancement. Red/amber/teal denote estimated severity; dashed outlines indicate uncertainty.

Limits are explicit: at most 80 CV candidates or 100 model outputs per frame. Counts at the cap may be truncated. Comparisons are serialized; a second job gets HTTP 429 with a retry message. Native PNG evidence is stored in temporary files for 10 minutes, with a combined 512 MiB budget and oldest-job eviction. Oversized batches fail without reducing resolution. Download images and comparison JSON for retention. Cancel aborts the client and discards late results; a server job already running can finish and expire normally.

## Ground truth and honest metrics

Without independent annotations, precision/recall/F1 are null. Original/condition agreement is never called accuracy.

Optional annotations_json is an array of objects with id, kind, polygon and optional detection_code. Polygons use normalized EXIF-oriented original coordinates x/(W-1), y/(H-1), must have nonzero area and remain within [0,1]. At most 200 polygons / 1 MiB. The UI can load this JSON. An empty annotation array means a genuinely labeled defect-free capture, not missing annotations. Do not supply copied predictions as ground truth.

The exact unchanged bytes of bundled data/examples/rdd2022 JPGs can automatically use their genuine YOLO sidecar labels, verified by SHA-256, not filename. A renamed unrelated image does not inherit annotations. Auto matching is disabled for non-default EXIF orientation. These annotations cover cracks/potholes only; other predicted classes are excluded from those particular metrics and the excluded count is reported. User-supplied annotation evaluation includes all supported kinds. Known annotation boxes are clipped to the same road ROI used for detections.

Per frame, class-aware bounding-box IoU >= 0.50 provides one-to-one TP / FP / FN. Crack subcodes must agree when both sides supply a code. Precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2TP/(2TP+FP+FN). A zero denominator is null, not invented perfect performance. These are box metrics, not segmentation IoU or a calibrated deployment accuracy estimate. The same genuine source annotations are used in original coordinates for every transformed condition.

## Validation

Frontend tests cover native-file transport, response geometry/schema validation, no invented dimensions, all-condition requests, failed requests/retry and stale result cancellation. Browser tests upload the supplied pothole photo against the real API on desktop/mobile, inspect every condition, native naturalWidth, coordinate-aligned overlays, zoom and responsive overflow. Existing driving, repair and sample weather regressions are retained.

Run from frontend/:

    npm test -- --maxWorkers=1
    npm run build
    npm run lint
    node scripts/check-weather-live.mjs

The live script requires the backend on 127.0.0.1:8000. It checks the supplied 640x427 pothole photo, every condition on two genuinely annotated RDD2022 examples, native 1739x1081 input, EXIF orientation 6 / portrait input, homography round-trips, no filename-based label leakage, invalid inputs and unchanged source hashes. It writes .verification/weather-live-report.json with real per-condition TP/FP/FN, precision, recall and F1. This small synthetic-condition smoke set is not a representative accuracy benchmark. The supplied pothole photo has no known annotations, so its accuracy metrics remain unavailable. Additional real rain/night/wet-road annotated holdouts are still necessary.

Backend pytest regressions are in tests/test_weather_compare.py: all seven conditions, no native resize, model input/output coordinate mapping, real segmentation vs box geometry, road clipping, one-to-one metrics, annotation identity, EXIF handling and smooth-road negatives. Run from the repository root with an accessible Python environment:

    python -m pytest -q tests/test_weather_compare.py tests/test_repair_views.py

This agent environment cannot launch the installed Python interpreter, so backend pytest execution is not claimed; actual running FastAPI endpoints are tested through HTTP. Trained model inference cannot be validated without active weights. Current local /status reports configured=false, loaded=false. OpenCV results must not be presented as reliable semantic detections or high accuracy.

Implementation references: [OpenCV CLAHE](https://docs.opencv.org/4.x/d5/daf/tutorial_py_histogram_equalization.html), [Ultralytics prediction result coordinates and masks](https://docs.ultralytics.com/modes/predict/).

## Current measured limitation

On the two bundled annotated smoke images (India_India_000114 and China_Drone_China_Drone_000008), the current CV-only fallback achieved box F1 = 0 at IoU 0.50 for the original and all seven altered conditions. This exposes a real detector limitation; passing geometry/API tests does not establish useful detection accuracy. No trained checkpoint is active and no model activation gate was bypassed. Suitable road-specific weights and broader independent weather annotations are required before claiming high accuracy. The current feature is an honest evidence-comparison/diagnostic tool, not a validated automated defect inventory.

To run the real-API browser acceptance on Windows (from frontend/):

~~~powershell
$env:ROAD_HEALTH_REAL_API='1'
$env:ROAD_HEALTH_TEST_URL='http://127.0.0.1:5174'
$env:ROAD_HEALTH_BROWSER_EXECUTABLE='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npx playwright test e2e/native-weather.spec.ts --workers=1
~~~

Photo/API/WebGL browser flows allow 120 seconds per test; their individual response and visibility assertions remain active. This prevents a 30-second whole-test deadline from cutting off an explicit 45-second photo response assertion on a CPU host.
