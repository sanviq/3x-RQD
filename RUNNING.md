# Run Road Health locally

## Install once (Windows)

Use Python 3.11/3.12 and Node 24 LTS (or Node 22.18+). The repository root contains app/, requirements.txt, dev.mjs and the React frontend/ folder.

~~~powershell
cd "C:\Users\Umesh Krishnaswamy\Downloads\road-health\frontend"
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd frontend
npm ci
cd ..
~~~

Use python instead of py -3 if the Python launcher is unavailable.

## Launch backend and frontend

From the repository root:

~~~powershell
node dev.mjs
~~~

Open http://127.0.0.1:5173. Backend docs: http://127.0.0.1:8000/docs. Ctrl+C stops both services. The helper requires installed dependencies and does not train models.

Alternatively, use two terminals:

~~~powershell
# Repository root, terminal 1
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
~~~

~~~powershell
# Repository root, terminal 2
cd frontend
npm run dev
~~~

Vite proxies /api to port 8000. model_loaded:false means texture descriptors are available but no condition model is installed.

## Upload and drive

1. Open **Surface inspection** and upload an image, choose a video, or capture a camera frame.
2. A local preview appears after image decode. The original reference frame and road footprint are automatically sent to the defect API; the drive starts after its response. Video selection automatically extracts a first reference frame and retains the original clip for replay. Reduced-motion preferences disable automatic movement.
3. Open **Align road & open scenario lab**. Drag the four road corners around the visible road, excluding sky and roadside objects. Use **Entire surface crop** for a top-down crop. Presets are assumptions and require alignment.
4. **Wheel** is the default close-up tire/suspension camera. **Scene** projects the car onto the original photo/video. **Orbit**, **Chase** and **Driver** use a perspective-corrected road texture. The transform assumes a planar road; it does not reconstruct depth or establish scale.
5. Set known road width/length if available. Defaults and car speed are assumptions.
6. Mark defects on the rectified road and set assumed dimensions/depth. Place waypoints to change the car path. OpenCV supplies tentative defect candidates, visual severity and uncalibrated evidence scores. Review the original-image outlines and untick false positives. True depth, friction and safe speed are not inferred.
7. Play/pause/reset the drive. Complete Original, select repairs, choose Repaired, and complete a second drive to compare simulated acceleration.
8. For video, scrub to a frame and choose **Use current video frame for 3D & annotations**. This freezes that reference and clears incompatible annotations/recordings. **Replay video in scene** restores original video playback. The schematic car speed is independent of video motion; there is no temporal defect or vehicle tracking.

Corner handles and annotation markers support arrow keys. Geometry changes clear incompatible recordings. Leaving the lab pauses the drive. Source media stays in session memory and is released on replacement/reset. Video reference frames are JPEGs capped at a 2560 px maximum side; the original clip remains available for scene replay.

## Other simulations

- **Digital twin:** GPU-lit rectified road texture and estimated height field, orbit/elevation/zoom, defect/repair inspection, display-only vertical gain and wheel-track profiles.
- **Repair & deterioration:** selected repairs remove their assumed height-field effect and patch their texture. Deterioration defaults to depth +3%/month and dimensions +1.5%/month, with adjustable bounded rates. Actual polygons grow with their bounds. It is not a prediction. Compare all three drives runs matched physics in a background worker.
- **Severity heatmap:** image-derived local dark contrast is available immediately. It is not defect probability or severity. Defect severity uses API visual severity for detected contours and explicit assumptions for manual marks.
- **Weather lab:** pixel effects for shadow, glare, low light, blur, perspective and rain. Download altered pixels or compare reference/scenario through the backend.
- **Repair budget:** mapped polygon area (manual ellipse area) × rate + ₹1,000 per annotation. Affordable greedy selection uses assumed severity-weighted displacement volume per rupee.

The four-wheel suspension model uses a fixed 240 Hz step, assumed per-wheel sprung mass 350 kg, unsprung mass 40 kg, spring 22,000 N/m, damper 1,800 N·s/m, tire stiffness 180,000 N/m, wheelbase 2.6 m and track 1.5 m. Acceleration is simulated, not measured or a validated comfort grade.

