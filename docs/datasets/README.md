**Current workflow:** [expanded experiment, completed results and refinement](../../MODEL_IMPROVEMENT.md), with [compact dataset access](COMPACT.md). The full-archive instructions below are optional; the full download was stopped in favour of the compact subset.

# RDD2022 provenance and team access

The data comes from the [official RDD2022 Figshare release](https://figshare.com/articles/dataset/21431547), DOI `10.6084/m9.figshare.21431547.v1`, licensed CC BY 4.0. The publisher's exact file size, MD5, country subsets, class mapping and citation are recorded in [RDD2022.source.json](RDD2022.source.json). Cite the dataset authors when using the data or reporting results.

Each teammate can download the same verified original archive. The 13,264,172,619-byte archive and prepared images stay **outside Git**. Git history contains source provenance, small examples and reproducible commands; the compact datasets and checkpoints are shared separately as GitHub Release assets. Do not force-add ignored data files. Published image totals are not a local audit.

From the repository root, with Python 3.12 and the existing environment:

```sh
python3 -B tools/download_rdd2022.py --directory "$HOME/Datasets/RDD2022/original" --workers 4
.venv-roadhealth/bin/python -m tools.prepare_rdd2022 \
  "$HOME/Datasets/RDD2022/original/RDD2022_released_through_CRDDC2022.zip" \
  --output "$HOME/Datasets/RDD2022/prepared-v1" --seed 42
```

Only the downloader accesses the network. It resumes completed ranges, verifies exact response ranges and checks the publisher's MD5 before renaming `.part` to `.zip`. MD5 is an integrity check, not a security signature. Keep the verified original unchanged. Preparation reads the stored country ZIPs directly, verifies each consumed image/XML CRC, decodes images, checks XML filenames/dimensions, and validates boxes. It creates a new output directory and refuses to overwrite one.

Mapping: `0=D00 longitudinal crack`, `1=D10 transverse crack`, `2=D20 alligator crack`, `3=D40 pothole`. VOC's 1-based inclusive boxes become normalized YOLO center/size coordinates. Out-of-bounds/unknown-class/mismatched pairs are excluded and reported, without silently clipping or making negatives. Explicit empty XML annotations are allowed as labelled negatives; difficult objects remain annotated positives. Identical pixels with conflicting labels are quarantined.

The internal train/validation/test targets are 80/10/10 of **labelled training data**. Exact decoded-pixel duplicates, dHash distance <=2 with close 16×16 color thumbnails (mean absolute difference <=3 and 99th percentile <=12), and same-country filename blocks of 100 consecutive numbered images are grouped together before deterministic allocation. Group sizes can change actual proportions. These are identifiable-related-frame safeguards, not proof that unknown routes do not overlap. Original unlabelled challenge test images are counted separately and never used as negatives or for accuracy.

Preparation produces `audit.json` (countries, counts, objects, exclusions and split balance), `manifest.json` (source paths/hashes, groups and split assignments), YOLO labels, and `data.yaml`. Preserve the manifest and source hashes with every experiment. Review the complete audit before training; missing classes, heavy exclusion or giant groups require investigation.

# Training and evaluation

Install the tested optional training environment with `.venv-roadhealth/bin/python -m pip install -r requirements-training.lock.txt` (Python 3.12; the lock records the tested macOS environment, so check wheel support on other platforms). Generic COCO pretraining is for initialization only; it cannot detect these four road-damage classes before fine-tuning. The trusted base checkpoint used here is `yolov8n.pt` from [Ultralytics' official release](https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt), stored outside Git.

A bounded compute pilot uses up to 96 training and 32 validation images for two epochs, never the held-out test. Its output is **not** a final model or accuracy result:

```sh
.venv-roadhealth/bin/python -m tools.benchmark_detector \
  "$HOME/Datasets/RDD2022/prepared-v1/data.yaml" \
  --base "$HOME/Datasets/RDD2022/checkpoints/yolov8n.pt" \
  --output "$HOME/Datasets/RDD2022/benchmark-v1" --device mps --batch 2
```

Report `benchmark-report.json` and obtain approval before a long run. Extrapolations exclude full validation, thermal throttling and checkpoint overhead. MPS reproducibility is best effort; fixed seed/settings do not promise bit-identical training across devices or library versions.

After approval, an example full run is:

```sh
.venv-roadhealth/bin/python train_detector.py \
  "$HOME/Datasets/RDD2022/prepared-v1/data.yaml" \
  --base "$HOME/Datasets/RDD2022/checkpoints/yolov8n.pt" \
  --output "$HOME/Datasets/RDD2022/runs/rdd-v1" \
  --device mps --imgsz 640 --batch 2 --epochs 50 --lr 0.001 --seed 42
```

`reproduction.json` records input hashes, package versions and settings. AdamW is explicit so the chosen learning rate is used. Ultralytics saves `weights/best.pt`, `weights/last.pt`, CSV logs, plots and periodic checkpoints. Resume the same output using `--resume /absolute/run/weights/last.pt` in place of `--base`; saved training/optimizer settings are restored. The prepared manifest, images and labels are reverified, including cross-split group/pixel leakage. Existing run directories and base weights are preserved.

Evaluate validation first:

```sh
.venv-roadhealth/bin/python -m tools.evaluate_detector \
  "$HOME/Datasets/RDD2022/prepared-v1/data.yaml" \
  --checkpoint "$HOME/Datasets/RDD2022/runs/rdd-v1/weights/best.pt" \
  --output "$HOME/Datasets/RDD2022/evaluation/rdd-v1-val" --split val --device mps --batch 2
```

Freeze model choice and inference settings using validation only. For the untouched held-out test, use a new output, `--split test`, and `--frozen-sha256 EXACT_BEST_CHECKPOINT_SHA256`. Do not tune on test or select the better checkpoint after seeing test results. Hashes are printed at training completion; `shasum -a 256 /path/to/best.pt` also reports the hash.

Outputs include aggregate/per-class precision, recall, F1 and AP, mAP50/mAP50:95, Ultralytics PR/confusion plots, raw predictions, explicit-threshold FP/FN counts and annotated examples (green ground truth, red predictions). AP uses confidence ranking down to 0.001; diagnostic P/R use `--confidence` (default .25) and box IoU .5. Ultralytics' reported P/R use its operating-point convention. No segmentation accuracy is claimed: RDD2022 provides boxes. A model improvement claim requires comparable held-out results from a legitimate baseline; a matched road-trained baseline comparison is now recorded in [the expanded results](results/improvement-v2/README.md).

# Backend integration gate

Do **not** configure the generic pretrained checkpoint or benchmark weights as the road model. After final evaluation and review, set the approved checkpoint explicitly:

```sh
ROAD_HEALTH_MODEL="$HOME/Datasets/RDD2022/runs/rdd-v1/weights/best.pt" ./scripts/start-local.sh
```

The existing endpoint contracts and teammate UI are retained. D00/D10/D20 remain compatible `class_name=crack`, with additive `detection_code` and `detection_label` preserving exact predictions; D40 maps to `pothole`. Boxes and confidence come from inference. Detection confidence is not road quality. With no detections or low mean confidence, model inspection returns `score=null`, `band=Unassessable`, and requests repeat capture. Score weights and severity remain unvalidated policy estimates even after detector training. This four-class model does not validate ravelling, friction, material composition, depth or overall road safety.

The application remains in demo mode until that gate is passed. No checkpoint is automatically promoted by downloading, preparing, benchmarking or training.

# Current local pilot

The checked-in [India audit summary](audits/india-pilot.json) covers only the India member extracted from already downloaded full-archive ranges (embedded CRC verified). It prepared 6,648 labelled pairs: 5,330 train, 630 validation and 688 held-out test; 1,959 unlabelled official test images were excluded from accuracy evaluation. The 1,058 excluded pairs mostly contain annotation classes outside the four requested classes. Counts of all original class labels and first-failure exclusion reasons are in the audit. Whole images with unsupported annotations are excluded to avoid treating their unmodelled damage as negative examples. D10 is rare in this subset (63 retained boxes); an India-only detector would need careful per-class review.

The [compute pilot](audits/india-compute-pilot.json) ran two epochs on 96 training and 32 validation images with the pretrained YOLOv8n initialization, MPS, 640 pixels and batch 2. Its warm second training epoch took about 5.75 seconds, extrapolating to 4.43 hours for 50 epochs on the prepared India training split **before** validation, checkpoints and thermal effects. This is not the full multinational estimate or a model-quality result. MPS emitted nondeterministic-kernel warnings despite a fixed seed. The held-out test was not evaluated. Benchmark checkpoints remain outside Git and are not configured in the application.

For a long download, a separate optional continuation command waits for the checksum-verified final archive, prepares the full dataset, writes local reports and **stops before training**:

```sh
.venv-roadhealth/bin/python -m tools.continue_rdd_preparation \
  --archive "$HOME/Datasets/RDD2022/original/RDD2022_released_through_CRDDC2022.zip" \
  --output "$HOME/Datasets/RDD2022/prepared-multinational-v1" \
  --report-directory "$HOME/Datasets/RDD2022/reports"
```

Read `reports/preparation-status.json` for the durable status and `reports/multinational-audit-summary.json` when complete. This continuation never starts training, configures a model, or pushes GitHub changes. Review the real full audit before publishing its summary and requesting long-run approval.
