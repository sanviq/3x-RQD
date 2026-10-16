
# Photo-grounded repair and deterioration

The Scenario lab **Repair & deterioration** tab now renders Original, Repaired and Predicted views in the uploaded photograph's original perspective. It keeps the upload, detection review, annotations, geometry editor and existing drive comparisons. Only local files were changed.

## Inputs and masks

POST /repair-views (also /api/repair-views) accepts multipart image, road_quad, optional defects_json, repair_ids_json and settings_json. With no reviewed geometry, OpenCV multiscale contour detection supplies candidates; nothing random is substituted. The UI sends its actual reviewed contours mapped back through the existing road homography. Excluded candidates are absent. Manually edited annotations are identified as manual input. YOLO rectangles are refined with overlapping OpenCV contours where possible; otherwise their edit masks remain explicitly approximate.

Default repairs select pothole/depression candidates when a photo first enters this tab. Existing repair selections are preserved. Clear repair selection produces an explicitly unchanged Repaired view; no detections produces no invented repairs. Inspect masks and reject false positives before interpreting the illustration.

Cavity-lip margins expand the selected pothole contour by roughly 10% of its pixel width and 20% of its height, capped at 10/9 pixels; cracks use a one-pixel margin. Every edit mask is clipped to the declared road footprint. These margins cover dark rims, not inferred physical dimensions. Original has outlines; source is an unannotated decoded reference. All rendered frames share the same dimensions (maximum side 1280 px); the upload bytes are not modified.

## Rendering

Preferred engine: a trusted local Stable Diffusion/SDXL inpainting model through Diffusers AutoPipelineForInpainting. No weights are bundled or automatically downloaded. Only local, safetensors-based model directories are loaded. Fixed seed 2718, 25 steps, strength .92, guidance 6.5, padded mask crop 32. Generated pixels are composited into the explicit edit mask with inward feathering, so surroundings cannot drift even if the diffusion pipeline redraws them internally. Keep its default safety checks. GPU model failures and busy/missing models fall back gracefully.

Fallback: OpenCV inpaint with Telea or Navier–Stokes, followed by sampled nearby undamaged road texture. Donor selection excludes all known damage, prefers similar image height and rejects saturated regions. Fresh asphalt receives darker, level shading and source aggregate texture. When no donor is available, cleaned illumination receives deterministic microtexture. This is an illustrative fallback; it does not offer diffusion-level realism and does not prove a repair is constructible.

GET /repair-views/status reports optional engine availability. The actual engine and fallback reason are shown in the UI. At most two requests render concurrently. Diffusion output may retain up to two masked repairs in process memory for three minutes to keep a horizon change from regenerating the asphalt; no image cache is written to disk. Requests that are cancelled in the browser may already be computing on the server. Stale browser responses are ignored.

## Configurable conditional aging

These are illustrative, unvalidated coefficients. Let s be visible severity in [0,1], t months in [0,24], q assumed repair quality in [0,1], F the traffic multiplier and W the weather multiplier.

- F: light .65, normal 1, heavy 1.6.
- W: dry .8, seasonal 1.15, wet 1.55, freeze–thaw 1.8.
- Monthly footprint rate r defaults .015, allowed 0–.05.
- Monthly severity rate d defaults .03, allowed 0–.1.
- Monthly patch decay k defaults .035, allowed 0–.2.

Untreated linear growth = 1 + t × r × (.5 + s) × F × W.
Untreated visual severity = min(1, s + t × d × (.5 + .5s) × F × W).
Patch degradation = 1 − exp[−t × k × F × W × (1.25 − .95q) × (.5 + .5s)].

Untreated defects expand about their centers in normalized planar road coordinates, then warp back into the unchanged camera perspective. The original cavity pixels supply the growing cavity texture. Selected repair masks take precedence when they overlap untreated growth.

Patch degradation lightens fresh asphalt, exposes fragmented contour edges and, above .25 degradation, progressively reintroduces the original cavity texture inside that same patch. No unrelated new potholes are scattered onto the image. At zero months Predicted equals Repaired. Zero growth rates and light wear need not create dramatic visible damage. Poor workmanship and heavy wet traffic accelerate the conditional change.

Photo-only traffic/weather/workmanship assumptions do not calibrate the separate quarter-car drive model. Pixel areas, model severity, depth priors and forecasts are not physical measurements, probabilities, maintenance guarantees or road-safety grades.

## Optional Diffusers setup

Install the separate requirements-inpainting.txt into the Python environment serving the API. Configure ROAD_HEALTH_INPAINT_MODEL to a trusted local Diffusers inpainting directory containing model_index.json and its safetensors weights, then restart the API. Without it, the application still renders the OpenCV workflow.

PowerShell example (replace the model directory with an actual local model):

    $env:ROAD_HEALTH_INPAINT_MODEL = 'D:\models\trusted-asphalt-inpainting'

The optional dependencies are large and were not downloaded for this change.

## Verification

- Frontend tests cover homography geometry, actual API requests, 3/6/12-month controls, assumptions, failure UI and stale-response cancellation.
- Run node frontend/scripts/check-repair-live.mjs with the actual API running. It uses tests/fixtures/pothole-road.jpg and checks changed repairs, identical surroundings outside masks, distinct horizons, zero-month equivalence, both OpenCV methods, missing-model fallback, growth of an untreated cavity, repair quality/traffic/weather sensitivity, invalid requests and unchanged upload bytes.
- Backend pytest cases live in tests/test_repair_views.py. The base Python interpreter is inaccessible from the agent sandbox, so live HTTP tests exercise the actual server; do not mistake this for a completed local pytest run.
- Real Stable Diffusion inference cannot be verified without installed optional dependencies and a suitable local checkpoint.

Implementation references: [OpenCV inpainting](https://docs.opencv.org/4.x/d7/d8b/group__photo__inpaint.html), [Diffusers masked inpainting](https://huggingface.co/docs/diffusers/v0.36.0/api/pipelines/stable_diffusion/inpaint), [local AutoPipeline loading](https://huggingface.co/docs/diffusers/main/api/pipelines/auto_pipeline).
