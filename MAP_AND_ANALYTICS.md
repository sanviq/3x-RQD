# Real road map and inspection analytics

## What changed

The production Overview, Road network and Repair planner now share one persistent, inspection-backed network. They use Leaflet 1.9, OpenStreetMap street tiles and actual Overpass road geometry. The existing cream/sage dashboard layout, upload workflow, backend defect analysis, provisional scoring and Scenario Lab remain.

There is no sample-network switch or sample-score fallback in these views. A gray, dashed road means **Not inspected**. A provider failure displays an error and preserves saved evidence. The optional research/demo controls elsewhere require VITE_ENABLE_DEMOS=true; they do not populate map analytics.

## Workflow

1. Open Overview or Road network. Bengaluru is the configurable initial map view because the prior workspace targeted Bengaluru; it is never treated as the uploaded photo's GPS.
2. Search a street, locality or city and explicitly submit Search. Select a search result, or pan/zoom and click **Load roads in view**. A small initial area loads only if no network has been saved.
3. Click a road or select it from the accessible segment list. Street names, coordinates, OSM way link and geometric length come from OSM.
4. Upload the actual capture in Surface inspection. Review outlines, exclude false positives and wait for the backend score.
5. Choose **Choose road on map**, select the corresponding road, correct the declared capture coordinates, and confirm the assignment. The initial coordinates are a map point, not extracted GPS. Optionally record that you reviewed the outlines.
6. Save the inspection. The backend checks the file SHA-256 against its detection snapshot, recalculates the score using that snapshot's frozen configuration, and stores original/outlined evidence previews and the analysis date.
7. Overview updates the cards, score chart, observed defect/severity counts and repair-review priorities. Changing detector exclusions later requires **Update linked inspection** to replace the saved snapshot. This deliberate step prevents an unrelated upload from overwriting a road automatically.

No inspection is seeded by this feature. Existing legacy GPS survey records in survey.sqlite3 are retained; their older scoring contracts/demo annotations are not silently imported into the new scored map. Reanalyze the source and explicitly link it when trustworthy evidence is available.

## Geometry and identity

The backend requests highway ways in a bounded WGS84 box. It retains driveable road classes and creates a stable edge for every consecutive OSM node pair. A road bend is not asserted to be a junction; actual shared node IDs preserve connectivity. Bridges and visual crossings are not automatically joined. No turn restrictions, navigation guidance or travel-time estimates are inferred.

Stable IDs include way/start/end node IDs and do not change just because another intersecting road enters the viewport. Real endpoints are retained; a rectangle-intersection check filters edges to the requested area. This avoids double-length accounting from query-dependent splitting. Maximum request span is 0.04° in each direction; 3,000 edges, 40,000 geometry points and 8 MiB provider response limits apply. Zoom in after an oversized-area error.

The network scope is the last loaded area plus segments with saved inspections. Uninspected roads from old areas are removed. Inspected geometry remains available across navigation/restarts. OSM edits can still alter node/way identities; this is not an authoritative asset-management ID registry.

## Score and aggregation

The existing authoritative FastAPI Road Quality Score is reused without a second frontend formula. See ROAD_QUALITY_SCORE.md for all coefficients, thresholds and validation limits.

    image score = clamp(100 - area penalty - hotspot penalty - spread penalty, 0, 100)

Penalties use actual candidate polygons, visual severity, confidence, defect type, and assumed road-plane location. Original visible-road pixel area normalizes the score; overlapping pixels use the strongest risk, not repeated penalties. Image scores are provisional and confidence is not a condition score.

    network mean = sum(latest_image_score × OSM_segment_length)
                   / sum(OSM_segment_length for scored segments)

Unknown roads are excluded, never assigned 0 or 100. No inspections means null average and null defect total. Different score-configuration fingerprints withhold the network mean. Coverage is labeled **mapped length represented by photo samples**, not inspected physical distance: a photo does not establish full-length coverage. Actual photographed distance and physical defect sizes remain unknown without calibration.

Counts summarize retained candidates in the latest image assigned to each segment. They are not a deduplicated census of every defect on the street. The same source-image hash cannot be counted as independent inspections on multiple segments; re-saving or moving it updates the observation. Different photos can still depict the same physical defect, so multi-photo physical identity is not claimed.

Repair review sorts by observed condition score and then high-severity candidate count. It supplies no invented treatment prices or post-repair grades. The shortlist's optional budget is a declared planning input. Surveyed quantities, treatment specifications and contractor rates are needed to assess affordability. Scenario Lab retains its separately labeled assumed-cost experiments.

## Evidence and uncertainty

- evidence_verified=true means the original file hash matches detector evidence on the server. It does not certify GPS, model accuracy, engineering severity, or road safety.
- review_status records a user's declaration; it does not establish expert validation.
- analyzed_at is the current backend scoring time, not an inferred photograph timestamp.
- Original upload bytes are never overwritten. A deliberately saved inspection stores bounded JPEG previews (maximum side 1,200) plus native source dimensions, hash, polygons and scoring metadata. Previews are explicitly labeled; native upload/inference workflows remain intact.
- No trusted road model is active in the checked local /status response. Current automatic candidates use OpenCV. False positives and missed defects remain possible. No expert calibration, accuracy percentage or physical dimensions are invented.
- A source image with no retained detections can have a formula score of 100; it is not proof of an Excellent or safe road. Inspect capture warnings and evidence.

## Configuration

FastAPI reads server environment variables. It does not automatically load an .env file. Set variables in the shell before launching Uvicorn. See .env.maps.example for available names.

