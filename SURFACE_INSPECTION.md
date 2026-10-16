# Surface inspection: measurements, limits and verification

## What was causing unavailable results

| Field or failure | Previous source | Current behavior |
| --- | --- | --- |
| Surface assessment number | app/scoring.py intentionally withholds an unvalidated texture-regressor grade; the UI treated that field as the whole assessment. | AnalysisResults uses the same current, backend-computed provisional defect score as RoadQualityCard. It never relabels model confidence or a texture diagnostic as road quality. Legacy diagnostic/validated-grade status remains in details. |
| Chip density, equivalent diameter and gaps | app/features.py returned only calibrated values prominently; usable pixel descriptors were buried in technical data. | Structured surface_measurements expose candidate density per original megapixel, equivalent diameter and boundary gaps in original pixels. Physical measurements remain separate. |
| Physical area/density/mm fields | Missing uniform original-pixel scale, perspective scene, unresolved grains or fewer than two candidates. | Specific per-field reasons. Choose a genuinely rectified road-only crop and enter a measured mm per original-image pixel scale. Selecting the option does not rectify a photo or measure its scale. |
| Wrong analysis area | Frontend default trapezoid; omitted road_quad was converted to the full image before automatic selection. | POST /road-region proposes a polygon from actual pixels. Detection and surface analysis wait for that proposal. All views use the same editable outline. Omitted outlines trigger selection in backend API calls too. |
| Fine particles lost | Old 1024 px temporary cap, Gaussian smoothing and a 24 px minimum region. | 1536 px temporary cap, bilateral smoothing, CLAHE/local contrast, six-pixel minimum candidates and distance watershed. Source remains unchanged. This still cannot recover grains absent from a distant/blurry capture. |
| Misleading gap measurement | Equivalent-circle center-distance proxy. | Sampled nearest-boundary estimate, among eight centroid neighbors, with at most 128 boundary samples per particle. Physical gap converts this actual pixel estimate using the supplied scale. The legacy circle proxy remains named explicitly in technical features. |
| One optional model breaks all analysis | Failed YOLO inference or incompatible texture artifact. | Actual OpenCV candidate fallback for integrated detection; explicit model-failure evidence. Texture descriptors remain available when the optional regressor fails. No fixture replacement. |
| Blank image looks pristine | No candidates could lead to a perfect provisional score. | Toneless/extreme-exposure selected regions return no condition score and actionable exposure/focus guidance; measurable geometric area may remain known with calibration. |

## Pipeline and units

1. Decode the original JPEG/PNG/WebP and apply EXIF orientation. Existing 12 MiB, 20 MP and 64 px/side safety limits remain.
2. Identify road appearance using an optional local semantic mask, or an OpenCV LAB appearance component connected to bottom-center road pixels. The fallback is explicitly unvalidated: foliage, walls and shadows can confuse it. Blank images request a manual outline. Confirm/edit all four corners.
3. Limit a temporary texture-processing copy to 1536 px on its longest side. Preserve aspect ratio. Exclude scenery before local preprocessing. Retain exact original-resolution ROI pixel area.
4. Segment chip appearance with a trusted local ONNX mask if configured, otherwise local contrast/top-hat responses, adaptive Otsu selection and distance-transform watershed. Filter small/elongated/unsuitable regions. At most 3,000 real candidate seeds are processed, with a visible truncation warning.
5. Compute original-pixel equivalent diameter as mean(sqrt(4 * processed region area / pi)) times sqrt(original/processed x-scale * y-scale). Boundary distances use actual x/y mapping. Pixel density is count / native ROI pixel area * 1,000,000. These are image-region statistics, not verified stone sizes.
6. For a declared rectified crop only: area_ft2 = native ROI pixels * mm_per_pixel² / 92903.04; density = count / area_ft2; diameter_mm = diameter_px * mm_per_pixel; gap_mm = boundary_gap_px * mm_per_pixel. Unresolved quantities remain null, with reasons. A single scale cannot calibrate an oblique perspective scene.
7. Integrated defects use configured road-specific YOLO outputs (retain real masks when provided), otherwise actual OpenCV multiscale contours. CLAHE assists low illumination/contrast. Shadows, puddles and patches can remain false positives. Confidence and visual severity are uncalibrated; depth stays unknown.
8. Road quality comes from app/road_quality_score.py, using area, severity, evidence confidence, location and distribution, with overlapping pixels penalized once. It is provisional. False-positive exclusions call the backend again and update both summaries together. There are no expert-labelled road scores here, so no MAE/correlation or accuracy claim is made.

