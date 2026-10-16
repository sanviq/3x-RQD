# RDD2022 improvement and backend integration

The existing teammate frontend, footprint mapping, connected networks, four-wheel driving physics, and repair/weather workflows are retained. Their `24593f2` changes were fetched and fast-forwarded locally on 16 October 2026. Pre-existing uncommitted work was backed up outside the repository before syncing.

## Latest completed results

The expanded YOLOv8n run finished all 50 epochs. On the same 511-image internal held-out test at confidence .35, the old pipeline achieved precision 53.8%, recall 13.1% and mAP@.50 24.5%; the new pipeline achieved **59.2%, 25.1% and 32.4%**, respectively. This compares complete pipelines at 640 versus 768 px. The candidate improved but failed the recall gate and remains inactive. The **90% precision target is not reached**.

The [measured reports](docs/datasets/results/improvement-v2/README.md) and [release assets](https://github.com/sanviq/3x-RQD/releases/tag/rdd2022-improvement-v2) are published. The 1.28 GB selected-original archive, checkpoint, hashes and evaluation evidence have finished uploading.

## Follow-up YOLOv8s experiment

**Stopped for the project deadline.** No YOLOv8s training is currently running. Partial weights are preserved, and its early-epoch metrics do not replace the completed v2 detector results. The configuration below records the attempted experiment; rerunning it starts an expensive job and is not needed to launch the application.

A validation-only trial of the same frozen v2 checkpoint at 1024 px reduced precision from 60.0% to 53.0%, recall from 24.2% to 23.6% and mAP@.50 from 33.4% to 30.4%. That setting was rejected. See [the reproducible comparison](docs/datasets/results/precision-refinement-v3/resolution-check.json).

The next bounded experiment trains **YOLOv8s** from official generic pretrained weights on the same 2,851 training images, with the same 803-image validation split. It uses up to 50 epochs, 768 px, batch 1, AdamW learning rate .001, seed 42, mosaic .5, scale .3, rotation 2 degrees and patience 15. Capacity and initialization differ from the nano warm start, so the experiment does not isolate a single causal factor.

The 96-training/32-validation-image compute pilot completed two epochs on this 8 GB M3 Mac. Its warm training epoch took 16.34 seconds; linear extrapolation is about **6.74 training-only hours for 50 epochs**, with full validation, checkpointing and thermal effects additional. Pilot metrics are not accuracy evidence. Data and original weights remain unchanged; progress, logs and checkpoints live outside Git under `~/Datasets/RDD2022/precision-refinement-v3/yolov8s-50`.

```sh
.venv-roadhealth/bin/python -m tools.run_precision_refinement \
  /path/to/improvement-v2/prepared/data.yaml \
  --base /path/to/trusted/yolov8s.pt \
  --baseline-validation /path/to/improvement-v2/candidate-validation/report.json \
  --output /path/to/new-experiment \
  --epochs 50 --imgsz 768 --batch 1 --lr .001 --device mps --register
```

The runner refuses to overwrite a run, preserves the previous local training pointer, saves best/resume checkpoints, and evaluates **validation only**. It records improvements and regressions at a matched confidence threshold and writes the precision-target profile. It never activates the model or silently repeats the exposed 511-image test. A selected candidate still needs a newly reserved independent holdout for final confirmation. Check the website's **Model evaluation** page for live status.

The older protocol below documents how the completed v2 experiment was run.

## Measured starting point

The compact-v1 checkpoint completed 50 epochs. On its original internal test, mAP@.50 was .2871 and mAP@.50:.95 was .1298. At confidence .35, precision was .5508, recall .1435 and F1 .2277. These are different quantities from Ultralytics' automatically selected precision/recall operating point. It failed the prototype activation checks and remains experimental.

On validation, 205 of 225 annotation rectangles smaller than 1% of the image were missed at confidence .35. A validation-only sweep from .05 to .80 found no operating point satisfying both precision ≥.50 and recall ≥.30. Raising confidence alone cannot solve this. `tools.analyze_detector_errors` reproduces the sweep; it rejects test-set input.

## Approved bounded experiment

- Select 750 genuine labelled pairs per capture subset: China_Drone, China_MotorBike, Czech, India, Japan, Norway, United_States. Target 5,250 images; maximum original-pair bytes 1,800 MiB. Actual size and exclusions are recorded in the collection audit, not guessed.
- Read cached official HTTP ranges and existing selected originals before fetching new ranges. Check exact response ranges, ZIP CRCs, JPEG decode, image/XML dimensions, bounding boxes and SHA256. Preserve old data, caches and checkpoints.
- Group the combined new and old inventories using pixel hashes, close dHash/color thumbnails and filename blocks. Previously trained groups stay training. Previously exposed validation/test groups become validation. Bridges joining both are quarantined. Prefer up to 200 images per view from previously untouched filename blocks where available. Reserve all wholly new groups for the final test; validation uses previously untrained holdouts. Some country views have no fresh blocks left under this grouping policy, so a fresh test cannot automatically represent all countries. Report its exact coverage. Unknown route relationships remain a limitation.
- Fine-tune the existing four-class YOLOv8n checkpoint for up to 50 additional epochs, 768 px, batch 2, AdamW learning rate .0005, seed 42, MPS, workers 0. Use mosaic .5, scale .3, rotation 2 degrees, and patience 20. This is a warm start with a fresh optimizer, not an interrupted-run resume. Best checkpoint is selected on validation.
- Input processing remains aspect-preserving letterbox, BGR→RGB, tensor arrangement and division by 255. The larger resolution preserves more small-defect detail. No automatic contrast equalization, sharpening or invented deblurring is applied. More preprocessing is not assumed to improve accuracy.
- Select a threshold using validation only. Freeze checkpoint SHA, resolution and threshold before evaluating the new final test. Evaluate the old detector on exactly the same test at its original 640/.35 settings. The comparison measures complete pipelines, including the resolution change.
- Internal activation requires validation/test precision ≥.50, recall ≥.30, mAP@.50 ≥.30 and all four class AP@.50 ≥.10. It additionally requires no precision or mAP@.50:.95 regression, and improved recall, F1 and mAP@.50 against the old pipeline on the fresh test. These are prototype checks, not road-safety certification. Failed candidates remain downloadable experiments and are not activated by default.

Expected training time is roughly 5–9 hours on this 8 GB M3 Mac, based on the earlier 79-minute run; preparation, publication and thermal throttling add uncertainty. Use wall-clock logs for the actual duration. Keep the Mac plugged in with the lid open. `caffeinate -i -w PID` prevents idle sleep while the job exists; it does not prevent closed-lid sleep, power loss, shutdown, or battery exhaustion.

## Local job and logs

Dataset/job root on this machine: `/Users/SANVI/Datasets/RDD2022/improvement-v2`.

```sh
cd /Users/SANVI/Downloads/3x-rqd
cat /Users/SANVI/Datasets/RDD2022/improvement-v2/status.json
tail -f /Users/SANVI/Datasets/RDD2022/improvement-v2/pipeline.log
```

The job is a detached subprocess. It does not depend on the chat or Terminal staying open. The supervisor waits for the separately running collection, audits and prepares data, trains, evaluates, conditionally activates, and publishes. It stops and records a failure if a stage fails. It does not automatically repeat final-test-based experiments or hide failures.

`Model evaluation` in the frontend displays measured results and polls local job progress. `GET /api/research/training-status` exposes the phase and completed epoch count without loading any training images. `GET /api/research/model-evaluation` supplies stored genuine results. Restarting the app is unnecessary after successful activation: inference hot-reads the atomic local registry and verifies the checkpoint SHA.

Exact protocol, package versions, source commit, manifests, logs, best/last weights, threshold sweep, FP/FN examples, PR curves, confusion matrices and matched reports are preserved under the job directory. Configuration is in `protocol.json` and `run/reproduction.json`. Resume an interrupted run using `train_detector.py DATA --resume RUN/weights/last.pt --output RUN --device mps`; do not rerun the whole pipeline over an existing output.

## Dataset and model sharing

Source code, audit summaries and the small attributed gallery belong in Git. Original datasets and weights belong in GitHub Release assets, with SHA256 files; they are not frontend bundles or Git history. Expanded results are published at the end of the job to the `rdd2022-improvement-v2` release. Do not assume the release exists before the job reaches publication.

To reproduce collection:

```sh
.venv-roadhealth/bin/python -m tools.collect_rdd_subset \
  --original /path/to/existing/official/archive-directory \
  --reuse /path/to/compact-v1 \
  --output /path/to/new-selected --per-subset 750 --max-mib 1800 \
  --prior-manifest /path/to/previous/prepared/manifest.json
```

`--original` and `--reuse` are optional. Collecting remotely can fetch additional range-cache bytes beyond the final selected-original size. The original full 12 GB download is not resumed. To reproduce the expansion splits from the released subset, extract it and run:

```sh
.venv-roadhealth/bin/python -m tools.build_compact_dataset /path/to/extracted \
  --output /path/to/new-prepared \
  --prior-manifest /path/to/extracted/prior-manifest.json --fresh-test-only
```

The released prior manifest includes duplicate-detection thumbnails. Local preparation can instead use the earlier unchanged prepared manifest/images. Never drop the prior-manifest option when reproducing the improvement experiment: it protects against contamination from the already trained/evaluated v1 subset.

## Phase 5 API integration

`app/integrated_detector.py` adapts real D00/D10/D20/D40 predictions into the teammate `DefectDetection` geometry contract, without removing OpenCV support. Both `/detect-defects` and `/api/detect-defects`, and `/analyze`'s `defect_detection`, use this adapter. The advanced `/api/inspect` image/video/camera workflow uses the same selected model. Additive method/provenance variants are accepted by the frontend and actual RDD class codes, confidence and original-image boxes are retained. Each bbox is mapped to a schematic road footprint for the existing simulator. It is explicitly **not a segmentation mask or depth measurement**.

The default detector registry is `.local-road-health/detector.json` (ignored by Git). A successful run writes an atomic SHA-bound record. `ROAD_HEALTH_DETECTOR_REGISTRY` can select another trusted local registry. `ROAD_HEALTH_MODEL=/trusted/local/checkpoint.pt` remains an explicit experimental override for development, not a reliability-gate pass. Only load trusted weights; checkpoint deserialization can execute code. Supported registry status is visible at `/api/status`.

No accepted model means the teammate workflow returns clearly labelled OpenCV candidates, and the advanced tool retains explicit demo mode. With any real model, health grades remain withheld: confidence is not road quality; no detection is not a healthy road. RDD2022 cannot validate aggregate material composition, slope, actual damaged pixel area, physical depth, friction or the arbitrary road-health formula.

## Country comparison

`Surface inspection` includes real country/capture comparisons: image counts, human annotation counts, boxes/image, approximate union of bounding rectangles, small-box fraction and original resolution. When available, held-out detector P/R/F1 is shown separately. The site reads one small precomputed report; it never loads the dataset into the frontend.

Class-enriched samples cannot establish national road-quality rankings or causal explanations. Drone versus motorbike imagery, image resolution, annotation sizes and class mix are observable comparison factors. Verified differences in materials, maintenance, climate, traffic or construction require representative route surveys and supporting records. Indian state coverage is unknown. National road-health scores are returned as null.

## Verification

```sh
.venv-roadhealth/bin/python -m pytest -q
cd frontend
npm test -- --maxWorkers=1
npm run build
npm run lint
npm run test:core
npm run test:api-core
```

Tests cover SHA-bound activation rejection, failed recall, matched-test comparison, protected fresh holdouts, correct RDD classes/coordinates, both API prefixes, empty-detection uncertainty and existing simulator compatibility. Synthetic contract fixtures are labelled as such. A real-checkpoint smoke test demonstrates execution only; it is not an accuracy benchmark.

Training and inference configuration follows the [Ultralytics training documentation](https://docs.ultralytics.com/modes/train/). Dataset attribution and scope are from the [official RDD2022 release](https://figshare.com/articles/dataset/21431547).
