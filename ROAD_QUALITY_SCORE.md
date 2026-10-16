# Provisional Road Quality Score

The new Road Quality Score is a separate, explicitly provisional observed-defect index. It is not detector confidence, the old texture proxy, a calibrated pavement condition index, a safety judgement, or a validated engineering grade. The existing texture assessment remains unchanged.

## Upload and review path

1. The original File is uploaded without resizing/cropping. FastAPI decodes at native EXIF-oriented dimensions and runs the existing detector.
2. /detect-defects (and /api/detect-defects) returns actual detections plus road_quality_score, score_token and score_expires_seconds. /analyze also includes an initial score within defect_detection. The separate fast detection result drives the prominent live score card.
3. The score card appears automatically in Surface inspection and Scenario lab. It shows score / 100, Provisional, formula rating, retained/excluded counts, estimated severity, deductions, configuration and uncertainty. It never displays a previous score while a review is pending or failed.
4. Unticking an actual defect calls POST /road-quality-score with only score_token and excluded_ids. The API recalculates from its immutable detection snapshot, using the same frozen configuration as the initial response. The frontend does not implement the scoring formula or trust client-created contours. Exclusions also continue to affect the driving preview and lab.
5. Detection reruns, source changes and road-outline edits invalidate stale evidence. A rerun resets exclusions because IDs can represent different regions. Simulation depth edits do not change the observed score.

The score snapshot retains geometry and source metadata, not source image pixels. It expires after 30 minutes; at most 24 snapshots are retained per worker. Expiry/restart returns 410; Refresh detections & score obtains current evidence. Each upload may also generate an analysis snapshot. No database history, weights download or Git push is performed by this feature.

## Exact formula

Native pixels inside the user-selected road quadrilateral form ROI Omega with area A. This is a projected visible-pixel region, not physical road area or automatic road segmentation. The source raster/file is never altered. Existing detector/model temporary copies are mapped to original normalized coordinates before scoring.

For each retained detection i:

    severity_factor_i = 0.20 + 0.80 * visual_severity_i
    centrality_i = max(0, 1 - 2 * abs(u_i - 0.5))
    location_i = 1 + 0.25 * centrality_i
    evidence_i = confidence_i^2 * source_discount * 0.85 * geometry_discount * artifact_discount
    risk_i = type_weight_i * severity_factor_i * evidence_i * location_i

u is the polygon centroid mapped to the assumed planar road chart. No actual wheel tracks, lane locations, depth or suspension forces are inferred. The central-corridor preference is an explicit configurable assumption.

Default type weights:

| Detection | Weight |
| --- | ---: |
| Pothole | 1.40 |
| Crack | 0.70 |
| Depression | 1.00 |
| Uneven surface / patch | 0.65 |

source_discount is 0.60 for untrained OpenCV candidates and 0.85 for model predictions. The additional 0.85 severity discount reflects uncalibrated visual severity. geometry_discount is 0.60 for schematic detection boxes and 1 for candidate contours. artifact_discount is 0.65 if the detector describes water/glare/reflection/shadow ambiguity, otherwise 1. These values are untuned priors, not measured probabilities. Image-quality flags are disclosed separately; poor lighting does not automatically establish a better road.

At each native ROI pixel p:

    R(p) = max({risk_i : p belongs to detection i}, default=0)
    L = sum(R(p)) / A
    P_area = min(70, 350 * L)

A 3-column × 4-row grid in the declared road plane partitions the ROI into disjoint cells. Each native ROI pixel belongs to exactly one cell. For every nonempty cell j:

    L_j = sum(R(p) in cell j) / native_road_pixels_in_cell_j
    P_hotspot = min(20, 30 * max(L_j))
    P_spread = (10 / number_of_nonempty_cells) * sum(1 - exp(-L_j / 0.08))
    score = round(clamp(100 - P_area - P_hotspot - P_spread, 0, 100), 1)

The union affected area and each candidate's area are also reported, independently of penalty confidence discounts. Candidate areas can overlap; the union cannot. Overlapping penalties use MAX, never addition. Components are attributed to each pixel's winning detection, including hotspot/spread contributions. A fully covered duplicate can contribute zero deduction points. Identical duplicate geometry/evidence cannot increase the score penalty. Removing any detection cannot increase penalties under the same configuration.

Defaults: Excellent >=90; Good >=75; Fair >=55; Poor >=35; otherwise Critical. These are provisional formula bands with no expert calibration. A value of 100 means zero weighted observed penalty, not proof of an Excellent road. No-retained-defect and capture-quality warnings are prominent. Confidence discounts can raise the score while missed defects remain unknown.

## Configuration and provenance

