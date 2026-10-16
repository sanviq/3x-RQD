"""Provisional, auditable defect-area index. Never a calibrated engineering condition grade."""
import copy
import hashlib
import json
import math
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from starlette.concurrency import run_in_threadpool
from app.defects import parse_quad, FULL_QUAD
from app.detection import image_quality

router=APIRouter()
KINDS=("Pothole","Crack","Depression","Uneven surface")
_snapshots={}
_cache_lock=threading.Lock()
_compute_lock=threading.Lock()
TTL=1800
MAX_SNAPSHOTS=24

class Safe(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False,validate_default=True)

class TypeWeights(Safe):
    pothole:float=Field(1.4,ge=.01,le=4)
    crack:float=Field(.7,ge=.01,le=4)
    depression:float=Field(1.,ge=.01,le=4)
    uneven_surface:float=Field(.65,ge=.01,le=4)

class ScoreSettings(Safe):
    type_weights:TypeWeights=Field(default_factory=TypeWeights)
    area_scale:float=Field(350.,gt=0,le=10000)
    area_cap:float=Field(70.,ge=0,le=100)
    hotspot_scale:float=Field(30.,ge=0,le=1000)
    hotspot_cap:float=Field(20.,ge=0,le=100)
    spread_cap:float=Field(10.,ge=0,le=100)
    spread_reference:float=Field(.08,gt=0,le=1)
    confidence_power:float=Field(2.,ge=1,le=4)
    severity_floor:float=Field(.2,ge=0,le=1)
    severity_discount:float=Field(.85,ge=0,le=1)
    opencv_discount:float=Field(.6,ge=0,le=1)
    model_discount:float=Field(.85,ge=0,le=1)
    box_discount:float=Field(.6,ge=0,le=1)
    artifact_discount:float=Field(.65,ge=0,le=1)
    central_corridor_boost:float=Field(.25,ge=0,le=1)
    excellent:float=Field(90,gt=0,le=100)
    good:float=Field(75,gt=0,le=100)
    fair:float=Field(55,gt=0,le=100)
    poor:float=Field(35,gt=0,le=100)

    @model_validator(mode="after")
    def ordered(self):
        if not self.poor<self.fair<self.good<self.excellent:
            raise ValueError("Rating thresholds must increase: Poor < Fair < Good < Excellent.")
        if self.area_cap+self.hotspot_cap+self.spread_cap>100.000001:
            raise ValueError("Penalty caps must sum to at most 100 points.")
        return self


def settings():
    path=os.environ.get("ROAD_HEALTH_SCORE_CONFIG","")
    if not path:return ScoreSettings(),"untuned_defaults"
    try:return ScoreSettings.model_validate_json(Path(path).read_text()),"server_config_file"
    except (ValueError,OSError) as exc:raise ValueError("Invalid ROAD_HEALTH_SCORE_CONFIG: "+str(exc)[:250]) from exc


def rating(score,cfg):
    for label,minimum in (("Excellent",cfg.excellent),("Good",cfg.good),("Fair",cfg.fair),("Poor",cfg.poor)):
        if score>=minimum:return label
    return "Critical"


def _geometry(points,w,h):
    p=np.asarray([[v["x"],v["y"]] if isinstance(v,dict) else v for v in points],np.float64)
    if p.ndim!=2 or p.shape[1]!=2 or len(p)<3 or not np.isfinite(p).all() or np.any(p<0) or np.any(p>1):
        raise ValueError("Score geometry must use finite normalized original-image coordinates.")
    return np.rint(p*[w-1,h-1]).astype(np.int32)


