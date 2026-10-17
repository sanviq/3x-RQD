# Run the completed detector on real images

The completed YOLOv8n checkpoint is available for **explicit experimental preview**, even though its recall failed the automatic qualification gate. Preview does not certify the model or change the automatic qualification registry.

## On the configured local machine

1. Open **Surface inspection** and select your road photo.
2. The main **Detected road candidates** viewer defaults to **Untrained visual candidates · OpenCV**. To compare the saved checkpoint, explicitly select **Trained YOLO · experimental**. The selected detector supplies the same detections to the score, drive and scenario lab.
3. Start with confidence **0.35** and model image size **768 px**, the recorded evaluation settings. The controls in this panel rerun the selected photo. Lower confidence reveals additional candidates and may increase false alarms; a larger image size is not guaranteed to help.
4. Review actual classes, boxes and confidence. The checkpoint still misses substantial damage. It supports potholes and three crack types. Depression and uneven-patch features remain available in the interface and OpenCV/manual-review workflow; this checkpoint does not provide trained predictions for those classes.

**Untrained visual candidates · OpenCV** is a separate, explicit option. Its CV labels come from brightness/texture contours and can confuse small cracks, shadows and puddles with potholes. A requested trained model that fails returns an error; it never silently becomes OpenCV output. Without model weights, select the untrained option or configure the checkpoint below.

OpenCV candidate extraction v2 separates strong cavity rims, reflected basins and thin cracks before deduplication. Strong-rim convex outlines are approximate, not validated segmentation masks. Small bright texture islands need stronger rim evidence. Overlap is checked using candidate polygons so neighbouring cavities with overlapping boxes can remain distinct. A conservative colour-based road proposal reduces scenery leakage, but still requires review. Regression examples exercise these changes; no population accuracy improvement is claimed.

The additional **Road-defect analysis** panel retains its explicit **Run trained detector** button, individual crops, videos and camera controls. Both panels use the saved checkpoint; their confidence and image-size settings can differ.

When a trained detector is available, the updated workspace selects it automatically. Running inference still requires the user's button action. With `VITE_ENABLE_DEMOS=true`, **Generate demo annotations** explicitly generates fixed illustrations and says so in its result message. Demo controls remain hidden by default. An unavailable model is disabled instead of silently producing demo predictions. Connection failures offer a retry without clearing the selected photo.

A tab opened before the interface update keeps its old labels until refreshed. Its existing **Local road-specific YOLO model** option already uses the configured preview. Refreshing may require selecting the photo again.

## Set up another teammate's machine

No training dataset or new training run is needed for inference. Install the optional model dependencies in the application's Python environment:

```sh
.venv-roadhealth/bin/python -m pip install -r requirements-model.txt
```

Download the checkpoint and three small reports from the existing release (about 7 MB total), outside the repository:

```sh
gh release download rdd2022-improvement-v2 --repo sanviq/3x-RQD \
  --pattern road-health-improvement-v2-best.pt \
  --pattern improvement-v2-validation.json \
  --pattern improvement-v2-test.json \
  --pattern improvement-v2-activation.json \
  --dir "$HOME/Datasets/RDD2022/preview-v2"

.venv-roadhealth/bin/python -m tools.configure_detector_preview \
  "$HOME/Datasets/RDD2022/preview-v2"

./scripts/start-local.sh
```

Alternatively download those four files through [GitHub Releases](https://github.com/sanviq/3x-RQD/releases/tag/rdd2022-improvement-v2). On Windows use the corresponding `.venv\Scripts\python.exe` command, a Windows directory path, and `node dev.mjs` to launch after installing frontend dependencies.

For an existing full experiment directory, pass that directory to the same configuration command. The tool recognizes both layouts. It checks the frozen checkpoint SHA256, report identity, four RDD classes, and operating threshold. It refuses to replace a different existing preview configuration.

## What preview changes

The local configuration is `.local-road-health/experimental-detector.json`, excluded from Git. Set `ROAD_HEALTH_PREVIEW_REGISTRY` before server startup to select another local preview file. The checkpoint and all original training data remain unchanged.

The existing qualification registry (`detector.json`) and its gates remain separate. `/api/status` distinguishes an available interactive preview from `automatic_detection_configured`. The main interactive uploader sends `detector_mode=model`; the `/detect-defects` and `/analyze` APIs retain `auto` as their backward-compatible default, which uses only a qualified or explicitly configured default. API callers can explicitly request `model` or `opencv`. A model failure in `/analyze` preserves texture measurements with a warning, without substituting contour detections.

Inference receives the original EXIF-oriented image. Ultralytics handles its aspect-preserving model resize/padding, normalization and box mapping; OpenCV contour enhancement is not applied to YOLO input. RDD2022 detection boxes describe image regions, not measured pothole boundaries or depth. Real depression/uneven-patch recognition needs appropriate labelled model classes; preprocessing cannot add missing classes.

The main review suppresses overlapping boxes of the same RDD class at IoU 0.50 so duplicate predictions do not inflate counts. On the saved 803-image validation predictions at confidence 0.35, this reduced false positives from 386 to 325 and true positives from 579 to 572. This is a validation-only preview filter, not a new held-out result; the recorded 59.2% test precision describes the original evaluated pipeline. Distinct RDD crack classes are retained separately.

The recorded internal v2 test result remains **59.2% precision and 25.1% recall** at confidence .35. Individual prediction confidence is not this test precision and is not road-health quality. Model-mode engineering scores remain withheld. Box overlays are schematic area estimates, not segmentation masks or physical depth measurements. No 90% precision claim is made.
