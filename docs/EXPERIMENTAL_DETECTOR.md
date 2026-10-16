# Run the completed detector on real images

The completed YOLOv8n checkpoint is available for **explicit experimental preview**, even though its recall failed the automatic qualification gate. Preview does not certify the model or enable automatic detection in the separate surface/simulation workflow.

## On the configured local machine

1. Open **Surface inspection** and select your road photo.
2. In **Road-defect analysis**, select **Trained YOLO · experimental inference**.
3. Use confidence **0.35** and resolution **768 px**, then click **Run trained detector**.
4. Review actual classes, boxes, confidence, and cropped previews. Results may miss defects or contain false positives. No detections does not mean the road is healthy.

When a trained detector is available, the updated workspace selects it automatically. Running inference still requires the user's button action. **Generate demo annotations** explicitly generates fixed illustrations and says so in its result message. An unavailable model is disabled instead of silently producing demo predictions. Connection failures offer a retry without clearing the selected photo.

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

The existing qualification registry (`detector.json`) and its gates remain separate. `/api/status` distinguishes an available interactive preview from `automatic_detection_configured`. Preview inference runs only through an explicit model request; automatic upload analysis retains OpenCV until a qualified or explicitly configured default exists.

The recorded internal v2 test result remains **59.2% precision and 25.1% recall** at confidence .35. Individual prediction confidence is not this test precision and is not road-health quality. Model-mode engineering scores remain withheld. Box overlays are schematic area estimates, not segmentation masks or physical depth measurements. No 90% precision claim is made.