def _cells(road,quad):
    """Twelve disjoint cells in the declared road plane; no metric geometry is inferred."""
    h,w=road.shape;matrix=cv2.getPerspectiveTransform(np.asarray(quad,np.float32),np.asarray(FULL_QUAD,np.float32))
    cells=np.full((h,w),-1,np.int8)
    xx=np.arange(w,dtype=np.float32)[None,:]/max(1,w-1)
    chunk=max(1,min(128,500_000//w))
    for start in range(0,h,chunk):
        end=min(h,start+chunk);yy=np.arange(start,end,dtype=np.float32)[:,None]/max(1,h-1)
        z=matrix[2,0]*xx+matrix[2,1]*yy+matrix[2,2]
        z=np.where(abs(z)<1e-10,1e-10,z)
        u=(matrix[0,0]*xx+matrix[0,1]*yy+matrix[0,2])/z
        v=(matrix[1,0]*xx+matrix[1,1]*yy+matrix[1,2])/z
        ids=np.clip(np.floor(v*4),0,3).astype(np.int8)*3+np.clip(np.floor(u*3),0,2).astype(np.int8)
        cells[start:end]=np.where(road[start:end]>0,ids,-1)
    return cells,matrix


def calculate(detection,metadata,excluded=(),cfg=None,config_source="untuned_defaults"):
    cfg=cfg or ScoreSettings()
    with _compute_lock:
        return _calculate(detection,metadata,excluded,cfg,config_source)


def _calculate(detection,metadata,excluded,cfg,config_source):
    h,w=int(detection["image"]["height"]),int(detection["image"]["width"])
    if min(w,h)<64 or w*h>20_000_000:raise ValueError("Unsupported native score raster dimensions.")
    quad=parse_quad(detection["road_quad"])
    road=np.zeros((h,w),np.uint8);cv2.fillPoly(road,[_geometry(quad,w,h)],255)
    area=int(np.count_nonzero(road))
    if area<64:raise ValueError("Align a larger visible road area before scoring (at least 64 native pixels).")
    ids=[d["id"] for d in detection["defects"]]
    if len(set(ids))!=len(ids):raise ValueError("Detection IDs must be unique.")
    excluded=set(excluded)
    if excluded-set(ids):raise ValueError("Excluded IDs do not belong to this detection snapshot.")
    active=[d for d in detection["defects"] if d["id"] not in excluded]
    cells,matrix=_cells(road,quad)
    risk=np.zeros((h,w),np.float32);owner=np.full((h,w),-1,np.int16);union=np.zeros((h,w),np.uint8)
    weights=dict(zip(KINDS,cfg.type_weights.model_dump().values()))
    rows=[]
    for i,d in enumerate(active):
        if d["kind"] not in weights:raise ValueError("Unsupported score defect type.")
        confidence=float(d["confidence"]);severity=float(d["severity"])
        if not all(math.isfinite(v) and 0<=v<=1 for v in (confidence,severity)):raise ValueError("Nonfinite or out-of-range detection evidence.")
        polygon=_geometry(d["polygon"],w,h);x,y,bw,bh=cv2.boundingRect(polygon)
        mask=np.zeros((bh,bw),np.uint8);cv2.fillPoly(mask,[polygon-[x,y]],255)
        mask=cv2.bitwise_and(mask,road[y:y+bh,x:x+bw]);inside=mask>0
        pixel_area=int(np.count_nonzero(inside));union[y:y+bh,x:x+bw][inside]=255
        normalized=polygon.astype(np.float32)/[w-1,h-1]
        moment=cv2.moments(normalized.astype(np.float32))
        center=np.asarray([[moment["m10"]/moment["m00"],moment["m01"]/moment["m00"]] if moment["m00"] else normalized.mean(axis=0)],np.float32)
        location=cv2.perspectiveTransform(center.reshape(-1,1,2),matrix).reshape(-1,2)[0]
        u,v=np.clip(location,0,1)
        location_multiplier=1+cfg.central_corridor_boost*max(0,1-2*abs(float(u)-.5))
        box=d.get("geometry_source")=="bounding_box_schematic"
        source_discount=cfg.opencv_discount if d["provenance"]=="opencv_candidate" else cfg.model_discount
        ambiguous=any(word in d.get("appearance","").lower() for word in ("water","glare","reflection","shadow"))
        artifact=cfg.artifact_discount if ambiguous else 1.
        evidence_multiplier=confidence**cfg.confidence_power*source_discount*cfg.severity_discount*(cfg.box_discount if box else 1.)*artifact
        intensity=weights[d["kind"]]*(cfg.severity_floor+(1-cfg.severity_floor)*severity)*evidence_multiplier*location_multiplier
        view=risk[y:y+bh,x:x+bw];own=owner[y:y+bh,x:x+bw]
        replace=inside&(intensity>view);view[replace]=intensity;own[replace]=i
        rows.append({"id":d["id"],"kind":d["kind"],"severity":severity,"confidence":confidence,
                     "severity_label":"High" if severity>=.67 else "Moderate" if severity>=.34 else "Low",
                     "candidate_pixel_area":pixel_area,"candidate_road_percent":pixel_area/area*100,
                     "type_weight":weights[d["kind"]],"road_position":{"u":float(u),"v":float(v)},
                     "location_multiplier":location_multiplier,"evidence_multiplier":evidence_multiplier,
                     "geometry":"bounding_box_estimate" if box else "candidate_contour",
                     "polygon_original_normalized":copy.deepcopy(d["polygon"]),
                     "artifact_ambiguous":ambiguous,"weighted_intensity":intensity})
    n=len(rows)
    def contributions(selection):
        selected_owner=owner[selection];selected_risk=risk[selection]
        valid=selected_owner>=0
        return np.bincount(selected_owner[valid],weights=selected_risk[valid],minlength=n).astype(float) if n else np.zeros(0)
    contributions_all=contributions(road>0);total_risk=float(contributions_all.sum());load=total_risk/area
    area_penalty=min(cfg.area_cap,cfg.area_scale*load)
    attributed=contributions_all/total_risk*area_penalty if total_risk else np.zeros(n)
    cell_rows=[];cell_contributions=[]
    for k in range(12):
        mask=cells==k;size=int(np.count_nonzero(mask))
        c=contributions(mask);s=float(c.sum());density=s/size if size else 0.
        cell_rows.append({"id":k,"row":k//3,"column":k%3,"road_pixels":size,"weighted_load":density,
                          "candidate_area_percent":np.count_nonzero(union[mask])/size*100 if size else 0.})
        cell_contributions.append(c)
    valid_cells=[k for k,c in enumerate(cell_rows) if c["road_pixels"]]
    worst=max(valid_cells,key=lambda k:cell_rows[k]["weighted_load"])
    hotspot_penalty=min(cfg.hotspot_cap,cfg.hotspot_scale*cell_rows[worst]["weighted_load"])
    c=cell_contributions[worst];s=float(c.sum())
    if s:attributed+=c/s*hotspot_penalty
    spread=0.
    for k in valid_cells:
        penalty=cfg.spread_cap/len(valid_cells)*(1-math.exp(-cell_rows[k]["weighted_load"]/cfg.spread_reference))
        spread+=penalty;c=cell_contributions[k];s=float(c.sum())
        if s:attributed+=c/s*penalty
    native_owner_counts=np.bincount(owner[owner>=0],minlength=n) if n else []
    for i,row in enumerate(rows):
        row.update(owned_pixel_area=int(native_owner_counts[i]),deduction_points=round(float(attributed[i]),6))
    components=[{"id":"area","label":"Severity-weighted affected area","points":area_penalty},
                {"id":"hotspot","label":"Strongest local concentration","points":hotspot_penalty},
                {"id":"distribution","label":"Damage spread across the road","points":spread}]
    deduction=sum(c["points"] for c in components);score=round(max(0.,min(100.,100-deduction)),1)
    union_area=int(np.count_nonzero(union));settings_dict=cfg.model_dump()
    reasons=["No expert-labelled road-quality scores are available; weights and rating thresholds are untuned priors.",
             "Severity is an unvalidated visual estimate. True depth, physical extent and engineering condition are not measured.",
             "Confidence discounts penalties but is not road quality or a calibrated probability. Lower confidence can raise this index without proving a better road.",
             "Road content and the visible road outline are user-declared, not semantically verified.",
             "Only visible detections are scored; missed/obscured damage, drainage, friction and subsurface condition are unknown.",
             "Areas are native-image pixel regions inside the user-declared road outline, not physical areas. Different framing/perspective can change this score.",
             "Location uses an assumed central travel corridor and a planar 3×4 grid; actual lane positions are not known."]
    if detection["method"]=="opencv_multiscale_contours":reasons.insert(0,"No trained detector is active: OpenCV appearance candidates require manual review and can be false positives.")
    if any(d["geometry"]=="bounding_box_estimate" for d in rows):reasons.append("Detection boxes overestimate damaged area; a configurable geometry discount is applied.")
    not_assessed=["Depression","Uneven surface"] if detection["method"]=="yolo_rdd_detection" else []
    if not_assessed:reasons.append("The active RDD detector does not assess depressions or uneven patches; those counts are unavailable, not proven zero.")
    if not rows:reasons.insert(0,"No retained defects: 100 is the formula's zero-penalty value, not proof of an Excellent road.")
    if rows and total_risk==0:reasons.insert(0,"No positive weighted defect evidence: 100 is the formula offset, not evidence of an Excellent road.")
    if len(detection["defects"])>=80:reasons.append("Detector output reached its 80-region cap; additional defects may have been omitted.")
    return {"version":"road-quality-v1","status":"provisional","validated":False,"score":score,"rating":rating(score,cfg),
            "score_is_model_confidence":False,"score_scope":"Observed defect-area index; not an engineering road-condition grade",
            "image":metadata,"excluded_ids":sorted(excluded),"config":settings_dict,"config_source":config_source,
            "config_sha256":hashlib.sha256(json.dumps(settings_dict,sort_keys=True).encode()).hexdigest(),
            "road_quad":quad,"deduction_points":deduction,"components":components,"defects":rows,"cells":cell_rows,
            "summary":{"detected_count":len(ids),"included_count":len(rows),"excluded_count":len(excluded),
                       "by_type":{kind:None if kind in not_assessed else sum(d["kind"]==kind for d in rows) for kind in KINDS},"not_assessed_types":not_assessed,
                       "by_severity":{kind:sum(d["severity_label"]==kind for d in rows) for kind in ("Low","Moderate","High")},
                       "visible_road_pixel_area":area,"affected_pixel_area":union_area,"affected_road_percent":union_area/area*100,
                       "weighted_load":load,"worst_cell":worst,"unique_penalized_pixels":int(np.count_nonzero(risk))},
            "uncertainty":reasons,"validation":{"available":False,"n":0,"mae":None,"pearson_r":None,"reason":"No independent expert 0–100 road ratings provided. RDD defect-box labels are not condition scores."},
            "generated_at":datetime.now(timezone.utc).isoformat()}


def _cleanup():
    now=time.monotonic()
    for token in list(_snapshots):
        if now-_snapshots[token]["created"]>TTL:del _snapshots[token]


def attach_score(result,image,data):
    """Attach to the actual detection response; never accept client-created defect outputs."""
    try:
        cfg,source=settings()
        metadata={"width":image.shape[1],"height":image.shape[0],"sha256":hashlib.sha256(data).hexdigest(),
                  "source_file_unchanged":True,"coordinate_system":"EXIF-oriented original pixels","quality":result.get("quality") or image_quality(image)}
        token=secrets.token_urlsafe(24)
        value=calculate(result,metadata,(),cfg,source);value["snapshot_id"]=token
        with _cache_lock:
            _cleanup()
            while len(_snapshots)>=MAX_SNAPSHOTS:del _snapshots[min(_snapshots,key=lambda k:_snapshots[k]["created"])]
            _snapshots[token]={"detection":copy.deepcopy(result),"metadata":metadata,"created":time.monotonic(),"config":cfg.model_dump(),"config_source":source}
        return {**result,"road_quality_score":value,"score_token":token,"score_expires_seconds":TTL}
    except ValueError as exc:
        return {**result,"road_quality_score":None,"score_error":str(exc)[:500]}


def snapshot(token):
    with _cache_lock:
        _cleanup();record=_snapshots.get(token)
        if record is None:raise HTTPException(410,"Score evidence expired or the API restarted. Detect again to refresh it.")
        return record

class Rescore(Safe):
    score_token:str=Field(min_length=20,max_length=80,pattern=r"^[A-Za-z0-9_-]+$")
    excluded_ids:list[str]=Field(default_factory=list,max_length=80)
    config:ScoreSettings|None=None

    @field_validator("excluded_ids")
    @classmethod
    def unique_ids(cls,value):
        if len(value)!=len(set(value)) or any(not 1<=len(v)<=80 for v in value):raise ValueError("Excluded IDs must be unique and at most 80 characters each.")
        return value

@router.get("/road-quality-score/config")
def configuration():
    try:
        cfg,source=settings()
        return {"version":"road-quality-v1","config":cfg.model_dump(),"source":source,"calibrated":False}
    except ValueError as exc:raise HTTPException(503,str(exc)) from exc

@router.post("/road-quality-score")
async def rescore(request:Rescore):
    record=snapshot(request.score_token)
    try:
        cfg,source=(request.config,"request_override") if request.config else (ScoreSettings.model_validate(record["config"]),record["config_source"])
        value=await run_in_threadpool(calculate,record["detection"],record["metadata"],request.excluded_ids,cfg,source)
        return {**value,"snapshot_id":request.score_token}
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc


def reference_metrics(predictions,truth):
    a=np.asarray(predictions,float);b=np.asarray(truth,float)
    if a.ndim!=1 or b.ndim!=1 or len(a)!=len(b) or not len(a) or not np.isfinite(a).all() or not np.isfinite(b).all() or np.any(a<0) or np.any(a>100) or np.any(b<0) or np.any(b>100):raise ValueError("Provide finite paired reference scores.")
    correlation=float(np.corrcoef(a,b)[0,1]) if len(a)>1 and a.std()>1e-12 and b.std()>1e-12 else None
    return {"n":len(a),"mae":float(np.mean(abs(a-b))),"rmse":float(np.sqrt(np.mean((a-b)**2))),"pearson_r":correlation}

def categorical_metrics(predictions,truth):
    labels=("Excellent","Good","Fair","Poor","Critical")
    if len(predictions)!=len(truth) or any(v not in labels for v in list(predictions)+list(truth)):raise ValueError("Unknown expert rating.")
    return {"n":len(truth),"rating_agreement":sum(a==b for a,b in zip(predictions,truth))/len(truth) if truth else None,
            "confusion_matrix":{actual:{predicted:sum(a==actual and p==predicted for p,a in zip(predictions,truth)) for predicted in labels} for actual in labels}}

class Reference(Rescore):
    expert_score:float|None=Field(None,ge=0,le=100)
    expert_rating:Literal["Excellent","Good","Fair","Poor","Critical"]|None=None

    @field_validator("expert_score",mode="before")
    @classmethod
    def numeric_reference(cls,value):
        if isinstance(value,bool):raise ValueError("A boolean is not an expert road-quality score.")
        return value

    @model_validator(mode="after")
    def has_reference(self):
        if self.expert_score is None and self.expert_rating is None:raise ValueError("Provide an independently labelled numeric score or rating.")
        return self

class Evaluation(Safe):
    cases:list[Reference]=Field(min_length=1,max_length=24)
    label_source:str=Field(min_length=4,max_length=500)
    split:str=Field(pattern=r"^(validation|test)$")

@router.post("/road-quality-score/evaluate")
async def evaluate(request:Evaluation):
    records=[snapshot(c.score_token) for c in request.cases]
    if len({r["metadata"]["sha256"] for r in records})!=len(records):raise HTTPException(422,"Use each source image only once in an evaluation.")
    outputs=[]
    try:
        cfg,source=settings()
        for case,record in zip(request.cases,records):
            if case.config is not None:raise ValueError("Per-image tuning is not a fair evaluation. Use one server configuration.")
            outputs.append(await run_in_threadpool(calculate,record["detection"],record["metadata"],case.excluded_ids,cfg,source))
        numeric=[(o["score"],c.expert_score) for o,c in zip(outputs,request.cases) if c.expert_score is not None]
        categorical=[(o["rating"],c.expert_rating) for o,c in zip(outputs,request.cases) if c.expert_rating is not None]
        metrics=reference_metrics([p for p,t in numeric],[t for p,t in numeric]) if numeric else {"n":0,"mae":None,"rmse":None,"pearson_r":None}
        return {"metrics":metrics,"categorical":categorical_metrics([p for p,t in categorical],[t for p,t in categorical]),"config":cfg.model_dump(),
                "label_source":request.label_source,"split":request.split,"labels_verified":False,"score_validated":False,
                "notice":"Agreement with user-supplied reference labels; label provenance and population validity have not been independently verified. Never tune on test labels.",
                "predictions":[{"sha256":o["image"]["sha256"],"score":o["score"],"rating":o["rating"],"expert_score":c.expert_score,"expert_rating":c.expert_rating} for o,c in zip(outputs,request.cases)]}
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc
