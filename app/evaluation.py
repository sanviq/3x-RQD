"""Detection evaluation from externally supplied, image-disjoint ground truth/predictions."""
import numpy as np
from pydantic import Field
from app.assessment import SafeModel, Defect, CLASSES
from app.detection import iou

class EvaluationFrame(SafeModel):
    image_id: str = Field(min_length=1, max_length=120)
    ground_truth: list[Defect] = Field(max_length=200)
    predictions: list[Defect] = Field(max_length=200)

class EvaluationRequest(SafeModel):
    frames: list[EvaluationFrame] = Field(min_length=1, max_length=300)
    confidence: float = Field(default=.35, ge=0, le=1)


def class_metrics(frames, name, threshold):
    truth = {f.image_id: [d for d in f.ground_truth if d.class_name == name] for f in frames}
    predictions = sorted([(d.confidence, f.image_id, d) for f in frames for d in f.predictions if d.class_name == name], key=lambda x: -x[0])
    matched = {key: set() for key in truth}
    positives = sum(map(len, truth.values()))
    tp, fp, curve = 0, 0, []
    for confidence, image_id, pred in predictions:
        candidates = [(iou(pred.bbox, gt.bbox), i) for i, gt in enumerate(truth[image_id]) if i not in matched[image_id]]
        overlap, index = max(candidates, default=(0, None))
        if overlap >= threshold:
            matched[image_id].add(index)
            tp += 1
        else:
            fp += 1
        curve.append({'confidence': confidence, 'precision': tp/(tp+fp), 'recall': tp/positives if positives else 0, 'tp': tp, 'fp': fp})
    ap = None
    if positives:
        ap = float(np.mean([max((p['precision'] for p in curve if p['recall'] >= r), default=0) for r in np.linspace(0, 1, 101)]))
    return positives, curve, ap


def evaluate(req):
    ids = [f.image_id for f in req.frames]
    if len(ids) != len(set(ids)):
        raise ValueError('image_id must be unique; repeated frames bias evaluation.')
    present = [c for c in CLASSES if any(d.class_name == c for f in req.frames for d in f.ground_truth + f.predictions)]
    classes, aps50, aps = [], [], []
    for name in present:
        positives, curve, ap = class_metrics(req.frames, name, .5)
        point = [p for p in curve if p['confidence'] >= req.confidence]
        tp = point[-1]['tp'] if point else 0
        fp = point[-1]['fp'] if point else 0
        precision, recall = tp/max(tp+fp, 1), tp/max(positives, 1)
        class_aps = [class_metrics(req.frames, name, float(t))[2] for t in np.arange(.5, 1, .05)]
        if ap is not None:
            aps50.append(ap)
            aps.extend(class_aps)
        classes.append({'name': name, 'ground_truth': positives, 'predicted': len(point), 'tp': tp, 'fp': fp, 'fn': positives-tp,
                        'precision': precision, 'recall': recall, 'f1': 2*precision*recall/max(precision+recall, 1e-12), 'ap50': ap, 'pr_curve': curve})
    labels = present + ['background']
    matrix = np.zeros((len(labels), len(labels)), dtype=int)
    for frame in req.frames:
        available = set(range(len(frame.ground_truth)))
        for pred in sorted([p for p in frame.predictions if p.confidence >= req.confidence], key=lambda d: -d.confidence):
            best, index = max([(iou(pred.bbox, frame.ground_truth[j].bbox), j) for j in available], default=(0, None))
            if best >= .5:
                matrix[labels.index(frame.ground_truth[index].class_name), labels.index(pred.class_name)] += 1
                available.remove(index)
            else:
                matrix[-1, labels.index(pred.class_name)] += 1
        for index in available:
            matrix[labels.index(frame.ground_truth[index].class_name), -1] += 1
    tp, fp, fn = (sum(c[key] for c in classes) for key in ('tp', 'fp', 'fn'))
    p, r = tp/max(tp+fp, 1), tp/max(tp+fn, 1)
    return {'provenance': 'user_supplied_evaluation', 'validated': False, 'images': len(ids), 'precision': p, 'recall': r,
            'f1': 2*p*r/max(p+r, 1e-12), 'map50': float(np.mean(aps50)) if aps50 else None,
            'map50_95': float(np.mean(aps)) if aps else None, 'classes': classes,
            'confusion_matrix': matrix.tolist(), 'labels': labels,
            'method': 'Class-aware confidence-ranked box IoU matching; 101-point interpolated AP; mAP at IoU 0.50:0.05:0.95. Confusion rows=truth, columns=prediction at IoU 0.5.',
            'notice': 'Calculated from submitted annotations; not an independently verified benchmark. Use held-out routes, complete annotations and predictions from the same detector. No segmentation mAP is computed.'}
