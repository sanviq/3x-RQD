# Defect detection and wheel response

## Data path

1. After decoding an upload/reference frame, useAnalysis sends the original file and the current normalized four-corner road footprint to POST /api/detect-defects. Vite removes /api and proxies to FastAPI on port 8000.
2. app/defects.py runs OpenCV on a maximum 1024-pixel image. The footprint excludes sky/roadside objects. Multi-scale elliptical black-hat and local-contrast masks find dark cavities. Closing groups boundaries. A separate thin-line pass supplies crack candidates. Compact bright basins with a darker rim supply possible water-filled cavities.
3. Contour area, contrast, boundary response, saturation and shape filters reject some noise. Overlapping candidates are suppressed. No minimum candidate count is fabricated.
4. Each result includes original pixel bbox, normalized original polygon, normalized rectified-road polygon, visual severity and uncalibrated confidence. POST /analyze also includes defect_detection while retaining existing measurements and conservative score handling.
5. DefectReview overlays the original pixels with color-coded polygons. Rejected candidates are excluded from both preview and lab. Geometry is cleared/redetected after footprint/reference changes; late requests cannot replace a newer upload.
6. simulation/detections.ts maps each actual response item into a contour-constrained height field. The same field supplies GPU road relief and rolling tire support. The existing four-wheel 240 Hz suspension model drives axle/body movement and camera response. Wheel rotation is distance / tire radius.

There is no pretrained pothole network in this checkout. These are **review-required OpenCV candidates**, not verified semantic diagnoses. Dark shadows, puddles, joints and surface repairs remain confounders. The photo fixture demonstrates an integration case; it is not an independent accuracy benchmark. The detector can miss defects, especially distant, low-contrast, occluded, or boundary-clipped regions.

## Coordinates and relative distance

Polygons use [0,1] coordinates on the EXIF-oriented original image. road_quad contains far-left, far-right, near-right, near-left corners in clockwise order. The API computes the image-to-unit-road homography; the frontend rectifier uses its inverse. road_polygon is the contour in that unit road rectangle.

The simulation uses x = (u - 0.5) × assumed road width, z = (1 - v) × assumed road length. Near-to-far ordering is preserved. Metric distances depend on the supplied footprint and road dimensions; perspective geometry is an approximation of a planar road, not a depth reconstruction. API area_fraction is unit-road polygon area, not a physical area.

The initial inspection route intentionally aligns the right wheel with a visible candidate to demonstrate its response. It is not a recommended driving route. Users can edit the path to avoid defects or align the wheel with a selected candidate. Only defects intersecting a wheel footprint cause contact.

## Visual evidence and simulation priors

All API items have depth_mm=null and physical_dimensions=null. confidence_calibrated=false and requires_review=true apply to the response.

For each candidate:

- c = clamp(local contrast / 65, 0, 1)
- e = clamp(boundary response / 40, 0, 1)
- t = clamp(interior brightness standard deviation / 35, 0, 1)
- confidence = clamp(0.30 + 0.27c + 0.18e + 0.10 × solidity + 0.07t, 0.30, 0.92)
- visual severity s = clamp(0.50 × sqrt(min(1, unit-road area / 0.018)) + 0.35c + 0.15e, 0, 1)
- Low: s < 0.34; Moderate: 0.34 ≤ s < 0.67; High: s ≥ 0.67.

Confidence is an evidence ranking, not a calibrated probability. Severity is an appearance index, not an engineering grade or measured depth.

The wheel simulation uses these explicit millimetre priors, with severity clamped to [0,1]:

| Candidate appearance | Simulation depth/height prior |
| --- | --- |
| Pothole | 20 + 80s mm downward |
| Crack | 3 + 12s mm downward |
| Depression | 8 + 40s mm downward |
| Uneven surface | 5 + 30s mm upward |

The displacement tapers to zero at the mapped contour. These assumed values may be edited. They must not be exported or displayed as measurements. Uploaded texture pixels are preserved for detected candidates; synthetic pothole paint is not added over them. Repairs/weather remain explicit separate scenario effects.

## Verification

The supplied Potholes-resized-for-blog.jpg is copied to tests/fixtures/pothole-road.jpg for repeatable regression checks. A manually inspected foreground cavity is checked by its test coordinates; those coordinates never appear in the detector.

Commands from the React frontend directory:

~~~powershell
npm test -- --pool=threads --maxWorkers=1
npm run test:defects-live
$env:ROAD_HEALTH_REAL_API = '1'
$env:ROAD_HEALTH_TEST_URL = 'http://127.0.0.1:5174'
$env:ROAD_HEALTH_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e -- --workers=1
~~~

test:defects-live requires the updated backend on port 8000 (override with ROAD_HEALTH_API_URL). The real-photo browser test is enabled only by ROAD_HEALTH_REAL_API=1; other browser upload tests use an empty detector fixture so they remain independent of the backend.

Python unit regressions are in tests/test_defects.py. Run python -m pytest -q from the repository root when a usable Python environment is available. In this session the Python launcher remains inaccessible, so verification uses the running backend's actual HTTP endpoints as well as frontend tests; pytest execution must not be claimed.
