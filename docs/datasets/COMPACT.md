# Current project dataset: a compact real multinational subset

The project now uses selective access to the official RDD2022 archive instead of completing the 12.36 GB download. The target is 250 labelled training-source images from each of seven capture subsets: China_Drone, China_MotorBike, Czech, India, Japan, Norway and United_States (1,750 images, six countries). The raw selected data has a hard 650 MiB budget; actual counts and size come from the audit, not this target. This does not establish Indian state, district or route coverage.

The selected images are genuine original JPEGs, with genuine Pascal VOC XML annotations. Exact HTTP range responses, ZIP-member CRCs, decoded dimensions, filenames and bounding boxes are validated. Source file SHA256 values are recorded. Selected originals remain unchanged; prepared training images are independent copies. The complete parent archive's MD5 is not claimed to have been verified for selective retrieval. The old stopped partial archive is reused where available, not uploaded or used as the model's training dataset.

Selection is seeded and enriched for D00/D10/D20/D40 coverage, with approximately 10% explicit empty annotations where available. Images with unsupported classes or invalid XML are excluded instead of silently treating damage as background. This changes prevalence. Measured precision/recall describe the selected internal holdout, not the road network of an entire country.

# Team access on GitHub

- A tiny gallery under `data/examples/rdd2022/` contains resized training-only previews, unchanged original XML, normalized YOLO labels, original file hashes, and attribution. The original XML's dimensions refer to the original image, not its resized preview. These are human ground-truth annotations, never claimed as AI predictions.
- The actual compact original training-source dataset is attached to the [rdd2022-compact-v1 GitHub Release](https://github.com/sanviq/3x-RQD/releases/tag/rdd2022-compact-v1) when collection completes. This keeps hundreds of megabytes out of Git history while giving teammates the same real data.
- The gallery, dataset audit, grouped split manifest and code are versioned in Git. Checkpoints and full evaluation evidence are release assets, accompanied by real metrics and checksums when training finishes.

The dataset is CC BY 4.0. Attribution: Arya et al., *RDD2022: A multi-national image dataset for automatic road damage detection*, Geoscience Data Journal 11(4), 846–862 (2024). [Official Figshare source](https://figshare.com/articles/dataset/21431547), DOI `10.6084/m9.figshare.21431547.v1`; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). All contributing authors are credited at the original source. Changes are selection and resized gallery previews only; packaged original images/XML are unmodified.

After cloning the repository and installing `requirements-training.lock.txt` in Python 3.12:

```sh
gh release download rdd2022-compact-v1 --repo sanviq/3x-RQD \
  --pattern 'rdd2022-compact-v1.zip*' --dir "$HOME/Datasets/RDD2022/team-download"
cd "$HOME/Datasets/RDD2022/team-download"
shasum -a 256 -c rdd2022-compact-v1.zip.sha256
python3 -m zipfile -e rdd2022-compact-v1.zip selected
```

Return to the cloned repository, then reproduce the prepared split:

```sh
.venv-roadhealth/bin/python -m tools.build_compact_dataset \
  "$HOME/Datasets/RDD2022/team-download/selected" \
  --output "$HOME/Datasets/RDD2022/team-prepared-v1"
```

The split targets 80/10/10, grouping pixel-identical images, close perceptual/color matches and numbered filename blocks. These reduce identifiable leakage; they do not prove route-disjointness where route metadata is absent. Conflicting labels on identical pixels are quarantined. Inspect actual counts, class support and country/view coverage in `audit.json`. Only labelled training-source images enter this internal test set; unlabelled official challenge test images are never used as negatives or for accuracy.

# Website behaviour

The FastAPI backend serves `/api/dataset/examples` and individual small gallery files on demand. Dataset originals and training jobs are never loaded into the React bundle. The existing team frontend remains the application; its added dataset explorer displays one real image and its human annotations at a time. Officers can send a gallery image through the existing analysis workflow. Dataset images have no established physical calibration or IMU reading; calibration from an unrelated uploaded capture is not applied.

Demo detection mode still uses explicitly synthetic fixtures. Showing real images does not convert those fixtures into genuine predictions or accuracy results. Local model mode uses actual trained weights only when configured; confidence is not road-health quality. Unknown/low-confidence results withhold the road-health score.

# Approved training and honest evaluation

The user approved a 50-epoch local run: pretrained YOLOv8n, 640 pixels, batch 2, AdamW learning rate .001, seed 42 and Apple MPS. Estimated runtime from the earlier pilot is roughly 1–2 hours, with actual timing dependent on decoding, validation and thermal throttling. Code revision, package versions, dataset and checkpoint hashes, logs and periodic/best/last checkpoints are recorded. MPS kernels can remain nondeterministic despite a fixed seed.

The best checkpoint is selected using validation only, then frozen by SHA256 before held-out test evaluation. Reports contain native aggregate/per-class AP and P/R/F1, PR/confusion plots, explicit-threshold diagnostic P/R/F1 and FP/FN at confidence .35 and IoU .5, country/view diagnostic comparisons, raw predictions and annotated examples. Small country/view sample counts and enriched prevalence limit comparisons. No matched road-trained baseline exists, so no improvement claim is made. The old tiny India resource-pilot checkpoint is not used to initialize this run.

Before seeing test results, the local prototype activation checks are declared in `tools/run_compact_training.py`: diagnostic precision >=.50, recall >=.30, native mAP50 >=.30, and AP50 >=.10 for each of all four classes, on both validation and held-out test. These are project checks, not a national benchmark, calibration guarantee or road-safety certification. Failed weights remain an experimental download and are not activated. Passing does not validate road severity, inclination, material properties, depth or engineering quality weights.

# Unattended workflow and status

`tools.finish_compact_project` waits for the small collection, builds/audits splits, publishes the real gallery and data release, then invokes `tools.run_compact_training`. Results are committed through isolated checkouts, preserving workspace edits. Only explicit data/result paths are staged. No raw full dataset, credentials or personal filesystem paths are committed. A managed local server can be restarted with the evaluated model only when the predeclared checks pass.

Local durable files are `project-status.json` and `training/training-status.json` in the active `compact-job-v*` directory under the local RDD2022 directory. Failed attempts are preserved in their own versioned directories. Training progress/logs live beside them. A background `caffeinate -i` assertion prevents idle system sleep; the display can turn off. Keep the lid open and connect power. Lid closure, shutdown, logout or losing connectivity can interrupt work; saved checkpoints/download caches are preserved. The existing training CLI supports resuming interrupted training from its own `weights/last.pt`.
