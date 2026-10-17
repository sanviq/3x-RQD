"""Optional local YOLO inference, explicit fixtures, bounded tracking, diagnostic overlays."""
import base64
import hashlib
import os
import threading
import time
from pathlib import Path

import cv2
import numpy as np

from app.assessment import Defect, CLASSES, assess, Inclination, mask_for
from app.model_registry import selected_model

MODEL_PATH = os.environ.get('ROAD_HEALTH_MODEL', '')
_model = None
_loaded_path = None
_lock = threading.Lock()
ALIASES = {'potholes': 'pothole', 'longitudinal_crack': 'crack', 'transverse_crack': 'crack',
           'alligator_crack': 'crack', 'patch': 'repair_patch', 'raveling': 'ravelling',
           'd00': 'crack', 'd10': 'crack', 'd20': 'crack', 'd40': 'pothole',
           'surface_wear':'ravelling','depression':'uneven_surface','patches':'repair_patch',
           'loose_stones': 'loose_chips', 'loose_rock_chips': 'loose_chips', 'metal': 'metallic_debris'}
RDD_LABELS = {'D00': 'Longitudinal crack', 'D10': 'Transverse crack',
              'D20': 'Alligator crack', 'D40': 'Pothole'}
RDD_CODES = {**{c.lower(): c for c in RDD_LABELS}, 'longitudinal_crack': 'D00',
             'transverse_crack': 'D10', 'alligator_crack': 'D20', 'pothole': 'D40', 'potholes':'D40'}


def model_status():
    selection=selected_model(MODEL_PATH,allow_experimental=True)
    known_rdd=selection.get('source') in ('interactive_experimental_preview','evaluated_local_registry')
    if _model is not None and _loaded_path==selection.get('path'):
        raw=[str(n).lower().replace(' ','_').replace('-','_') for n in _model.names.values()]
        supported=sorted({ALIASES.get(n,n) for n in raw if ALIASES.get(n,n) in CLASSES})
        codes=sorted({RDD_CODES[n] for n in raw if n in RDD_CODES})
    else:
        supported=['crack','pothole'] if known_rdd else []
        codes=list(RDD_LABELS) if known_rdd else []
    return {**{k:v for k,v in selection.items() if k!='path'},
            'automatic_detection_configured':selected_model(MODEL_PATH)['configured'],
            'loaded': _model is not None, 'mode': 'model' if selection['configured'] else 'demo',
            'requires': 'Trusted road-specific YOLO detection/segmentation weights and requirements-model.txt. Generic COCO weights do not recognize road-defect classes.',
            'supported_classes':supported,'supported_detection_codes':codes,'adapter_classes':CLASSES}


def encode(image):
    ok, data = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise ValueError('Could not encode image.')
    return 'data:image/jpeg;base64,' + base64.b64encode(data).decode()


def demo_defects(seed=1):
    rng = np.random.default_rng(seed)
    prototypes = [
        ('pothole', [.18,.53,.39,.77], .94, .9),
        ('crack', [.55,.15,.61,.56], .87, .65),
        ('ravelling', [.62,.63,.88,.88], .78, .7),
        ('repair_patch', [.11,.18,.31,.36], .91, .25),
        ('loose_chips', [.42,.71,.56,.89], .68, .48),
        ('metallic_debris', [.76,.35,.80,.40], .53, .55)]
    result = []
    for index, (name, box, conf, severity) in enumerate(prototypes):
        box = np.clip(np.array(box) + rng.uniform(-.025, .025, 4), .03, .97)
        x1,y1,x2,y2 = box.tolist()
        polygon = [(x1+(x2-x1)*.18,y1), (x1+(x2-x1)*.8,y1+(y2-y1)*.05),
                   (x2,y1+(y2-y1)*.5), (x1+(x2-x1)*.76,y2),
                   (x1+(x2-x1)*.12,y1+(y2-y1)*.87), (x1,y1+(y2-y1)*.3)]
        result.append(Defect(id=f'demo-{index+1}', class_name=name, bbox=(x1,y1,x2,y2),
                             polygon=polygon, confidence=conf, severity=severity))
    return result


def survey_defects(seed=1):
    """The exact synthetic annotations shared by route scores, evidence, and viewers."""
    i = seed - 1
    ds = demo_defects(seed)
    if i in (0, 1, 6, 10):
        ds = ds[3:4]
    elif i in (2, 5, 8):
        ds = ds[:3]
    elif i in (4, 9):
        ds += [d.model_copy(update={'id': f'extra-{j}', 'severity': 1.0}) for j, d in enumerate(ds[:3])]
    for d in ds:
        d.severity = min(1, d.severity*(.65 + i%4*.22))
    return ds


def demo_image(seed=1, defects=None):
    rng = np.random.default_rng(seed)
    gray = np.clip(rng.normal(95, 10, (640,960)), 0,255).astype(np.uint8)
    image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    cv2.line(image, (55,0),(55,640),(190,195,185),8)
    cv2.line(image, (905,0),(905,640),(190,195,185),8)
    for y in range(0,640,160):
        cv2.line(image,(480,y),(480,y+80),(160,180,190),7)
    for d in (demo_defects(seed) if defects is None else defects):
        pts = (np.array(d.polygon)*[960,640]).astype(np.int32)
        color = {'pothole':(28,29,30),'crack':(25,28,29),'ravelling':(68,73,79),
                 'repair_patch':(62,64,65),'loose_chips':(122,130,136),'metallic_debris':(200,205,210)}[d.class_name]
        cv2.fillPoly(image,[pts],color)
        if d.class_name == 'pothole':
            cv2.polylines(image,[pts],True,(115,113,106),5)
        if d.class_name in ('ravelling','loose_chips'):
            for _ in range(200):
                x,y = rng.integers(pts[:,0].min(),pts[:,0].max()),rng.integers(pts[:,1].min(),pts[:,1].max())
                cv2.circle(image,(int(x),int(y)),int(rng.integers(1,4)),(145,147,143),-1)
    return image


def image_quality(image):
    gray = cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
    lap = float(cv2.Laplacian(gray,cv2.CV_64F).var())
    bright, dark = float(np.mean(gray>245)), float(np.mean(gray<25))
    cells = [float(c.mean()) for row in np.array_split(gray,4) for c in np.array_split(row,4,axis=1)]
    flags = []
    if lap < 45: flags.append('Blurry or low-detail image')
    if bright > .18: flags.append('Overexposure / glare')
    if dark > .35 or gray.mean()<45: flags.append('Low light / heavy shadow')
    if max(cells)-min(cells)>130: flags.append('Uneven illumination / possible shadow')
    return {'laplacian_variance':round(lap,2), 'overexposed_fraction':round(bright,3),
            'dark_fraction':round(dark,3), 'flags':flags, 'repeat_capture':bool(flags),
            'method':'Image-quality heuristics; suitability is not guaranteed by passing checks.'}