## Scoring reliability

There are no pretrained road-defect weights or labeled evaluation images in this checkout. This revision does not retrain anything or claim a measured accuracy improvement.

- capture_type=road_scene is the default and is suitable for visualization. It withholds health verdicts and physical aggregate measurements.
- Choose surface_crop only for a road-only rectified close-up. Physical units additionally require an original-image mm/pixel calibration.
- Blur/low contrast, extreme exposure and missing aggregate candidates prevent even the diagnostic index.
- Zero segmented candidates now yields zero coverage uniformity instead of a falsely perfect value.
- With no trained model, road_quality_index=null and band=unassessable. The old arbitrary formula is retained only as visual_proxy_index on suitable crops, behind diagnostic details. It has no condition label and is not confidence.
- A local unvalidated regressor also returns its prediction only as a diagnostic index.
- Feature schema is surface-v3. Older artifacts are incompatible and are not silently reused.
- The client withholds unvalidated grades from older servers and retains their original values under reported_assessment in JSON exports.

Road content itself is not semantically verified. Shadows, markings and aggregate can resemble damage. Reliable defect classification needs a suitable trained model plus independent labeled evaluation.

Simulation image comparisons use uncalibrated PNGs. Camera frames are explicitly submitted as scenes. Original inspection results remain separate. These operations do not validate a road condition grade.

## Wheel-level road test

**Wheel** is the default driving camera in the lab and upload preview. It uses a close, low camera, a treaded tire, alloy wheel, brake rotor/caliper, coil spring, damper and a body-mounted arch with an inspection opening. The ground relief and rolling contact sample the same annotation height field. Wheel rotation is distance / 0.345 m; the camera follows sprung-mass displacement and velocity rather than a random shake animation.

Rendering uses a small WebGL2 shader inside the existing Canvas component, with a labelled Canvas fallback when WebGL2 is unavailable. No rendering packages or downloaded assets are added. Asphalt/annotation textures and the height texture are cached; the existing fixed 240 Hz physics and approximately 30 fps paint limit remain in place. The GPU context is released when the canvas unmounts.

The tire footprint bridges narrow cracks and includes static tire deflection plus unilateral contact: a deep hole can unload the tire rather than pull it down with an impossible negative contact force. These are simplified assumed vehicle dynamics, not measured road or vehicle parameters.

The synthetic sample includes labelled pothole, raised-patch and loose-aggregate geometry in the right wheel track. Uploaded images use only actual API candidate geometry, with an explicit visual-severity depth prior. No demo defects are inserted automatically. Manual annotations and the explicitly labelled **Add labelled demo pothole & bumps** control remain available. Demo marks remain labelled, appear in the export, and can be removed or repaired. The procedural roadside environment is illustrative, not reconstructed from the upload. Original Scene/video replay and the other lab tools remain available.

## Implementation checks

For the current integrated revision:

- Production TypeScript/Vite build and ESLint pass.
- All 85 frontend tests pass, including spatial contact timing, severity response, rebound, smooth-road stability, repair isolation, tire bridging and finite/nonnegative tire contact.
- All 20 Playwright checks pass on desktop and mobile layouts using installed Edge. These cover upload/export, scenario navigation, repair/weather flows, GPU rendering, and the supplied real pothole photo against the actual updated backend: outlines, mapped candidates, wheel contacts, nonzero suspension response and candidate rejection.
- The 10 core checks and 8 additional API contract checks pass.
- The actual GPU wheel scene and impact state were visually reviewed. A live 90-frame browser sample had median frame interval 16.7 ms and 95th percentile 33.4 ms on the available Intel Iris Xe. This is one local observation, not a cross-device performance guarantee.
- Backend pytest could not start because the existing virtual environment's base Python executable is inaccessible. The updated backend has nevertheless been exercised through 15 live HTTP checks, including the actual supplied pothole photograph and an empty-image negative case. These checks do not establish population detection accuracy.

To use an installed Chromium-based browser for Playwright without downloading another browser:

