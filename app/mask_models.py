"""Optional trusted local semantic ONNX masks via OpenCV DNN; no downloads or guessed class names."""
import json
import os
import threading
from pathlib import Path
import cv2
import numpy as np

_lock=threading.Lock()
_nets={}


def predict_mask(image,task):
    prefix="ROAD_HEALTH_"+task.upper()+"_MASK_"
    path=os.environ.get(prefix+"MODEL","").strip()
    if not path:return None,{"configured":False,"used":False,"reason":"No trained "+task+" segmentation model configured."}
    try:
        p=Path(path).expanduser()
        if not p.is_file() or p.suffix.lower()!=".onnx":raise ValueError("Set "+prefix+"MODEL to a trusted local ONNX segmentation file.")
        size=int(os.environ.get(prefix+"SIZE","512"))
        if not 128<=size<=1536:raise ValueError("Mask model input size must be 128–1536.")
        mean=np.asarray(json.loads(os.environ.get(prefix+"MEAN","[0,0,0]")),np.float32)
        std=np.asarray(json.loads(os.environ.get(prefix+"STD","[1,1,1]")),np.float32)
        if mean.shape!=(3,) or std.shape!=(3,) or not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std<=0):raise ValueError("Mask model mean/std must contain three finite RGB values with positive std.")
        class_id=int(os.environ.get(prefix+"CLASS","1"))
        output_mode=os.environ.get(prefix+"OUTPUT","logits")
        if output_mode not in ("logits","probabilities"):raise ValueError("Mask OUTPUT must be logits or probabilities.")
        h,w=image.shape[:2];scale=min(size/w,size/h);nw,nh=round(w*scale),round(h*scale)
        left,top=(size-nw)//2,(size-nh)//2
        canvas=np.zeros((size,size,3),np.uint8)
        canvas[top:top+nh,left:left+nw]=cv2.resize(image,(nw,nh),interpolation=cv2.INTER_AREA)
        rgb=cv2.cvtColor(canvas,cv2.COLOR_BGR2RGB).astype(np.float32)/255
        blob=((rgb-mean)/std).transpose(2,0,1)[None]
        key=(str(p.resolve()),p.stat().st_mtime_ns)
        with _lock:
            if key not in _nets:
                _nets.clear();_nets[key]=cv2.dnn.readNetFromONNX(str(p))
            net=_nets[key];net.setInput(blob);raw=np.asarray(net.forward())
        if not np.isfinite(raw).all():raise ValueError("Mask model returned nonfinite output.")
        if raw.ndim==4 and raw.shape[0]==1:raw=raw[0]
        if raw.ndim==3:
            if raw.shape[0]>256:raise ValueError("Expected channel-first segmentation output [1,C,H,W].")
            if raw.shape[0]==1:plane=raw[0]
            else:
                if not 0<=class_id<raw.shape[0]:raise ValueError("Configured road/chip class is outside the model output.")
                mask=(np.argmax(raw,axis=0)==class_id).astype(np.uint8)
                plane=None
        elif raw.ndim==2:plane=raw
        else:raise ValueError("Expected a dense segmentation mask, not object-detection boxes.")
        if plane is not None:
            probabilities=1/(1+np.exp(-np.clip(plane,-40,40))) if output_mode=="logits" else plane
            if np.any(probabilities<0) or np.any(probabilities>1):raise ValueError("Mask probabilities are outside [0,1].")
            mask=(probabilities>=.5).astype(np.uint8)
        # Undo the aspect-preserving letterbox before mapping to native coordinates.
        mask=cv2.resize(mask,(size,size),interpolation=cv2.INTER_NEAREST)[top:top+nh,left:left+nw]
        mask=cv2.resize(mask,(w,h),interpolation=cv2.INTER_NEAREST)
        return mask,{"configured":True,"used":True,"reason":"Local semantic segmentation; class/preprocessing are user configured. No accuracy validation is implied."}
    except (OSError,ValueError,TypeError,cv2.error) as exc:
        return None,{"configured":True,"used":False,"reason":"Local "+task+" model could not run: "+str(exc)[:250]+" OpenCV appearance analysis is used instead."}
