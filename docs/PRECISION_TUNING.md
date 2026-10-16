# Precision tuning

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
