"""Image-derived road appearance proposal, with an optional semantic model and explicit review."""
import cv2
import numpy as np
from app.defects import FULL_QUAD,parse_quad
from app.mask_models import predict_mask


def _quad_from_mask(mask):
    h,w=mask.shape
    rows=np.flatnonzero(np.sum(mask>0,axis=1)>=max(4,w*.04))
    if len(rows)<8:return None
    y0,y1=int(np.percentile(rows,5)),int(rows[-1])
    if y1-y0<8:return None
    def span(y):
        strip=mask[max(0,y-2):min(h,y+3)]
        xx=np.flatnonzero(np.any(strip>0,axis=0))
        return (float(np.percentile(xx,2)),float(np.percentile(xx,98))) if len(xx)>3 else None
    a,b=span(y0),span(y1)
    if not a or not b:return None
    q=[[a[0]/(w-1),y0/(h-1)],[a[1]/(w-1),y0/(h-1)],[b[1]/(w-1),y1/(h-1)],[b[0]/(w-1),y1/(h-1)]]
    try:return parse_quad(q)
    except ValueError:return None


def identify_road(image,capture_type="road_scene",road_quad=None):
    h,w=image.shape[:2]
    def result(q,method,status,message,model=None,coverage=None,surface=None):
        return {"road_quad":[{"x":float(x),"y":float(y)} for x,y in q],"method":method,"status":status,
                "requires_review":method!="provided_outline","confidence":None,"confidence_calibrated":False,
                "image":{"width":w,"height":h},"message":message,"model":model,"appearance_fraction":coverage,"road_polygon":surface or [{"x":float(x),"y":float(y)} for x,y in q]}
    if road_quad is not None:
        return result(parse_quad(road_quad),"provided_outline","selected","The supplied road outline determines analysis. Correct it if it includes scenery.")
    if capture_type=="surface_crop":
        return result(FULL_QUAD,"declared_surface_crop","selected","Full road-only crop selected. A uniform mm/pixel scale is valid only if the image is already top-down or rectified.")
    scale=min(1.,640/max(h,w));small=cv2.resize(image,(round(w*scale),round(h*scale)),interpolation=cv2.INTER_AREA)
    sh,sw=small.shape[:2]
    mask,model=predict_mask(small,"road")
    method="semantic_road_mask"
    if mask is None:
        method="opencv_road_appearance"
        lab=cv2.cvtColor(cv2.bilateralFilter(small,5,25,25),cv2.COLOR_BGR2LAB).astype(np.float32)
        hsv=cv2.cvtColor(small,cv2.COLOR_BGR2HSV)
        # Bottom-center is a spatial seed assumption, not a semantic road label.
        seed=lab[round(sh*.74):round(sh*.96),round(sw*.25):round(sw*.75)]
        seed_hsv=hsv[round(sh*.74):round(sh*.96),round(sw*.25):round(sw*.75)]
        neutral=seed_hsv[:,:,1]<np.percentile(seed_hsv[:,:,1],65)+1
        values=seed[neutral]
        if not len(values):values=seed.reshape(-1,3)
        center=np.median(values,axis=0)
        spread=np.maximum(np.median(abs(values-center),axis=0)*1.4826,[18,5,5])
        delta=(lab-center)/spread
        # Luminance tolerance permits shadowed asphalt while chroma rejects foliage/sky.
        affinity=(delta[:,:,0]/3)**2+delta[:,:,1]**2+delta[:,:,2]**2
        # A conservative chroma neighbourhood prevents a narrow connection through
        # neutral tree trunks/sky from expanding the proposed road across scenery.
        mask=((affinity<3)&(hsv[:,:,1]<max(65,float(np.percentile(seed_hsv[:,:,1],85))+25))).astype(np.uint8)
        kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,kernel)
        mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,kernel)
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask.astype(np.uint8),8)
    chosen=0;best=0
    seed_area=np.zeros_like(mask);seed_area[round(sh*.74):round(sh*.98),round(sw*.25):round(sw*.75)]=1
    for i in range(1,count):
        overlap=int(np.count_nonzero((labels==i)&(seed_area>0)))
        if overlap>best:best=overlap;chosen=i
    mask=(labels==chosen).astype(np.uint8) if chosen else np.zeros_like(mask)
    area=float(mask.mean());gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
    # Road/scenery can share luminance yet have strong chromatic boundaries.
    # Check colour detail as well as brightness before discarding the mask.
    colour_detail=cv2.cvtColor(small,cv2.COLOR_BGR2LAB).reshape(-1,3).std(axis=0).max()
    if area<.06 or (gray.std()<2 and colour_detail<2) or np.mean(gray<5)>.95 or np.mean(gray>250)>.95:
        return result(FULL_QUAD,method,"needs_outline","A reliable road boundary could not be separated from this capture. Outline the road manually; use a sharper, evenly lit image with visible road edges.",model,area)
    q=_quad_from_mask(mask)
    if q is None:return result(FULL_QUAD,method,"needs_outline","The candidate surface is too narrow or fragmented. Adjust the road outline before interpreting the results.",model,area)
    # A nearly full-frame neutral texture can be a road close-up or a non-road object.
    note="Road appearance proposed from actual pixels. Confirm the outline: neutral walls, vehicles, shadows and gravel can be confused with asphalt. This is not validated semantic recognition."
    if method=="semantic_road_mask":note="The configured model proposed a road mask. Its four-corner approximation must be reviewed; depth and uniform scale are not inferred."
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    hull=cv2.convexHull(max(contours,key=cv2.contourArea))
    hull=cv2.approxPolyDP(hull,max(1,min(sw,sh)*.003),True).reshape(-1,2).astype(float)/[sw-1,sh-1]
    surface=[{'x':float(x),'y':float(y)} for x,y in hull]
    x0,y0=hull.min(axis=0);x1,y1=hull.max(axis=0)
    q=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]
    note+=' Analysis follows the full road-shaped boundary, including visible side areas. The four handles define a schematic plane; editing switches to a manual four-corner boundary.'
    return result(q,method,"review_required",note,model,area,surface)
