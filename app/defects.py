"""Untrained, review-required road-defect candidates from image evidence.

No metric depth, material identity, engineering severity or calibrated probability is inferred.
Coordinates refer to the EXIF-oriented original. A user-declared planar road footprint supplies
the homography; its dimensions remain assumptions. OpenCV black-hat/contours are documented at
https://docs.opencv.org/4.x/d3/dbe/tutorial_opening_closing_hats.html .
"""
import json

import cv2
import numpy as np

DETECTOR_VERSION = "opencv-candidates-v2"
FULL_QUAD = [[0., 0.], [1., 0.], [1., 1.], [0., 1.]]
COLORS = {"Pothole": (56, 87, 231), "Crack": (206, 111, 142),
          "Depression": (61, 167, 236), "Uneven surface": (187, 153, 64)}


def parse_quad(value):
    if value is None:
        return FULL_QUAD
    try:
        points = json.loads(value) if isinstance(value, str) else value
        q = np.array([[p["x"], p["y"]] if isinstance(p, dict) else p for p in points], np.float32)
        if q.shape != (4, 2) or not np.isfinite(q).all() or np.any(q < 0) or np.any(q > 1):
            raise ValueError()
        edges = np.roll(q, -1, axis=0) - q
        crosses = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
        if np.any(crosses <= .0005):
            raise ValueError()
        return q.tolist()
    except (ValueError, TypeError, KeyError, IndexError):
        raise ValueError("road_quad must contain four convex clockwise normalized image points.") from None


def parse_surface_polygon(value,default):
    if value is None:return parse_quad(default)
    try:
        pts=json.loads(value) if isinstance(value,str) else value
        p=np.asarray([[v['x'],v['y']] if isinstance(v,dict) else v for v in pts],np.float32)
        if p.ndim!=2 or p.shape[1]!=2 or not 3<=len(p)<=64 or not np.isfinite(p).all() or np.any(p<0) or np.any(p>1):raise ValueError()
        if not cv2.isContourConvex(p.reshape(-1,1,2)) or abs(cv2.contourArea(p))<.0005:raise ValueError()
        return p.tolist()
    except (ValueError,TypeError,KeyError,IndexError):raise ValueError('Road surface polygon must have 3–64 convex normalized points.') from None


