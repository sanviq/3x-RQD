# Share and import GPS inspection records

**Demo workspace** uses six illustrative road segments, charts and repair
priorities. **Live workspace** uses explicitly saved/imported local inspection
records. Training a detector does not create inspected GPS road segments.

In Overview → Live workspace or Road network → Saved GPS surveys:

1. Choose **GPS inspection JSON file**, or paste JSON into the text box.
2. Choose **Preview import**. Review IDs, coordinates, provenance, defect counts
   and declared distance. This step does not save inspection rows.
3. Choose **Save N records locally**. The entire batch is saved together and the
   overview/map refreshes. Existing IDs cause rejection; no rows are overwritten.

To share records with a teammate, use **Export local survey**. Transfer the JSON
through your team's chosen channel, then preview/import on their computer. This
can contain precise GPS and evidence previews; it is not automatically published
to GitHub. Original-resolution photographs are not part of this export.

The importer accepts a JSON object with a `segments` array of 1–200 records,
10 MiB maximum per file and 200 total local segments. The downloadable format
contains replacement fields and null coordinates so it cannot silently create
fake survey locations. Fill it with actual capture data. Each record needs:

- `id`, `name`, `latitude` (−90…90), `longitude` (−180…180),
  `distance_start_m` (nonnegative) and `length_m` (positive), all WGS84 degrees/metres.
- Explicit `provenance`: `model` for detector predictions or `manual` for human
  inspection annotations. Demo records are rejected by the live importer.
- `assessment` with actual `defects`, image `width`/`height`, optional
  `mm_per_pixel`, `inclination`, scoring `config` and `repaired` IDs. Defaults for
  optional fields follow the normal inspection API. Defects use supported
  `class_name`, `confidence`, `severity`, and normalized `[x1,y1,x2,y2]` boxes.
- Optional `evidence` of inline JPEG previews and `capture_notes`.

An empty defect list is not proof of road health. Imported model records retain
an unassessable road-health grade; confidence is not quality. User-supplied GPS,
scale, sensor readings and manual annotations are not independently verified.
Scores/summary fields in exports are discarded and recalculated, never trusted
as imported measurements. Duplicate IDs within a batch, invalid records, existing
IDs and capacity violations reject the whole batch without partial writes.

Road geometry without inspection annotations should instead be imported as
GeoJSON in **Road network → Your connected network**, then linked to captures.

API: `POST /api/segments/import/preview` and `POST /api/segments/import` accept the
same JSON. The prefix-stripping Vite proxy also supports the unprefixed paths.