| Variable | Default / purpose |
| --- | --- |
| ROAD_HEALTH_MAP_LATITUDE / ROAD_HEALTH_MAP_LONGITUDE | 12.9716 / 77.5946; initial view only |
| ROAD_HEALTH_MAP_LOCATION | Human-readable default-view label |
| ROAD_HEALTH_TILE_URL | https://tile.openstreetmap.org/{z}/{x}/{y}.png |
| ROAD_HEALTH_TILE_ATTRIBUTION | Plain-text provider credit, shown visibly alongside OSM attribution |
| ROAD_HEALTH_TILE_PUBLIC_KEY | Replaces {apikey} in a custom tile URL; only browser-public, domain-restricted credentials belong here |
| ROAD_HEALTH_OVERPASS_URL | https://overpass-api.de/api/interpreter; an Overpass-compatible provider |
| ROAD_HEALTH_OVERPASS_API_KEY | Optional server-only Bearer token |
| ROAD_HEALTH_GEOCODER_URL | https://photon.komoot.io/api/; Photon-compatible search endpoint |
| ROAD_HEALTH_GEOCODER_API_KEY | Optional server-only Bearer token |
| ROAD_HEALTH_MAP_USER_AGENT | Stable application/contact identity for server requests |
| ROAD_HEALTH_DATA_DIR | Local data directory; map.sqlite3 stores geometry and explicit inspection saves |

Private API keys are never returned by /map/config. Only browser-public tile credentials can appear in a tile URL. Do not commit real credentials. URLs are server-configured; client requests cannot choose arbitrary upstream hosts. HTTPS is required except for localhost self-hosted services.

Public services are best effort. If the built-in Overpass service fails, one bounded request to OpenStreetMap's small-area JSON API retrieves real nodes and ways. The backend joins existing node references into the same stable road IDs; incomplete ways are skipped. The UI identifies this fallback. This successfully retrieved Bengaluru geometry during the October 17 fix; availability is still external. No inspection or condition is fabricated.

The fallback allows at most 0.02° in each direction, retains the 8 MiB response limit, caches responses for one hour and spaces its requests by at least two seconds. Initial loading now requests a smaller 0.006° square. Set `ROAD_HEALTH_OSM_FALLBACK=false` to disable it. Custom Overpass URLs retain their provider choice unless an explicit `ROAD_HEALTH_OSM_MAP_URL` fallback is configured. For heavier use, configure a suitable dedicated geometry service. [OSM bounding-box API documentation](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map).

## Provider limits and attribution

- OSM tile attribution stays visible on the map. Browser HTTP caching and Referer behavior are preserved. There is no tile proxy, bulk prefetch or offline tile-download feature. Custom tile-provider credit is shown too.
- Photon search happens on form submission, never on keystrokes. Results are cached for 24 hours; search requests are serialized and throttled to at least 1.1 seconds apart across workers sharing the data directory. Public Photon is intended for reasonable usage and has no availability guarantee.
- Geometry responses are cached for one hour, limited in size/area, serialized and throttled to at least two seconds apart per service. A concurrent provider request returns 429 rather than tying up another request waiting for a network timeout. HTTP 429/406 provider responses add a 30-second cooldown. Built-in Overpass failures permit one clearly identified small-area OSM API fallback; there is no retry loop or rotation through multiple Overpass hosts. If both fail, saved inspections remain intact.
- Request spacing is not a substitute for a provider's daily/aggregate usage limits. Public Overpass is for light use. Before public/high-volume deployment configure a contracted or self-hosted service and its applicable quotas. A multi-host deployment needs a shared limiter/cache; SQLite provides coordination only on the same shared database.
- Location search and visible map bounds are sent to the selected external providers. Uploaded road photos are not sent to OSM, Photon, or Overpass.

References: [Leaflet](https://leafletjs.com/reference.html), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [Overpass provider/usage list](https://wiki.openstreetmap.org/wiki/Overpass_API), [Photon usage guidance](https://github.com/komoot/photon#demo-server).

## API

- GET /map/config — public map settings, attribution, initial coordinates.
- GET /map/search?q=... — bounded, cached Photon lookup.
- POST /map/roads — JSON south/west/north/east; real geometry and current evidence.
- GET /map/network — persistent network, latest linked inspections and authoritative summary.
- POST /map/inspections — multipart original image, segment_id, score_token, excluded_ids, latitude, longitude, location_confirmed, reviewed. A match to server evidence and an explicit assignment are required. Declared positions over 100 m from the selected edge are rejected.

All endpoints also exist under /api. Vite's existing /api proxy remains compatible. This is the existing local, unauthenticated application; expose a deployment only with appropriate access control for its uploaded/saved inspection evidence.

## Tests

    # frontend/
    npm test -- --maxWorkers=1
    npm run build
    npm run lint
    node scripts/check-map-live.mjs
    npx playwright test --config playwright.map.config.ts

    # repository root, Python environment with development requirements
    python -m pytest tests/test_map_api.py -q

Frontend tests check unknowns, evidence ownership, safe API schemas, filters, explicit assignments and stale-response isolation. Desktop/mobile browser tests mock the map provider and road-assignment response explicitly; they use the actual photo detector for upload scoring. They never contact public tile services or save fabricated GPS observations. Live API checks exercise actual provided-photo inference, hash binding, coordinate schema and rejected assignments; they do not persist a test observation. Backend tests use isolated temporary SQLite databases for geometry identity, length weighting, unknowns, cache/rate limits, source binding, exclusions and persistence.

These are implementation checks, not detection accuracy validation. Any backend pytest pass count must come from actual runner output; running FastAPI alone does not prove those unit tests passed.
