"""Evaluate/tune the provisional formula only with independently labelled 0–100 ratings.
No expert scores are generated from RDD boxes, counts or model confidence.
"""
import argparse
import hashlib
import json
from pathlib import Path
from app.features import decode_image
from app.integrated_detector import detect_defects
from app.road_quality_score import ScoreSettings, calculate, reference_metrics, categorical_metrics, settings


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest",type=Path)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--tune-configs",type=Path,help="JSON array of at most 20 candidate configurations. Validation-only; never test labels.")
    args=parser.parse_args()
    manifest=json.loads(args.manifest.read_text())
    source=manifest.get("label_source","")
    cases=manifest.get("cases",[])
    if len(source)<4 or not cases:parser.error("Supply an independent label_source and expert-rated cases.")
    splits={case.get("split") for case in cases}
    if not splits<={"validation","test"}:parser.error("Every case needs split: validation or test.")
    if args.tune_configs and (splits!={"validation"} or len(cases)<2):parser.error("Tuning requires at least two validation cases; test labels must stay untouched.")
    configs=[settings()[0]]
    if args.tune_configs:
        raw=json.loads(args.tune_configs.read_text())
        if not isinstance(raw,list) or not 1<=len(raw)<=20:parser.error("Use 1–20 candidate configurations.")
        configs=[ScoreSettings.model_validate(c) for c in raw]
    samples=[];seen=set()
    for case in cases:
        truth=case.get("expert_score")
        if truth is not None and (isinstance(truth,bool) or not isinstance(truth,(float,int)) or not 0<=truth<=100):parser.error("expert_score must be a finite number from 0–100.")
        label=case.get("expert_rating")
        if label is not None and label not in ("Excellent","Good","Fair","Poor","Critical"):parser.error("Unknown expert_rating.")
        if truth is None and label is None:parser.error("Provide an independent expert_score or expert_rating; never derive either from detections.")
        if args.tune_configs and truth is None:parser.error("MAE-based tuning requires numeric expert scores for every validation case.")
        path=(args.manifest.parent/case["image"]).resolve();data=path.read_bytes();digest=hashlib.sha256(data).hexdigest()
        if digest in seen:parser.error("Duplicate image bytes are not independent evaluation cases.")
        seen.add(digest)
        image=decode_image(data);detections=detect_defects(image,case.get("road_quad"))
        metadata={"width":image.shape[1],"height":image.shape[0],"sha256":digest,"source_file_unchanged":True,"quality":detections.get("quality",{})}
        samples.append((case,detections,metadata))
    candidates=[]
    for cfg in configs:
        outputs=[calculate(d,m,case.get("excluded_ids",()),cfg,"validation_candidate" if args.tune_configs else "frozen_evaluation_config") for case,d,m in samples]
        predictions=[o["score"] for o in outputs]
        report={"config":cfg.model_dump(),"metrics_by_split":{},"predictions":[{"image":case["image"],"sha256":meta["sha256"],"expert_score":case.get("expert_score"),"expert_rating":case.get("expert_rating"),"score":p,"split":case["split"]} for (case,_,meta),p in zip(samples,predictions)]}
        for split in sorted(splits):
            selected=[(p,case["expert_score"]) for (case,_,_),p in zip(samples,predictions) if case["split"]==split and case.get("expert_score") is not None]
            metrics=reference_metrics([p for p,t in selected],[t for p,t in selected]) if selected else {"n":0,"mae":None,"rmse":None,"pearson_r":None}
            categories=[(o["rating"],case["expert_rating"]) for (case,_,_),o in zip(samples,outputs) if case["split"]==split and case.get("expert_rating") is not None]
            metrics["categorical"]=categorical_metrics([p for p,t in categories],[t for p,t in categories])
            report["metrics_by_split"][split]=metrics
        candidates.append(report)
    best=min(candidates,key=lambda c:c["metrics_by_split"]["validation"]["mae"]) if args.tune_configs else candidates[0]
    output={"label_source":source,"labels_independently_audited":False,"population_validated":False,"score_status":"provisional",
            "tuned_on_validation_only":bool(args.tune_configs),"candidates":candidates,"selected_config":best["config"],
            "notice":"No model retraining or automatic activation. Expert label provenance, capture/route grouping, severity validity and out-of-sample performance must be reviewed before interpreting results."}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(output,indent=2))
    print(json.dumps(best["metrics_by_split"],indent=2))

if __name__=="__main__":main()