Capture issues include insufficient contrast/detail, dark/overexposed regions, low resolution, no resolved candidates, insufficient separate candidates for a gap, missing scale and optional model failures. Each issue carries a code, explanation, affected fields and capture/configuration guidance.

## Optional models (no automatic downloads or training)

Trusted OpenCV-DNN-compatible dense ONNX masks can be configured independently:

- ROAD_HEALTH_ROAD_MASK_MODEL / ROAD_HEALTH_CHIP_MASK_MODEL: local ONNX file.
- Matching _SIZE: square network input, default 512 (128–1536).
- Matching _MEAN and _STD: JSON RGB normalization vectors applied after RGB/255; default [0,0,0] and [1,1,1].
- Matching _CLASS: foreground class index, default 1 for multiclass masks.
- Matching _OUTPUT: logits (default) or probabilities. Binary probabilities use 0.5. Multiclass output uses argmax.

Model output must be a dense [1,C,H,W], [C,H,W] or [H,W] mask; arbitrary object-detector exports are not interchangeable. Letterboxing is undone and predictions map to the native frame. Missing, incompatible or failed models produce explicit fallback reasons. No road/chip weights were supplied or installed during this change. Pixel processing is OpenCV/scikit-image, not a claim of trained semantic accuracy.

The separate, optional YOLO/video workbench retains its strict model mode and legacy engineering-grade withholding. Its local-model configuration message does not mean that the automatic OpenCV inspection above is unavailable. Optional sensor pitch remains unknown until supplied; it is not inferred from pixels.

## Verification

- Frontend unit tests: 202 passing, including 13 new surface contracts, shared-score, pending-score, automatic outline ordering, stale upload, dimension mismatch and calibration-refresh tests.
- Production TypeScript/Vite build and ESLint: passing. Existing Vite bundle-size advisory remains.
- scripts/check-surface-live.mjs: 42 real HTTP checks, using the provided pothole photo, three attributed RDD road photographs, synthetic known-size chip targets and deliberately unsuitable captures. Synthetic targets are test fixtures, never production results.
- e2e/surface-inspection.spec.ts: six passing desktop/mobile real-backend upload, outline review, shared score/exclusion synchronization, overlays, calibration edits and blank-capture guidance. Public map providers are blocked in these tests.
- Dashboard browser regressions: six passing desktop/mobile checks. Weather API regressions: 54 passing checks. Repair API regressions: 19 passing checks. Provisional-score API regressions: 28 passing checks, including blank-image withholding and explicit native ROI normalization.
- tests/test_surface_inspection.py: backend unit/API regressions, optional model failure and segmentation geometry, native coordinates and varied road photos. scripts/test-surface.ps1 runs these plus existing backend/detector regressions without the training-artifact test; writes .local-road-health/surface-pytest.xml.

Python pytest execution could not be confirmed: the agent cannot execute the installed base Python, and no surface-pytest.xml result has been received. The live HTTP tests did exercise the running FastAPI backend.

These checks validate implementation behavior, not semantic detection accuracy. Expert-labelled chip masks, physical reference measurements, road ratings and diverse held-out captures are still needed for calibration and accuracy metrics.

## Local site

Frontend preview: http://localhost:5174/ (serves the production build).
Backend: http://127.0.0.1:8000/health.

Keep the backend terminal open. Rebuild the frontend after edits when using preview. No Git push is part of this update.
