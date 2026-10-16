
# Uploaded analysis and connected networks

## Capture → analysis → twin

Uploading an image or freezing a video frame starts both /detect-defects (250 ms debounce) and /analyze (650 ms debounce). The latter requests actual aggregate/texture features and a diagnostic PNG. Editing the road footprint cancels and invalidates old analysis and runs both again. Calibration edits invalidate results; use **Analyze surface** to submit those edits. Reset/cancel prevents a queued automatic request.

Feature version surface-v3 measures only pixels within the user-selected road polygon. Scenery is excluded from segmentation, brightness, coverage, linear area, entropy and GLCM pairs. The GLCM counts a pixel pair only when both pixels lie in the region. Processing outside the region is filled with the road median before local normalization, preventing vegetation/sky from influencing aggregate segmentation. Coverage/density use the selected pixel count; calibrated area uses the corresponding original-pixel area. Excluded image pixels are dimmed in the separate overlay. Original upload bytes are unchanged.

Bright-region watershed segments are **aggregate candidates**, not verified stones. In a perspective photo, patches, reflections and cavities may become candidates, and fine aggregate may be below image resolution. Counts/coverage are image descriptors. A uniformly scaled sharp close-up and reference scale are needed for approximate physical aggregate measurements. No independently validated model or labeled dataset is installed; no supported high-accuracy condition score is claimed.

The digital twin uses the existing WebGL2 renderer and tire/suspension model. Its registration panel maps baseline contours back to the original capture with the same planar homography used for rectification. Selecting either outline focuses that candidate in 3D. Road dimensions, relief, growth and vehicle responses remain explicit assumptions.

## Network workflow

1. Open **Road network → Your connected network**.
2. Import a WGS84 GeoJSON FeatureCollection containing LineString/MultiLineString roads. Optional id and properties.name identify each segment.
3. The map fits actual geometry, supports drag/zoom, displays shared junctions and counts connected components.
4. Select start/end nodes to calculate an undirected shortest-distance route.
5. Upload a road image and wait for complete analysis. Select its surveyed segment and explicitly **Attach current analysis to this segment**.
6. The session snapshot includes capture name, API result, rejected candidate IDs and attachment time. Export the segment inspection as JSON. A single observation never becomes a survey of the entire road.

Connectivity uses shared vertices (including interior vertices) snapped within 2 metres. Crossings without shared vertices are not automatically connected, to avoid inventing bridge/overpass junctions. Routing does not model turn restrictions, lanes, travel time or safety. Imported lines are not silently split at visual crossings. Uninspected segments remain unknown, with no fabricated condition grade.

No external maps, road imagery, geolocation, traffic feed or GPS coordinates are inferred from the uploaded photo. The downloadable format example is explicitly fictional. Imported geometry and assignments survive page navigation during this session; reload clears them. Imports are limited to 4 MiB, 2,000 road records and 10,000 vertices.

## Verification

Unit coverage includes automatic analysis, cancellation/stale-result isolation, internal junctions, snapping, disconnected crossings, shortest distance, projection and import validation.

Live API checks include the provided pothole photo, actual overlays/candidate output, road-region scope, calibrated selected area and invariance of all 17 descriptors when only excluded scenery changes.

Browser acceptance covers actual upload → texture/chip output → overlay → GeoJSON route → inspection attachment → source-registered GPU twin on desktop and mobile.
