"""Render one immutable detection snapshot across inspection and OpenCV workbench views."""
import time
import cv2
from app.assessment import Defect, Inclination, assess
from app.detection import visuals, encode
from app.road_quality_score import calculate, ScoreSettings


def render_snapshot(source, record, excluded=None, mm_per_pixel=None, inclination=None, score_token=None, tracker=None):
    start=time.perf_counter()
    if excluded is None:excluded=[]
    if not isinstance(excluded,list) or len(excluded)!=len(set(excluded)):raise ValueError('Excluded IDs must be a unique list.')
    scored=calculate(record['detection'],record['metadata'],excluded,ScoreSettings.model_validate(record['config']),record['config_source'])
    ds=[];mapping={'Pothole':'pothole','Crack':'crack','Depression':'uneven_surface','Uneven surface':'uneven_surface'}
    for d in record['detection']['defects']:
        if d['id'] in excluded:continue
        p=[(v['x'],v['y']) for v in d['polygon']];xs,ys=zip(*p)
        ds.append(Defect(id=d['id'],class_name=mapping[d['kind']],detection_label=d.get('detection_label') or d['kind'],
            detection_code=d.get('detection_code'),confidence=d['confidence'],severity=d['severity'],
            bbox=(min(xs),min(ys),max(xs),max(ys)),polygon=p))
    if tracker:ds=tracker.update(ds)
    h,w=source.shape[:2];assessment=assess(ds,w,h,mm_per_pixel,inclination or Inclination())
    assessment.update(score=scored['score'],band=scored['rating'],scoring_method='road-quality-v1',
        damaged_area_percent=round(scored['summary']['affected_road_percent'],2),
        density_per_megapixel=round(len(ds)/(scored['summary']['visible_road_pixel_area']/1e6),2),
        penalties={c['id']:c['points'] for c in scored['components']},
        explanation='Same selected detection snapshot and provisional score as the main inspection. '+scored['score_scope'],
        limitations=scored['uncertainty'])
    for d in assessment['defects']:d['area_method']='approximate_visual_candidate_polygon'
    scale=min(1.,1600/max(w,h));display=cv2.resize(source,(round(w*scale),round(h*scale))) if scale<1 else source
    images=visuals(display,ds)
    from app.defects import defect_overlay
    outlines=[{**d,'id':tracked.id} for d,tracked in zip([d for d in record['detection']['defects'] if d['id'] not in excluded],ds)]
    images['detections']=encode(defect_overlay(display,{'defects':outlines}))
    elapsed=(time.perf_counter()-start)*1000
    return {'provenance':'opencv' if record['detection']['method']=='opencv_multiscale_contours' else 'model',
        'notice':'Shared inspection evidence: same retained IDs, outlines and provisional score as above. No second detector was run. Shapes are visual estimates, not measured depth or validated segmentation.',
        'assessment':assessment,'quality':record['metadata']['quality'],'images':images,
        'width':w,'height':h,'processed_width':display.shape[1],'processed_height':display.shape[0],
        'timing':{'inference_ms':0,'pipeline_ms':round(elapsed,2),'pipeline_fps':round(1000/max(elapsed,.001),2),'includes':'Reuse selected evidence; assessment and preview preparation. No model inference.'},
        'unique_tracks':len(tracker.seen) if tracker else len(ds),'assessment_confidence':assessment['average_confidence'],'repeat_capture':record['metadata']['quality']['repeat_capture'],
        'effect':'none','synthetic_stress_test':False,'source_snapshot':score_token,'retained_ids':[d.id for d in ds]}
