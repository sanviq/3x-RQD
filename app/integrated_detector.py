"""Adapt road-trained YOLO boxes to the existing teammate inspection/drive contract."""
import time
import cv2
import numpy as np
from app.defects import detect_defects as opencv_candidates, parse_quad, FULL_QUAD
from app import detection
from app.model_registry import selected_model


def _unique_defects(defects):
    """Suppress duplicate boxes per RDD class, retaining the strongest prediction."""
    kept=[]
    for defect in sorted(defects,key=lambda d:-d.confidence):
        if any((defect.detection_code or defect.class_name)==(other.detection_code or other.class_name)
               and detection.iou(defect.bbox,other.bbox)>.5 for other in kept):
            continue
        kept.append(defect)
    return kept


def _detect_defects(image, road_quad=None, confidence=None, resolution=None, mode='auto',road_polygon=None):
    if mode not in ('auto','model','opencv'):
        raise ValueError('Choose auto, model or opencv detection.')
    selection=selected_model(detection.MODEL_PATH,allow_experimental=True) if mode=='model' else selected_model(detection.MODEL_PATH)
    if mode=='opencv':
        return opencv_candidates(image,road_quad,road_polygon=road_polygon)
    if not selection['configured']:
        if mode=='model':
            raise ValueError('No trained road detector is available. Configure the saved experimental checkpoint or choose Untrained visual candidates.')
        result=opencv_candidates(image,road_quad,road_polygon=road_polygon)
        result['model_status']=detection.model_status()
        result['warnings'].append('No accepted trained detector is active. These are OpenCV candidates, not YOLO predictions.')
        return result
    q=np.asarray(parse_quad(road_quad),np.float32)
    h,w=image.shape[:2];start=time.perf_counter()
    confidence=selection['confidence'] if confidence is None else confidence
    resolution=selection['imgsz'] if resolution is None else resolution
    defects=detection.predict(image,'model',confidence,resolution)
    if any(d.detection_code not in detection.RDD_LABELS for d in defects):
        raise ValueError('The driving adapter requires a four-class RDD2022 detector; other classes must not be silently mapped to cracks.')
    raw_count=len(defects)
    defects=_unique_defects(defects)
    homography=cv2.getPerspectiveTransform(q,np.asarray(FULL_QUAD,np.float32))
    items=[]
    for d in defects[:80]:
        x1,y1,x2,y2=d.bbox
        rectangle=np.asarray([[x1,y1],[x2,y1],[x2,y2],[x1,y2]],np.float32)
        source=np.asarray(d.polygon,np.float32) if len(d.polygon)>=3 else rectangle
        is_mask=len(d.polygon)>=3
        if cv2.isContourConvex(source.reshape(-1,1,2)):
            area,clipped=cv2.intersectConvexConvex(source,q)
        else:
            # Raster clipping retains concave model masks; never replace them with their bounding box.
            rw,rh=max(64,min(w,1536)),max(64,min(h,1536))
            mask=np.zeros((rh,rw),np.uint8);roi=mask.copy()
            cv2.fillPoly(mask,[np.rint(source*[rw-1,rh-1]).astype(np.int32)],255)
            cv2.fillConvexPoly(roi,np.rint(q*[rw-1,rh-1]).astype(np.int32),255)
            contours,_=cv2.findContours(cv2.bitwise_and(mask,roi),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            best=max(contours,key=cv2.contourArea) if contours else None
            clipped=cv2.approxPolyDP(best,max(1.,min(rw,rh)*.001),True).astype(np.float32)/[rw-1,rh-1] if best is not None else None
            area=cv2.contourArea(clipped.astype(np.float32)) if clipped is not None else 0
        if clipped is None or area<=0:continue
        polygon=clipped.reshape(-1,2).astype(np.float32)
        road=np.clip(cv2.perspectiveTransform(polygon.reshape(-1,1,2),homography).reshape(-1,2),0,1)
        severity=d.severity
        items.append({'id':d.id,'kind':'Pothole' if d.class_name=='pothole' else 'Crack',
                      'detection_code':d.detection_code,'detection_label':d.detection_label,
                      'confidence':d.confidence,'severity':severity,
                      'severity_label':'High' if severity>=.67 else 'Moderate' if severity>=.34 else 'Low',
                      'polygon':[{'x':float(x),'y':float(y)} for x,y in polygon],
                      'road_polygon':[{'x':float(x),'y':float(y)} for x,y in road],
                      'bbox':{'x':round(x1*w),'y':round(y1*h),'width':round((x2-x1)*w),'height':round((y2-y1)*h)},
                      'bbox_normalized':{'x':x1,'y':y1,'width':x2-x1,'height':y2-y1},
                      'area_fraction':min(1.,abs(float(cv2.contourArea(road)))),
                      'provenance':'yolo_prediction','geometry_source':'model_segmentation' if is_mask else 'bounding_box_schematic',
                      'depth_mm':None,'physical_dimensions':None,
                      'appearance':'RDD2022 model segmentation clipped to the road outline.' if is_mask else 'RDD2022 model prediction; bounding rectangle clipped to the user-selected road footprint.',
                      'evidence':{'detection_code':d.detection_code,'detection_label':d.detection_label}})
    quality=detection.image_quality(image)
    return {'version':'rdd-yolo-v2','method':'yolo_rdd_detection',
            'coordinate_system':'normalized_exif_oriented_original',
            'road_quad':[{'x':float(x),'y':float(y)} for x,y in q],
            'image':{'width':w,'height':h},'defects':items,
            'confidence_calibrated':False,'requires_review':True,'model_status':detection.model_status(),
            'settings':{'mode':mode,'confidence':confidence,'resolution':resolution},
            'postprocessing':{'method':'same_rdd_class_nms','iou_threshold':.5,'duplicates_removed':raw_count-len(defects)},
            'class_coverage':{'Pothole':'trained','Crack':'trained','Depression':'not_trained','Uneven surface':'not_trained'},
            'evidence_status':'detections_available' if items and not quality['repeat_capture'] else 'insufficient',
            'quality':quality,'road_health_score':None,'inference_ms':round((time.perf_counter()-start)*1000,2),
            'warnings':['YOLO predictions require human review. Detection confidence is not road quality.',
                        'Overlapping boxes of the same RDD class are suppressed at IoU 0.50. This preview filter was checked on validation; it has no new held-out accuracy claim.',
                        'Only D00, D10, D20 and D40 are supported; other damage is not established as absent.',
                        'Geometry source is recorded per defect: supplied model masks retain their contours; box-only detections use schematic rectangles. Neither establishes measured physical damage area.',
                        'Depth, physical severity and driving response remain simulation assumptions.',
                        'No detections does not establish a healthy road.']+quality['flags']}


def detect_defects(image,road_quad=None,confidence=None,resolution=None,mode='auto',road_polygon=None):
    try:
        return _detect_defects(image,road_quad,confidence,resolution,mode,road_polygon)
    except (ValueError,RuntimeError,OSError,ImportError,AttributeError,cv2.error) as exc:
        if mode=='model':
            raise ValueError('Trained detector could not run: '+str(exc)[:250]) from exc
        # A broken optional model must not discard valid surface measurements.
        result=opencv_candidates(image,road_quad,road_polygon=road_polygon)
        result['model_failure']={'type':type(exc).__name__,'message':str(exc)[:250],'fallback':'opencv_multiscale_contours'}
        result['warnings'].append('Road model could not run: '+str(exc)[:250]+'. Actual OpenCV candidates are shown; check the weights, dependencies and supported classes.')
        return result
