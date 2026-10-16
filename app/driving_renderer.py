"""Small CPU 3D renderer for reproducible synthetic car-mounted camera frames.

Horizontal dimensions and vertical deformations are assumed scene geometry, never
survey measurements. Visible defect polygons are projected into each camera frame.
"""
import math
import cv2
import numpy as np
from app.assessment import Defect

WIDTH, HEIGHT = 800, 450
ROAD_WIDTH, ROAD_LENGTH = 7.0, 80.0


def camera_position(progress, lateral, curve):
    # Both runs use this exact trajectory. Positive curve bends the path to the right.
    lane = float(np.clip(lateral + curve * math.sin(math.pi * progress), .04, .96))
    return lane, progress * (ROAD_LENGTH - 8) - 8


def render_frame(defects: list[Defect], progress, lateral=.3, curve=0, camera_height=1.4):
    lane, camera_z = camera_position(progress, lateral, curve)
    camera_x = (lane - .5) * ROAD_WIDTH
    focal, center_y = 620., HEIGHT * .28

    def project_polygon(points):
        points = [[x-camera_x, y, z-camera_z] for x,y,z in points]
        # Clip the 3D polygon against the near plane before perspective division.
        clipped=[]
        for i,a in enumerate(points):
            b=points[(i+1)%len(points)]
            if a[2] >= .7: clipped.append(a)
            if (a[2]>=.7)!=(b[2]>=.7):
                t=(.7-a[2])/(b[2]-a[2])
                clipped.append([a[j]+t*(b[j]-a[j]) for j in range(3)])
        if len(clipped)<3: return None
        pts=np.array([[WIDTH/2+focal*x/z, center_y+focal*(camera_height-y)/z] for x,y,z in clipped],np.float32)
        # OpenCV clips polygon fills; clip the projected annotation polygon to the viewport too.
        for axis,bound,keep_greater in ((0,0,True),(0,WIDTH-1,False),(1,0,True),(1,HEIGHT-1,False)):
            output=[]
            if len(pts)<3: return None
            for i,a in enumerate(pts):
                b=pts[(i+1)%len(pts)]
                ina=a[axis]>=bound if keep_greater else a[axis]<=bound
                inb=b[axis]>=bound if keep_greater else b[axis]<=bound
                if ina: output.append(a)
                if ina!=inb:
                    t=(bound-a[axis])/(b[axis]-a[axis])
                    output.append(a+t*(b-a))
            pts=np.asarray(output,np.float32)
        return pts if len(pts)>=3 else None

    image=np.zeros((HEIGHT,WIDTH,3),np.uint8)
    for row in range(HEIGHT):
        t=row/HEIGHT
        image[row,:]=(210-int(t*38),205-int(t*25),185-int(t*20)) if row<center_y else (103,130,108)
    rng=np.random.default_rng(24)
    # Render front-to-back ordered road grid and roadside verges in world coordinates.
    def paint(points,color,outline=None):
        p=project_polygon(points)
        if p is not None:
            poly=p.astype(np.int32)
            cv2.fillPoly(image,[poly],color,cv2.LINE_AA)
            if outline: cv2.polylines(image,[poly],True,outline,1,cv2.LINE_AA)
        return p
    for z in reversed(range(0,90,2)):
        for x in range(-4,4):
            left,right=max(-3.5,x),min(3.5,x+1)
            if left>=right: continue
            shade=81+int(rng.integers(-5,6))
            paint([(left,0,z),(right,0,z),(right,0,z+2),(left,0,z+2)],(shade,shade+3,shade+2))
    for side in (-1,1):
        x=side*3.2
        paint([(x-.035,.004,0),(x+.035,.004,0),(x+.035,.004,90),(x-.035,.004,90)],(205,217,215))
    for z in range(0,90,6):
        paint([(-.04,.005,z),(.04,.005,z),(.04,.005,z+3),(-.04,.005,z+3)],(175,205,218))
    visible=[]
    for d in sorted(defects,key=lambda d:d.bbox[1]):
        x1,y1,x2,y2=d.bbox
        polygon=d.polygon or [(x1,y1),(x2,y1),(x2,y2),(x1,y2)]
        # Image top maps to the far end of the schematic road.
        world=[((x-.5)*ROAD_WIDTH,0,(1-y)*ROAD_LENGTH) for x,y in polygon]
        colors={'pothole':(32,34,35),'crack':(27,28,29),'repair_patch':(65,72,68),
                'ravelling':(97,104,109),'loose_chips':(126,132,138),
                'uneven_surface':(106,114,109),'metallic_debris':(190,199,203),'other':(65,73,76)}
        pts=paint(world,colors[d.class_name],(48,54,55))
        if pts is None or cv2.contourArea(pts)<9: continue
        if d.class_name=='pothole':
            # Schematic cavity floor (no measured depth is implied).
            center=np.mean(np.array(world),axis=0)
            floor=[(center[0]+(x-center[0])*.72,-(.025+d.severity*.12),center[2]+(z-center[2])*.72) for x,_,z in world]
            paint(floor,(21,24,26))
        if d.class_name=='uneven_surface':
            ridge=[(x,.025+d.severity*.12,z) for x,_,z in world]
            paint(ridge,(118,124,115),(135,140,128))
        if d.class_name in ('ravelling','loose_chips'):
            local=np.zeros((HEIGHT,WIDTH),np.uint8)
            cv2.fillPoly(local,[pts.astype(np.int32)],255)
            pixels=np.argwhere(local>0)
            if len(pixels):
                for index in rng.choice(len(pixels),min(120,len(pixels)),replace=False):
                    y,x=pixels[index];cv2.circle(image,(int(x),int(y)),1,(158,163,154),-1)
        norm=pts/np.array([WIDTH,HEIGHT])
        box=(*norm.min(0),*norm.max(0))
        if box[2]-box[0]<.002 or box[3]-box[1]<.002: continue
        visible.append(Defect(**{**d.model_dump(),'bbox':tuple(float(v) for v in box),
                                  'polygon':[tuple(map(float,p)) for p in norm],
                                  'depth_mm':None,'depth_source':None}))
    # A hood locates the camera on the car, rather than suggesting a drone frame.
    cv2.fillPoly(image,[np.array([[125,HEIGHT],[190,HEIGHT-31],[610,HEIGHT-31],[675,HEIGHT]])],(108,119,125),cv2.LINE_AA)
    cv2.line(image,(200,HEIGHT-24),(600,HEIGHT-24),(151,161,163),2,cv2.LINE_AA)
    cv2.putText(image,'SYNTHETIC CAR CAMERA  |  SCHEMATIC DEPTH',(18,27),cv2.FONT_HERSHEY_SIMPLEX,.45,(245,245,238),1,cv2.LINE_AA)
    return image,visible,{'lateral_fraction':round(lane,4),'distance_m':round(max(0,camera_z+8),3),
                          'camera_height_m':camera_height,'geometry':'assumed_7m_by_80m_road'}