~~~powershell
$env:ROAD_HEALTH_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:ROAD_HEALTH_TEST_URL = 'http://127.0.0.1:5174'
npm run test:e2e -- --workers=1
~~~

The optional URL override reuses that running local server. Without overrides, Playwright uses its managed Chromium and starts/reuses port 5173.

See DETECTION.md for the complete API path, contour mapping, confidence/severity formulas, depth priors, actual-photo tests and remaining limitations.

See SCENARIO_LAB.md for the revised purpose, state consistency rules, rendering assumptions, repair/deterioration controls and regression coverage for every lab section.

## Connected networks and automatic image analysis

See [NETWORK_AND_ANALYSIS.md](NETWORK_AND_ANALYSIS.md) for GeoJSON import, shared-junction routing, capture assignment, selected-road feature extraction and digital-twin registration. Full texture/aggregate analysis now runs automatically on upload and road-footprint changes. Measurement edits can be submitted with Analyze surface.

## Mac training integration (16 October 2026)

The local project now supports the trained RDD2022 detector through the existing
teammate inspection and driving UI. See [MODEL_IMPROVEMENT.md](MODEL_IMPROVEMENT.md)
for measured results, the expanded training run, model activation and limitations.
`node dev.mjs` recognizes `.venv-roadhealth` as well as `.venv`; optionally set
`ROAD_HEALTH_PYTHON` to an installed environment's Python executable.

For this Mac:

```sh
cd /Users/SANVI/Downloads/3x-rqd
node dev.mjs
```

If the managed backend is already running on port 8000, open
http://127.0.0.1:8000 to use its compiled frontend, or start only the frontend:

```sh
cd /Users/SANVI/Downloads/3x-rqd/frontend
npm run dev
```

Use **Model evaluation** to view genuine recorded metrics and local training
progress. **Surface inspection** includes the real country sample comparison.
Datasets are kept outside the website; their size does not become the web bundle size.

## Reference checks and vehicle parameters

In **Surface inspection → Capture type & measurements**, select a rectified surface
crop, open **Set scale from a measured reference**, and supply a known length plus
its original-image pixel span (or select two endpoints). Optional scale uncertainty
adds clearly labelled scale-only bounds to the results. The scale calculator does
not establish uniform scale on a perspective scene.

In **Model evaluation → Check calibrated measurement errors**, load independent
predicted/measured reference pairs using the downloadable JSON format. The result
reports errors separately in millimetres, square metres, density units or degrees.
The format example is synthetic; replace it before interpreting errors.

In **Scenario lab → Road & vehicle assumptions → Vehicle model parameters**, enter
traceable per-wheel mass/stiffness/damping values and a source reference. Re-run
**Compare all three drives** to see their effect. Use **Playback rate** for slow-motion
wheel inspection; this changes viewing speed without changing the 240 Hz physics.
Saved uncertain detections can be retained for repeat-capture follow-up. They do not
receive a supported health grade merely because they were saved.

### Road mesh framing

The connected inspection's road mesh fits its projected vertices to the available
canvas, including calibrated close-ups. Drag to rotate, adjust the viewing angle
or zoom, and use **Fit road** to restore the default camera. Canvas resizing and
high-DPI rendering do not change measurements or infer actual defect depth.
After updating, rebuild the frontend (`cd frontend && npm run build`) and refresh
port 8000, or restart/use the Vite development server on port 5173.

### Live detector progress and error diagnosis

Model evaluation polls both progress and published final results every 30 seconds.
The current epoch's validation precision, recall and mAP are explicitly interim;
Ultralytics chooses their operating point, so they are not the fixed-threshold
held-out diagnostics. The training-only ETA uses recent completed epoch durations,
excludes evaluation, and is hidden when the supervisor heartbeat is stale.

Each new `tools.evaluate_detector` evaluation also writes `error-summary.json`
from the already-saved predictions, without extra inference. It reports class
precision/recall, missed annotation sizes and duplicate, wrong-class, localization
or unmatched prediction categories. These categories describe label overlap;
they do not prove physical causes or completeness of ground-truth annotations.
The existing evaluation evidence release archive includes these reports. Use
validation reports to design changes; keep the final test for evaluation only.