def predict(image, mode='demo', confidence=.35, resolution=640, seed=1):
    global _model, _loaded_path
    if mode == 'demo':
        return [d for d in demo_defects(seed) if d.confidence>=confidence]
    selection=selected_model(MODEL_PATH,allow_experimental=True)
    if not selection['configured']:
        raise ValueError('No trained road-defect model configured. Use Demo or set ROAD_HEALTH_MODEL and install requirements-model.txt.')
    with _lock:
        if _model is None or _loaded_path != selection['path']:
            try:
                from ultralytics import YOLO
            except ImportError as exc:
                raise ValueError('Install requirements-model.txt to enable YOLO inference.') from exc
            _model = YOLO(selection['path'])
            _loaded_path = selection['path']
        prediction = _model.predict(image, conf=confidence, imgsz=resolution, device='cpu', verbose=False, max_det=100)[0]
        h,w = image.shape[:2]
        defects=[]
        if prediction.boxes is None:
            return []
        unknown=set()
        for i, box in enumerate(prediction.boxes):
            raw = str(prediction.names[int(box.cls.item())]).lower().replace(' ','_').replace('-','_')
            code = RDD_CODES.get(raw)
            name = ALIASES.get(raw,raw)
            if name not in CLASSES:
                unknown.add(raw)
                continue
            coords = box.xyxy[0].cpu().numpy()/[w,h,w,h]
            coords=np.clip(coords,0,1)
            if coords[0]>=coords[2] or coords[1]>=coords[3]: continue
            polygon=[]
            if prediction.masks is not None and i<len(prediction.masks.xy):
                points=np.clip(prediction.masks.xy[i]/[w,h],0,1)
                # Bound response size without inventing masks when absent.
                polygon=[tuple(map(float,p)) for p in points[::max(1,len(points)//1000)]]
            area=(coords[2]-coords[0])*(coords[3]-coords[1])
            severity=float(np.clip(.3+area*4+(0.2 if name=='pothole' else 0),.15,1))
            if name=='repair_patch': severity=.2
            defects.append(Defect(id=f'defect-{i+1}',class_name=name,confidence=float(box.conf.item()),
                                  detection_code=code, detection_label=RDD_LABELS.get(code, raw),
                                  bbox=tuple(coords),polygon=polygon,severity=severity))
        if unknown:
            raise ValueError('Unsupported model classes: '+', '.join(sorted(unknown))+'. Configure road-specific weights or extend ALIASES in app/detection.py.')
        return defects


def iou(a,b):
    x1,y1,x2,y2=max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])
    intersection=max(0,x2-x1)*max(0,y2-y1)
    return intersection/max(1e-12,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection)


class Tracker:
    """Session-local greedy class-aware IoU association, with short occlusion retention."""
    def __init__(self):
        self.tracks={}
        self.next_id=1
        self.frame=0
        self.seen=set()

    def update(self, defects):
        self.frame+=1
        if len(self.seen) >= 10000:
            raise ValueError('Tracking session reached 10,000 unique tracks. Start a new inspection session.')
        self.tracks={k:v for k,v in self.tracks.items() if self.frame-v[2]<=8}
        available=set(self.tracks)
        for d in defects:
            track_class=d.detection_code or d.class_name
            candidates=[(iou(d.bbox,self.tracks[k][0]),k) for k in available if self.tracks[k][1]==track_class]
            best=max(candidates,default=(0,None))
            if best[0]>.25:
                track=best[1]
                available.remove(track)
            else:
                track=self.next_id
                self.next_id+=1
            d.track_id=track
            d.id=f'track-{track}'
            self.tracks[track]=(d.bbox,track_class,self.frame)
            self.seen.add(track)
        return defects


def visuals(image, defects):
    h,w=image.shape[:2]
    boxes=image.copy()
    segmentation=image.copy()
    severity=np.zeros((h,w),np.float32)
    for d in defects:
        color=(45,80,235) if d.severity>=.7 else (40,190,245) if d.severity>=.4 else (100,195,75)
        mask=cv2.resize(mask_for(d), (w,h),interpolation=cv2.INTER_NEAREST).astype(bool)
        segmentation[mask]=(np.array(color)*.6+segmentation[mask]*.4).astype(np.uint8)
        severity[mask]=np.maximum(severity[mask],d.severity)
        x1,y1,x2,y2=[int(v*s) for v,s in zip(d.bbox,[w,h,w,h])]
        cv2.rectangle(boxes,(x1,y1),(x2,y2),color,2)
        cv2.putText(boxes,f'{d.detection_code or d.class_name} {d.confidence:.0%}',(x1,max(15,y1-7)),cv2.FONT_HERSHEY_SIMPLEX,.5,color,1,cv2.LINE_AA)
    heat=np.zeros_like(image)
    heat[:]=(85,160,45)
    heat[(severity>=.4)&(severity<.7)]=(20,210,245)
    heat[severity>=.7]=(35,45,230)
    heat=cv2.addWeighted(image,.5,heat,.5,0)
    previews={}
    for d in defects:
        x1,y1,x2,y2=[int(v*s) for v,s in zip(d.bbox,[w,h,w,h])]
        crop=image[max(0,y1):max(y1+1,y2),max(0,x1):max(x1+1,x2)]
        if crop.size:
            crop=cv2.resize(crop,(min(200,max(32,x2-x1)),min(160,max(32,y2-y1))))
            previews[d.id]=encode(crop)
    return {'original':encode(image),'detections':encode(boxes),'segmentation':encode(segmentation),
            'heatmap':encode(heat),'previews':previews}


def inspect(image, mode='demo', confidence=.35, resolution=640, mm_per_pixel=None,
            inclination=None, seed=1, tracker=None, effect='none', strength=.5, config=None, fixture_defects=None, source_data=None):
    started=time.perf_counter()
    if mode=='opencv':
        from app.defects import detect_defects
        from app.road_region import identify_road
        from app.road_quality_score import settings
        from app.inspection_evidence import render_snapshot
        source=stress_image(image,effect,strength)
        detect_started=time.perf_counter()
        region=identify_road(source)
        candidates=detect_defects(source,region['road_quad'],road_polygon=region['road_polygon'])
        inference_ms=(time.perf_counter()-detect_started)*1000
        ok,encoded=cv2.imencode('.png',source)
        if not ok:raise ValueError('Could not prepare OpenCV inspection evidence.')
        data=source_data if source_data is not None and effect=='none' else encoded.tobytes()
        cfg,config_source=settings()
        record={'detection':candidates,'config':cfg.model_dump(),'config_source':config_source,
                'metadata':{'width':source.shape[1],'height':source.shape[0],'sha256':hashlib.sha256(data).hexdigest(),
                            'source_file_unchanged':effect=='none','coordinate_system':'EXIF-oriented original pixels','quality':image_quality(source)}}
        # Video/camera frames must not evict the user's signed still-image snapshot.
        result=render_snapshot(source,record,[],mm_per_pixel,inclination,tracker=tracker)
        result['notice']='OpenCV visual candidates from the uploaded pixels, using the same road-boundary and provisional scoring pipeline as the main inspection. Not trained YOLO predictions; review false positives and missed damage.'
        if not candidates['defects'] or result['quality']['repeat_capture']:
            result['assessment']['candidate_score']=result['assessment']['score']
            result['assessment'].update(score=None,band='Unassessable',evidence_status='insufficient')
        elapsed=(time.perf_counter()-started)*1000
        result.update(effect=effect,synthetic_stress_test=effect!='none',road_polygon=candidates['road_polygon'])
        result['timing']={'inference_ms':round(inference_ms,2),'pipeline_ms':round(elapsed,2),'pipeline_fps':round(1000/max(elapsed,.001),2),
                          'includes':'OpenCV road appearance, candidate extraction, shared scoring and previews; excludes transport. OpenCV uses its fixed 1024 px maximum side, preserving aspect ratio.'}
        return result
    original_h,original_w=image.shape[:2]
    scale=min(1,resolution/max(original_h,original_w))
    image=cv2.resize(image,(max(1,round(original_w*scale)),max(1,round(original_h*scale))),interpolation=cv2.INTER_AREA)
    image=stress_image(image,effect,strength)
    detect_started=time.perf_counter()
    defects=[d.model_copy(deep=True) for d in fixture_defects if d.confidence >= confidence] if mode=='demo' and fixture_defects is not None else predict(image,mode,confidence,resolution,seed)
    inference_ms=(time.perf_counter()-detect_started)*1000
    if tracker: defects=tracker.update(defects)
    assessment=assess(defects,original_w,original_h,mm_per_pixel,inclination,config)
    quality=image_quality(image)
    insufficient = mode == 'model' and (not defects or assessment['average_confidence'] < .6)
    assessment['evidence_status'] = 'insufficient' if insufficient else 'demo' if mode == 'demo' else 'detections_available'
    if quality['repeat_capture'] or insufficient:
        assessment['candidate_score'] = assessment['score']
        assessment['score'] = None
        assessment['band'] = 'Unassessable'
        if insufficient:
            assessment['explanation'] = 'Insufficient detection evidence: no detections or low mean detection confidence. This does not establish a healthy road. Repeat capture and review model coverage. ' + assessment['explanation']
    if mode == 'model':
        assessment['candidate_score'] = assessment.get('candidate_score',assessment['score'])
        assessment['score'] = None
        assessment['band'] = 'Unassessable'
        assessment['limitations'].append('Detection training does not validate a road-health formula. Candidate score is an unvalidated heuristic; an engineering health grade is withheld.')
        assessment['limitations'].append('RDD2022 covers four damage types only. Undetected ravelling, roughness, patches and material condition are not established as absent. Confidence measures detection certainty, not road quality.')
    images=visuals(image,defects)
    elapsed=(time.perf_counter()-started)*1000
    return {'provenance':'demo' if mode=='demo' else 'model',
            'notice': 'Illustrative fixture annotations; NOT detections from this image. Confidence values are synthetic and stay fixed during stress tests.' if mode=='demo' else 'Model predictions; severity is an unvalidated image-space estimate. Inspect and verify findings.',
            'assessment':assessment,'quality':quality,'images':images,
            'width':original_w,'height':original_h,'processed_width':image.shape[1],'processed_height':image.shape[0],
            'timing':{'inference_ms':round(inference_ms,2),'pipeline_ms':round(elapsed,2),
                      'pipeline_fps':round(1000/max(elapsed,.001),2),'includes':'resize, stress, prediction, assessment, overlays and JPEG encoding; excludes transport'},
            'unique_tracks':len(tracker.seen) if tracker else len(defects),
            'assessment_confidence':None if mode=='demo' else assessment['average_confidence'],
            'repeat_capture':quality['repeat_capture'] or (mode=='model' and (assessment['average_confidence'] is None or assessment['average_confidence']<.6)),
            'effect':effect,'synthetic_stress_test':effect!='none'}


def stress_image(image,effect,strength):
    if effect=='none': return image
    output=image.astype(np.float32)
    h,w=image.shape[:2]
    if effect=='low_light': output*=1-.85*strength
    elif effect=='brightness': output+=strength*120
    elif effect=='shadow':
        mask=np.zeros((h,w),np.uint8)
        cv2.fillPoly(mask,[np.array([[0,0],[int(w*.3),0],[w,int(h*.8)],[w,h],[int(w*.5),h]])],1)
        output[mask>0]*=1-.85*strength
    elif effect=='glare':
        yy,xx=np.mgrid[:h,:w]
        glow=np.exp(-((xx-w*.65)**2+(yy-h*.35)**2)/(max(w,h)*.22)**2)
        output+=glow[:,:,None]*strength*255
    elif effect=='blur':
        size=3+int(strength*24)//2*2
        output=cv2.GaussianBlur(output,(size,size),0)
    elif effect=='perspective':
        offset=w*.25*strength
        src=np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]])
        dst=np.float32([[offset,0],[w-1-offset,0],[w-1,h-1],[0,h-1]])
        output=cv2.warpPerspective(output,cv2.getPerspectiveTransform(src,dst),(w,h))
    elif effect=='rain':
        rng=np.random.default_rng(42)
        output*=1-.25*strength
        for _ in range(int(600*strength)):
            x,y=int(rng.integers(w)),int(rng.integers(h))
            cv2.line(output,(x,y),(x-4,min(h-1,y+14)),(180,190,195),1)
    else: raise ValueError('Unsupported stress effect.')
    return np.clip(output,0,255).astype(np.uint8)