GET /road-quality-score/config returns the active defaults/configuration. Set ROAD_HEALTH_SCORE_CONFIG to a trusted local JSON file containing ScoreSettings fields to override defaults for new detections. The initial snapshot freezes that configuration. An explicit rescore request config override is supported for research and marked request_override; it never mutates the snapshot or silently changes other users' scores. Penalty caps must total <=100, rating thresholds must be ordered, and all numeric settings must be finite and bounded.

Every score includes config_sha256, full settings, image SHA-256, original dimensions, original-normalized polygons, native pixel areas, per-cell densities, raw confidence, visual severity, evidence multipliers, attributed deductions and exclusion IDs. The original image is retained by the existing upload workflow. The API never accepts replacement detections or arbitrary scores in a rescore request.

## Validation and limits

No expert-labelled 0–100 condition scores or expert rating labels were found in this checkout. The bundled RDD annotations describe defect classes/boxes, not road-condition targets. Consequently no weights were fitted, no true-score MAE/correlation is claimed, and all returned scores have validated=false / status=provisional. The model registry currently has no active trained detector, so source detections are unvalidated CV candidates. Reliability limits of that detector still apply; scoring does not fix false negatives or make physical severity measurable.

POST /road-quality-score/evaluate accepts label_source, split (validation/test), and cases with score_token, excluded_ids and independently supplied expert_score (0–100) and/or expert_rating (Excellent/Good/Fair/Poor/Critical). It recomputes predictions from actual saved detections under one server configuration, rejects repeated image hashes and per-image tuning, and reports:

- MAE = mean(abs(predicted - expert)), RMSE and Pearson correlation for numeric pairs only.
- Null correlation for fewer than two pairs or constant values; null numeric metrics if only categorical labels exist.
- Rating agreement and a confusion matrix for independently supplied categorical labels. Ratings are never converted into invented numeric targets.
- Labels are user-supplied and not independently audited; the result does not automatically mark the score validated.

For a larger labelled dataset, use the offline evaluator from the repository root:

    python -m tools.road_score_validation expert-manifest.json --output .local-road-health/score-evaluation.json

Manifest schema (replace placeholders with genuine independent annotations; no fabricated example target values are supplied): label_source plus cases. Each case has image (path relative to the manifest), split, optional road_quad and excluded_ids, and expert_score and/or expert_rating. Keep capture/route groups separate across splits and obtain reference ratings independently of these predictions.

Optional --tune-configs candidates.json evaluates up to 20 configurations using cached detections, chooses minimum validation MAE, and writes the suggested configuration. It requires at least two numeric validation-only cases and rejects test labels. It does not retrain a detector or automatically activate weights/configuration. Freeze the selected configuration before evaluating independent test images. No tuning was run here because expert targets are unavailable.

## Checks

- tests/test_road_quality_score.py: overlap/duplicate invariance, confidence/severity/location effects, count independence, native resolution normalization, disjoint spatial cells, exclusions, native ROI clipping, score/rating boundaries, saturation, finite config bounds, source immutability, expiry and numeric/categorical reference metrics. These synthetic geometry cases are not accuracy measurements.
- Frontend QualityScore and QualityScoreFlow tests: score/API schema, numeric zero, explicit provisional status, automatic upload score, authoritative rescore, cancellation, source/ROI/rerun invalidation, failure recovery and unavailable expert metrics.
- frontend/scripts/check-quality-score-live.mjs: actual provided pothole-photo API results, deductions and ownership identities, exclusions and restore, custom configuration, unknown IDs, snapshot expiry, rejection of injected detections, smooth negative, EXIF orientation, >1024 native dimensions, original hashes and no invented MAE/correlation.
- frontend/e2e/quality-score.spec.ts: real backend upload → automatic score → exclusion → synchronized score in Scenario lab → rerun, plus expired-review recovery, on desktop/mobile.

Run from frontend/: npm test -- --maxWorkers=1; npm run build; npm run lint; node scripts/check-quality-score-live.mjs. For real browser tests set ROAD_HEALTH_REAL_API=1, ROAD_HEALTH_TEST_URL=http://127.0.0.1:5174 and the installed Edge executable as described in WEATHER_LAB.md, then run npx playwright test e2e/quality-score.spec.ts --workers=1.

Backend pytest was added but this agent environment cannot launch the installed venv's base Python executable. Live FastAPI HTTP checks exercise the implementation instead; backend pytest execution is not claimed. Neither implementation checks nor synthetic geometry fixtures establish population scoring accuracy.

The RDD2022 model supports cracks and potholes only. If activated, Depression and Uneven patch candidate counts are marked Not assessed / null; they are never silently treated as confirmed zeros. CV counts remain untrained appearance labels.