def _overlap(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    intersection = max(0, x1-x0) * max(0, y1-y0)
    return intersection / max(1, min(a[2]*a[3], b[2]*b[3]))


def _candidate_overlap(a,b):
    """Use actual outlined regions: overlapping boxes need not be the same hole."""
    ax,ay,aw,ah=a['_rect'];bx,by,bw,bh=b['_rect']
    x,y=max(ax,bx),max(ay,by);right,bottom=min(ax+aw,bx+bw),min(ay+ah,by+bh)
    if right<=x or bottom<=y:return 0.
    left=np.zeros((bottom-y,right-x),np.uint8);right_mask=np.zeros_like(left)
    cv2.fillPoly(left,[a['_contour']-[x,y]],1)
    cv2.fillPoly(right_mask,[b['_contour']-[x,y]],1)
    return np.count_nonzero(left&right_mask)/max(1,min(cv2.contourArea(a['_contour']),cv2.contourArea(b['_contour'])))


def detect_defects(image, road_quad=None, *, native_resolution=False, road_polygon=None):
    q = np.asarray(parse_quad(road_quad), np.float32)
    oh, ow = image.shape[:2]
    scale = 1. if native_resolution else min(1., 1024/max(ow, oh))
    w, h = round(ow*scale), round(oh*scale)
    frame = image.copy() if native_resolution else cv2.resize(image, (w, h), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    smooth = cv2.GaussianBlur(gray, (3, 3), 0)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    coverage=np.asarray(parse_surface_polygon(road_polygon,q),np.float32)
    polygon = np.round(coverage * [w-1, h-1]).astype(np.int32)
    roi = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(roi, polygon, 255)
    # A small inset excludes road/vegetation borders and incomplete image-edge candidates.
    interior = cv2.erode(roi, np.ones((5, 5), np.uint8))
    region = gray[interior > 0]
    notes = [
        "OpenCV visual candidates require review: shadows, puddles, patches and joints can resemble defects.",
        "Confidence is an uncalibrated evidence score, not a probability of correct classification.",
        "Severity describes visible area/contrast only. Depth and suspension forces cannot be measured from this 2D image.",
        "Road footprint and planar perspective are assumptions. Align the outline before interpreting relative distances.",
    ]
    result = {"version": DETECTOR_VERSION, "method": "opencv_multiscale_contours",
              "coordinate_system": "normalized_exif_oriented_original",
              "road_quad": [{"x": float(x), "y": float(y)} for x, y in q],
              "image": {"width": ow, "height": oh}, "road_polygon":[{"x":float(x),"y":float(y)} for x,y in coverage], "defects": [], "warnings": notes,
              "confidence_calibrated": False, "requires_review": True}
    if len(region) < 64 or float(region.std()) < 5 or cv2.Laplacian(smooth, cv2.CV_32F).var() < 4:
        result["warnings"].append("Insufficient visual detail: no defect candidates returned.")
        return result

    minimum = min(w, h)
    enhancement = None
    if region.mean()<65 or region.std()<18:
        enhanced=cv2.createCLAHE(clipLimit=2.0,tileGridSize=(8,8)).apply(smooth)
        enhancement="CLAHE for low illumination/contrast; geometry remains in original coordinates"
    else:
        enhanced=smooth
    result["preprocessing"]=enhancement or "Original luminance with mild smoothing"
    responses = []
    for fraction in (.035, .08, .16):
        size = max(9, int(minimum*fraction) | 1)
        responses.append(cv2.morphologyEx(enhanced, cv2.MORPH_BLACKHAT,
                         cv2.getStructuringElement(cv2.MORPH_RECT if native_resolution and size>121 else cv2.MORPH_ELLIPSE, (size, size))))
    blackhat = np.maximum.reduce(responses)
    local = cv2.GaussianBlur(smooth, (0, 0), max(3, minimum*.035)).astype(np.float32)
    dark = local - smooth.astype(np.float32)
    threshold = max(13., float(np.percentile(blackhat[interior > 0], 78)))
    evidence = ((blackhat > threshold) | (dark > max(11., region.std()*.30))).astype(np.uint8)*255
    evidence[interior == 0] = 0
    # Reject chromatic foliage/paint; neutral shadows still need human review.
    evidence[hsv[:, :, 1] > 125] = 0
    close_size = max(3, int(minimum*.012) | 1)
    closed = cv2.morphologyEx(evidence, cv2.MORPH_CLOSE, np.ones((close_size, close_size), np.uint8))
    closed = cv2.morphologyEx(closed, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Thin dark lines are a separate candidate family, so filling cavities doesn't erase cracks.
    thin = responses[0]
    crack_mask = ((thin > max(19., np.percentile(thin[interior > 0], 90))) & (interior > 0)).astype(np.uint8)*255
    crack_mask = cv2.morphologyEx(crack_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    cracks, _ = cv2.findContours(crack_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    homography = cv2.getPerspectiveTransform(q, np.asarray(FULL_QUAD, np.float32))
    candidates = []
    roi_area = np.count_nonzero(interior)
    background_saturation_limit=max(35.,float(np.percentile(hsv[:,:,1][interior>0],70))+15)
    # Water-filled cavities can be brighter than asphalt. Require a compact bright basin
    # surrounded by a darker, locally contrasted rim; never infer depth from the reflection.
    bright = ((smooth.astype(np.float32)-local > 14) & (smooth > np.percentile(region, 58)) & (interior > 0)).astype(np.uint8)*255
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    pools, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Strong cavity rims are separated from the lower-contrast texture response.
    # The previous union let texture join large cavities into rejected components,
    # leaving small rim fragments while missing the visually dominant potholes.
    cavities=[]
    strong_threshold=max(24.,float(np.percentile(blackhat[interior > 0],90)))
    rim_kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                    (max(3,int(minimum*.016)|1),max(3,int(minimum*.010)|1)))
    for level_index,level in enumerate((strong_threshold*1.25,strong_threshold*.85)):
        rims=((blackhat>level)&(dark>max(9.,level*.35))&(interior>0)&(hsv[:,:,1]<125)).astype(np.uint8)*255
        rims=cv2.morphologyEx(rims,cv2.MORPH_CLOSE,rim_kernel)
        found,_=cv2.findContours(rims,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for contour in found:
            area=cv2.contourArea(contour)
            if area<max(65,roi_area*.00045) or area>roi_area*.08:continue
            hull=cv2.convexHull(contour)
            if area/max(cv2.contourArea(hull),1)<.30:continue
            cavities.append((hull,2 if level_index==0 else 1))
    families = ([(c, False, False, priority) for c,priority in cavities]
                + [(c, False, True, False) for c in pools]
                + [(c, True, False, False) for c in cracks]
                + [(c, False, False, False) for c in contours])
    edge_distance = cv2.distanceTransform(roi, cv2.DIST_L2, 3)
    for contour, line_only, water, cavity in families:
        if water:
            if cv2.contourArea(contour) < max(50, roi_area*.00035):
                continue
            basin = np.zeros_like(gray)
            cv2.drawContours(basin, [contour], -1, 255, -1)
            expanded = cv2.dilate(basin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
            ring = (expanded > 0) & (basin == 0) & (roi > 0)
            if (np.count_nonzero(ring) < 20
                    or gray[basin > 0].mean()-gray[ring].mean() < 15
                    or blackhat[ring].mean() < max(14,strong_threshold*.45)
                    or np.mean(blackhat[ring]>strong_threshold*.65)<.25):
                continue
            outline, _ = cv2.findContours(expanded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contour = max(outline, key=cv2.contourArea)
        area = cv2.contourArea(contour)
        if area < max(24, roi_area*.00018) or area > roi_area*.16:
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        if bw < 5 or bh < 3 or x <= 1 or y <= 1 or x+bw >= w-1 or y+bh >= h-1:
            continue
        rect = cv2.minAreaRect(contour)
        short, long = sorted(rect[1])
        elongation = long/max(short, 1)
        line_width=2*area/max(cv2.arcLength(contour, True),1)
        is_crack = not water and elongation > (30 if cavity else 7) and line_width < max(3.5,minimum*.014) and long > minimum*.045
        if line_only and not is_crack:
            continue
        if not is_crack and (area < max(100, roi_area*.0007) or min(bw, bh) < 7):
            continue
        # Small weak texture islands are not large cavities. Keep the separate
        # strong-rim and thin-line paths so this does not erase major holes/cracks.
        if not is_crack and not cavity and area < roi_area*.003:
            continue
        if not cavity and np.min(edge_distance[contour[:, 0, 1], contour[:, 0, 0]]) < 4:
            continue
        mask = np.zeros_like(gray)
        cv2.drawContours(mask, [contour], -1, 255, -1)
        rim = cv2.dilate(mask, np.ones((9, 9), np.uint8)) - mask
        inside, outside = gray[mask > 0], gray[(rim > 0) & (roi > 0)]
        if len(outside) < 8:
            continue
        # The rim must sit in road-like local context, not coloured vegetation.
        # Adapt to the selected surface so naturally tinted pavement is permitted.
        if np.median(hsv[:,:,1][(rim>0)&(roi>0)])>background_saturation_limit:
            continue
        boundary = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
        contrast = max(float(outside.mean()-np.percentile(inside, 25)),
                       float(blackhat[mask > 0].mean()))
        edge_strength = float(np.mean(blackhat[boundary > 0]))
        solidity = area/max(cv2.contourArea(cv2.convexHull(contour)), 1)
        if water and solidity<.80:
            continue
        if water:
            contrast = max(contrast, float(inside.mean()-outside.mean()))
        if contrast < 10 or solidity < .20 or (area > roi_area*.055 and inside.std() < 9):
            continue
        normalized = contour.reshape(-1, 2).astype(np.float32)/[w-1, h-1]
        approx = cv2.approxPolyDP(normalized.astype(np.float32).reshape(-1, 1, 2), .0025, True).reshape(-1, 2)
        if len(approx) < 3:
            continue
        road = cv2.perspectiveTransform(approx.reshape(-1, 1, 2), homography).reshape(-1, 2)
        road = np.clip(road, 0, 1)
        road_area = abs(float(cv2.contourArea(road)))
        if road_area > .30:
            continue
        c = float(np.clip(contrast/65, 0, 1))
        edge = float(np.clip(edge_strength/40, 0, 1))
        texture = float(np.clip(inside.std()/35, 0, 1))
        confidence = float(np.clip(.30+.27*c+.18*edge+.10*solidity+.07*texture, .30, .92))
        if confidence < .48:
            continue
        # Labels describe appearance, not proven 3D geometry. Wet cavities remain ambiguous.
        if is_crack:
            kind = "Crack"
        elif cavity or water:
            kind = "Pothole"
        elif contrast > 13 and texture < .65:
            kind = "Depression"
        else:
            kind = "Uneven surface"
        severity = float(np.clip(.50*np.sqrt(min(1., road_area/.018))+.35*c+.15*edge, 0, 1))
        candidates.append({"kind": kind, "confidence": round(confidence, 3), "severity": round(severity, 3),
                           "severity_label": "High" if severity >= .67 else "Moderate" if severity >= .34 else "Low",
                           "polygon": [{"x": round(float(px), 6), "y": round(float(py), 6)} for px, py in approx],
                           "road_polygon": [{"x": round(float(px), 6), "y": round(float(py), 6)} for px, py in road],
                           "bbox": {"x": round(x/w*ow), "y": round(y/h*oh), "width": round(bw/w*ow), "height": round(bh/h*oh)},
                           "bbox_normalized": {"x": x/w, "y": y/h, "width": bw/w, "height": bh/h},
                           "area_fraction": round(road_area, 6), "provenance": "opencv_candidate",
                           "depth_mm": None, "physical_dimensions": None,
                           "appearance": "thin dark linear discontinuity; crack or joint candidate" if is_crack else "strong dark rim; convex cavity outline is approximate" if cavity else "bright basin with dark rim; water or glare possible" if water else "dark contour or local texture discontinuity",
                           "evidence": {"local_contrast": round(contrast, 2), "boundary_strength": round(edge_strength, 2), "solidity": round(solidity, 3)},
                           "_rect": (x, y, bw, bh), "_contour":contour.reshape(-1,2),
                           "_priority": 5 if water else 2+cavity if cavity else 1 if is_crack else 0})
    # Keep strongest candidate per overlapping region; do not manufacture a minimum count.
    kept = []
    for item in sorted(candidates, key=lambda c: (-c["_priority"],-c["confidence"])):
        # A reflected basin and its rim describe one ambiguous cavity. Other
        # neighbouring candidates use polygon overlap, not bounding-box overlap.
        if any(_candidate_overlap(item,other) > .55 or
               (other['_priority']==5 and item['_priority'] in (3,4)
                and _overlap(item['_rect'],other['_rect'])>.55) for other in kept):
            continue
        kept.append(item)
        if len(kept) >= 80:
            break
    kept.sort(key=lambda c: -max(p["y"] for p in c["road_polygon"]))
    for index, item in enumerate(kept):
        item.pop("_rect")
        item.pop("_contour")
        item.pop("_priority")
        item["id"] = f"CV{index+1}"
    result["defects"] = kept
    return result


def defect_overlay(image, detection):
    output = image.copy()
    h, w = output.shape[:2]
    for item in detection["defects"]:
        points = np.round([[p["x"]*(w-1), p["y"]*(h-1)] for p in item["polygon"]]).astype(np.int32)
        color = COLORS[item["kind"]]
        cv2.polylines(output, [points], True, color, max(1, round(w/500)), cv2.LINE_AA)
        x, y = points.min(axis=0)
        cv2.putText(output, item["id"], (int(x), max(14, int(y)-4)), cv2.FONT_HERSHEY_SIMPLEX,
                    max(.35, w/1600), color, 1, cv2.LINE_AA)
    return output
