# Precision tuning

## Project target and refinement sequence

The agreed target is **90% detection precision** at class-correct IoU >= 0.50, with recall, F1, mAP and per-class support reported alongside it. This is a target, not a measured result or a claim of 90% road-health accuracy.

1. Finish the current 50-epoch run and preserve its best checkpoint and complete logs.
2. Use validation predictions to diagnose class-specific false positives, missed small defects, localization errors and annotation problems. Select changes on validation data only.
3. Refine training labels/examples and test controlled changes to sampling, resolution, augmentation or model capacity. Preserve originals, keep related images together, and record each experiment rather than changing many settings without a comparison.
4. Choose the model and operating threshold on validation data. Track whether the 90% target is attainable and how many defects remain missed; the existing 30% recall floor is not a deployment-quality claim.
5. Freeze the selected pipeline, then confirm performance against a matched baseline on an independent holdout. Once a holdout has informed further changes, it cannot provide a fresh final confirmation for those changes; reserve new independent groups for that confirmation.

The running supervisor completes its existing approved evaluation and activation protocol. It does not automatically launch repeated refinement training. Its existing prototype activation gates are separate from the 90% project target; passing them must not be reported as reaching 90%.

## Validation profile

The profile also reports 50%, 70%, 80% and 90% precision targets. Each target chooses the highest recall available on the threshold grid while requiring at least 30% recall. An unattainable target is null, not a promised result. Thirty percent recall is a prototype reporting floor, not a satisfactory inspection completeness standard.

Precision is the fraction of reported detections that match annotations at IoU >= 0.50 and the correct damage class. Raising confidence can reduce false positives, but also misses more defects. It does not increase mAP or establish physical road-health accuracy.

Validation evaluations now save `precision-profile.json` alongside `report.json`, `predictions.jsonl` and `error-summary.json`. The profile tests confidence thresholds 0.01 through 0.99. It recommends the highest-precision threshold with precision >= 0.50 and recall >= 0.30, breaking ties by recall and then lower threshold. Every point includes TP, FP, FN and precision/recall per class. Unsupported or empty prediction precision is null, never a fabricated success. No eligible setting produces a null recommendation.

This recommendation is advisory, not an activation policy change. The existing improvement pipeline selects an F1 operating point meeting its precision/recall floors, freezes it before held-out evaluation, and requires its existing quality gates and matched baseline comparison before activation. Newly launched pipelines search the finer 0.01 grid; an already running supervisor retains its imported selector. Its evaluation subprocesses load the new code and save the additional precision recommendation without restarting training or altering the frozen test protocol.

Reproduce the profile from saved **validation** predictions without additional GPU inference:

```python
import json
from pathlib import Path
from tools.analyze_detector_errors import precision_profile

folder = Path('/path/to/validation-evaluation')
report = json.loads((folder / 'report.json').read_text())
with (folder / 'predictions.jsonl').open() as stream:
    profile = precision_profile(
        (json.loads(line) for line in stream),
        split=report['split'],
        checkpoint_sha256=report['checkpoint_sha256'],
    )
(folder / 'precision-profile.json').write_text(json.dumps(profile, indent=2))
```

Never tune on held-out test predictions. If a different operating point is adopted after inspecting test results, obtain an independent holdout before claiming generalization. If validation offers no useful precision/recall tradeoff, review annotation errors and false-positive examples, add representative training examples and retrain; do not conceal misses by filtering everything out.
