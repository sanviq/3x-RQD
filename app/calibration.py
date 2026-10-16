"""Explicit scale uncertainty and reference-based metrology checks, never invented accuracy."""
from collections import defaultdict
import math
import numpy as np
from fastapi import APIRouter
from pydantic import Field, model_validator
from app.assessment import SafeModel
from typing import Literal

router=APIRouter()
PARAMETER_UNITS={'chip_diameter':'mm','chip_gap':'mm','area':'m2','density':'count/m2','pitch':'degrees','roll':'degrees','defect_width':'mm','defect_length':'mm','depth':'mm'}


def calibration_metadata(physical,scale,uncertainty_percent=None):
    result={'source':'user_supplied_uniform_scale' if scale is not None else 'unavailable',
            'mm_per_original_pixel':scale,'scale_uncertainty_percent':uncertainty_percent if scale is not None else None,
            'validated':False,'bounds':{},
            'notice':'Physical units depend on a user-supplied uniform scale on a rectified road-only crop. Bounds propagate scale uncertainty only; segmentation, perspective, lens distortion and annotation errors are not included. No verified measurement accuracy is claimed.'}
    powers={'area_sq_ft':2,'chip_candidates_per_sq_ft':-2,'mean_chip_diameter_mm':1,'mean_chip_gap_mm_proxy':1}
    for key,value in physical.items():
        if value is None or scale is None or uncertainty_percent is None:result['bounds'][key]=None;continue
        u=uncertainty_percent/100;power=powers[key]
        ends=[value*(1-u)**power,value*(1+u)**power]
        result['bounds'][key]={'lower':min(ends),'upper':max(ends)}
    return result


class ReferencePair(SafeModel):
    sample_id:str=Field(min_length=1,max_length=100)
    parameter:Literal['chip_diameter','chip_gap','area','density','pitch','roll','defect_width','defect_length','depth']
    predicted:float=Field(ge=-1e12,le=1e12)
    measured:float=Field(ge=-1e12,le=1e12)
    unit:str=Field(max_length=20)

    @model_validator(mode='after')
    def valid_values(self):
        if not all(math.isfinite(v) for v in (self.predicted,self.measured)):raise ValueError('Values must be finite')
        if self.unit!=PARAMETER_UNITS[self.parameter]:raise ValueError('Expected unit '+PARAMETER_UNITS[self.parameter])
        if self.parameter not in ('pitch','roll') and min(self.predicted,self.measured)<0:raise ValueError('Sizes and densities cannot be negative')
        if self.parameter in ('pitch','roll') and max(abs(self.predicted),abs(self.measured))>90:raise ValueError('Angles must be between -90 and 90 degrees')
        return self


class ReferenceEvaluation(SafeModel):
    source_description:str=Field(min_length=3,max_length=500)
    held_out:bool=False
    pairs:list[ReferencePair]=Field(min_length=1,max_length=2000)


@router.post('/calibration/evaluate')
def evaluate_references(req:ReferenceEvaluation):
    keys=[(p.sample_id,p.parameter) for p in req.pairs]
    if len(keys)!=len(set(keys)):
        from fastapi import HTTPException
        raise HTTPException(422,'Each sample/parameter pair must be unique.')
    grouped=defaultdict(list)
    for p in req.pairs:grouped[p.parameter].append(p)
    rows=[]
    for name,pairs in sorted(grouped.items()):
        errors=np.asarray([p.predicted-p.measured for p in pairs]);absolute=np.abs(errors)
        relative=[abs(p.predicted-p.measured)/abs(p.measured)*100 for p in pairs if p.measured!=0]
        rows.append({'parameter':name,'unit':PARAMETER_UNITS[name],'samples':len(pairs),
                     'mean_absolute_error':float(absolute.mean()),'root_mean_squared_error':float(np.sqrt(np.mean(errors**2))),
                     'mean_bias':float(errors.mean()),'median_absolute_error':float(np.median(absolute)),
                     'p90_absolute_error':float(np.quantile(absolute,.9)),
                     'mean_absolute_percent_error':float(np.mean(relative)) if relative else None,
                     'nonzero_reference_count':len(relative),'excluded_zero_references':len(pairs)-len(relative)})
    return {'provenance':'calculated_from_user_supplied_references','validated':False,
            'held_out':req.held_out,'source_description':req.source_description,'parameters':rows,
            'notice':'Calculated errors, not independent certification. Held-out status is user-declared. Use separate samples with traceable measurements and matching geometry; do not evaluate on calibration-fit samples. Different units are never combined into one accuracy percentage. Relative error excludes zero references and is unsuitable for interpreting angles near zero. Depth predictions require depth sensors or validated reconstruction; assumed simulation depth is not a measurement.'}
