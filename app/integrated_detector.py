"""Adapt road-trained YOLO boxes to the existing teammate inspection/drive contract."""
import time
import cv2
import numpy as np
from app.defects import detect_defects as opencv_candidates, parse_quad, FULL_QUAD
from app import detection
from app.model_registry import selected_model


def detect_defects(image, road_quad=None, confidence=None, resolution=None):
    selection=selected_model(detection.MODEL_PATH)
    if not selection['configured']:
        result=opencv_candidates(image,road_quad)
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
    homography=cv2.getPerspectiveTransform(q,np.asarray(FULL_QUAD,np.float32))
    items=[]
    for d in defects[:80]:
        x1,y1,x2,y2=d.bbox
        rectangle=np.asarray([[x1,y1],[x2,y1],[x2,y2],[x1,y2]],np.float32)
        area,clipped=cv2.intersectConvexConvex(rectangle,q)
        if clipped is None or area<=0:continue
        polygon=clipped.reshape(-1,2)
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
                      'provenance':'yolo_prediction','geometry_source':'bounding_box_schematic',
                      'depth_mm':None,'physical_dimensions':None,
                      'appearance':'RDD2022 model prediction; bounding rectangle clipped to the user-selected road footprint.',
                      'evidence':{'detection_code':d.detection_code,'detection_label':d.detection_label}})
    quality=detection.image_quality(image)
    return {'version':'rdd-yolo-v2','method':'yolo_rdd_detection',
            'coordinate_system':'normalized_exif_oriented_original',
            'road_quad':[{'x':float(x),'y':float(y)} for x,y in q],
            'image':{'width':w,'height':h},'defects':items,
            'confidence_calibrated':False,'requires_review':True,'model_status':detection.model_status(),
            'evidence_status':'detections_available' if items and not quality['repeat_capture'] else 'insufficient',
            'quality':quality,'road_health_score':None,'inference_ms':round((time.perf_counter()-start)*1000,2),
            'warnings':['YOLO predictions require human review. Detection confidence is not road quality.',
                        'Only D00, D10, D20 and D40 are supported; other damage is not established as absent.',
                        'Outlines and area are bounding-box geometry, not segmentation masks or measured damaged area.',
                        'Depth, physical severity and driving response remain simulation assumptions.',
                        'No detections does not establish a healthy road.']+quality['flags']}
