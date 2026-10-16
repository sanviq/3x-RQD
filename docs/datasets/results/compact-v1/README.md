# Compact multinational detector — measured results

Trained for 50 epochs. Checkpoint SHA256: `924b44828eb8fda4bc87614a7107c450a3f5a9d679d8f48373f5d52ddf1db11d`.
Prototype activation checks passed on validation and held-out test: **False**.
These are internal class-enriched subset metrics, not national prevalence estimates or validated road safety scores.

The checkpoint was selected using validation only, frozen, then evaluated once on the internal held-out test. The generic COCO checkpoint was used only for pretrained initialization. No matched road-trained baseline is available, so no improvement claim is made.

- validation: 170 images; mAP50 0.3084; mAP50:95 0.1495; diagnostic P 0.5414, R 0.1593, F1 0.2462 at confidence .35/IoU .5.
- test: 185 images; mAP50 0.2871; mAP50:95 0.1298; diagnostic P 0.5508, R 0.1435, F1 0.2277 at confidence .35/IoU .5.

Per-class and country/view results are in the JSON reports. The predeclared activation checks are in `activation.json`. A failed checkpoint remains an experimental download and is not activated in the local app.

[Dataset, model and evaluation artifacts](https://github.com/sanviq/3x-RQD/releases/tag/rdd2022-compact-v1).
