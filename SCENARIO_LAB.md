# Scenario Lab behavior

Existing upload, OpenCV candidate detection, original-photo review, exclusion controls and wheel-level physics are retained.

## Digital twin

The Orbit camera uses the existing WebGL2 terrain renderer with uploaded texture, local surface normals, lighting, shadows and texture mipmaps. Its origin is fixed in road coordinates; only the vehicle marker moves. There is no schematic car in this view.

- Fit whole road restores the overview; orbit/elevation/zoom adjust the inspection camera.
- Inspect selected defect and the focus selector frame a candidate or repair footprint.
- The focus remains fixed when that candidate is flattened in Repaired. Camera target height is the road baseline, so scenario changes do not recenter the image vertically.
- Vertical display gain is limited to 1–8× and affects rendering only. Wheel physics, quantities and profile values remain at the original assumed scale.
- The profile samples the same height function along actual left/right front-wheel paths. Its horizontal coordinate is longitudinal route progress, not integrated traveled distance.
- GPU height encoding uses adaptive bounds so deep or overlapping what-if geometry is not silently clipped to a fixed encoding range.
- Canvas fallback provides a textured surface overview when WebGL2 is unavailable.

This is a photo-grounded estimated surface model, not a surveyed digital reconstruction. Software cannot establish true depth from this single capture.

## Repair and deterioration

Repair selection is preserved when dimensions or other local settings change. A new image, road footprint or new detection snapshot still invalidates incompatible geometry. Moving/resizing a detected candidate transforms its polygon and bounding fields together.

Repair is an ideal-level what-if treatment: only selected polygons/ellipses lose their height-field effect. The same footprint receives an asphalt patch texture. Untreated geometry is retained. This does not model compaction quality, repair longevity, drainage or adhesion.

Deterioration changes existing geometry; it does not invent new detections. At month t:

- depth = base depth × (1 + t × depth rate)
- width/length = base size × (1 + t × footprint rate)
- polygon vertices scale about their center and are clipped to the road domain.

Default rates are 3% depth and 1.5% size per month; controls permit 0–10% and 0–5%, with a 0–24 month horizon. These are explicit user assumptions, not a trained forecast. Zero months or zero rates preserve the baseline.

Compare all three drives runs the actual fixed-step suspension model for Original, Repaired and Deteriorated in a cancellable background worker. Each starts from the same state and uses identical road dimensions, path, speed and vehicle parameters. Results are committed only when the complete batch succeeds. Input changes terminate stale work; they do not leave a partly updated comparison. The graph includes all three traces and uses their actual traveled distance.

## Severity heatmap

Defect severity colors use API visual severity for detected polygons and manual assumptions for manually placed geometry. Deteriorated colors are derived what-if values, not fresh API estimates. Selected repairs are omitted only in Repaired. Image contrast remains a separate brightness-based overlay and is never presented as defect probability.

## Weather lab

Weather is an image stress test. It changes the displayed scenario reference pixels through explicit synthetic effects. It does not silently change road geometry, tire adhesion, braking or other tabs.

Reference and altered images come from the same selected scenario. The API receives uncalibrated images; for a perspective stress effect, the altered road footprint is transformed with the pixels to exclude the synthetic border. Unvalidated API indices are withheld from health grades here too. These descriptor comparisons are not weather accuracy evaluations.

## Repair budget

Detected work areas use the mapped polygon shoelace area × assumed road dimensions. Manually placed ellipses use their ellipse area. Per-defect cost is rounded area × supplied rate + ₹1,000. The sum bills individual footprints separately; overlapping work may therefore be counted more than once.

The affordable greedy ranking uses assumed depth × footprint area × severity multiplier per rupee. It is budget-feasible, not a guarantee of globally optimal maintenance. Budget and repair selections share the same state used by repaired geometry, textures and drive comparisons.

## Checks for this revision

- 85 frontend unit tests pass.
- 16 desktop/mobile browser tests pass, including real-photo detection, repair edit persistence, GPU twin rendering, matched background comparisons, heatmap/budget behavior and weather isolation.
- Production build and ESLint pass.
- Previous live API regression checks are retained; the detector implementation is unchanged in this revision.
- Python pytest remains unavailable through the sandbox's interpreter launcher; it is not claimed as run.

No new rendering dependency was added. Scenario exports use road-health-simulation-v2 and include growth assumptions and twin display settings.

Source-to-twin registration and connected network integration are documented in [NETWORK_AND_ANALYSIS.md](NETWORK_AND_ANALYSIS.md).
