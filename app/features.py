"""Extract visual proxies from a close-up, rectified road surface crop.

Bright regions are aggregate candidates, not verified individual stones.
Dark thin regions can be cracks, joints, shadows, or aggregate boundaries.
"""
from io import BytesIO
import hashlib
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import feature, measure, morphology, segmentation
from app.mask_models import predict_mask

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 20_000_000
FEATURE_VERSION = "surface-v4"
FEATURE_NAMES = [
    "chip_count_per_megapixel", "chip_coverage_fraction", "chip_diameter_mean_px",
    "chip_diameter_cv", "chip_circularity_mean", "chip_spacing_mean_px",
    "packing_uniformity", "boundary_edge_fraction", "boundary_contrast",
    "dark_linear_fraction", "dark_region_fraction", "texture_contrast",
    "texture_homogeneity", "texture_entropy", "brightness_mean", "brightness_std",
    "laplacian_variance",
]


def decode_image(data: bytes) -> np.ndarray:
    if len(data) > MAX_BYTES:
        raise ValueError("Image exceeds the 12 MiB upload limit.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Use a JPEG, PNG, or WebP image.")
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError("Image exceeds the 20 megapixel limit.")
                if min(source.size) < 64:
                    raise ValueError("Image must be at least 64 pixels on each side.")
                rgb = np.asarray(ImageOps.exif_transpose(source).convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise ValueError("Invalid or unsafe image file.") from exc
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)



def _chip_regions(gray, normalized, smooth, inner):
    """Local contrast preserves fine particles; watershed separates touching candidates."""
    samples=gray[inner]
    # Edge-preserving preprocessing avoids the old 5x5 blur/minimum-24-pixel loss.
    response=np.maximum.reduce([cv2.morphologyEx(normalized,cv2.MORPH_TOPHAT,
             cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k))) for k in (9,21,35)])
    threshold,_=cv2.threshold(response[inner],0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    baseline=cv2.GaussianBlur(smooth,(0,0),5).astype(np.float32)
    mask=(response>max(3.,threshold)) & (smooth.astype(np.float32)>baseline+max(2.,float(samples.std())*.10)) & inner
    if float(samples.std())<2:mask[:]=False
    return mask


def _boundary_gaps(regions,sx,sy):
    """Nearest-boundary estimate among eight neighboring centroids; never a center-distance claim."""
    if len(regions)<2:return np.array([])
    centers=np.asarray([r.centroid for r in regions])*[sy,sx]
    _,neighbors=cKDTree(centers).query(centers,k=min(9,len(regions)))
    boundaries=[];trees=[]
    for r in regions:
        component=r.image.astype(np.uint8)
        padded=np.pad(component,1)
        edge=padded-cv2.erode(padded,np.ones((3,3),np.uint8))
        points=np.argwhere(edge>0).astype(float)+np.array(r.bbox[:2])-1
        # Bounded contour sampling controls CPU cost; it is disclosed as an approximation.
        if len(points)>128:points=points[np.linspace(0,len(points)-1,128,dtype=int)]
        points*=np.array([sy,sx]);boundaries.append(points);trees.append(cKDTree(points))
    gaps=[]
    for i,neighbor in enumerate(neighbors):
        nearest=min(float(trees[int(j)].query(boundaries[i],k=1)[0].min()) for j in neighbor[1:])
        gaps.append(max(0.,nearest-min(sx,sy)))
    return np.asarray(gaps)


def extract_features(image: np.ndarray, mm_per_pixel: float | None = None, road_quad=None, road_polygon=None):
    original_h, original_w = image.shape[:2]
    scale=min(1.,1536/max(original_h,original_w))
    width,height=round(original_w*scale),round(original_h*scale)
    native_image=image
    image=image.copy() if scale==1 else cv2.resize(image,(width,height),interpolation=cv2.INTER_AREA)
    sx,sy=original_w/width,original_h/height
    area_scale=sx*sy;linear_scale=np.sqrt(area_scale)
    roi=np.ones((height,width),np.uint8)
    native_roi=np.ones((original_h,original_w),np.uint8)
    if road_quad is not None or road_polygon is not None:
        q=np.asarray([[p['x'],p['y']] if isinstance(p,dict) else p for p in (road_polygon if road_polygon is not None else road_quad)],float)
        roi[:]=0;native_roi[:]=0
        cv2.fillConvexPoly(roi,np.rint(q*[width-1,height-1]).astype(np.int32),1)
        cv2.fillConvexPoly(native_roi,np.rint(q*[original_w-1,original_h-1]).astype(np.int32),1)
    valid=roi.astype(bool);native_pixels=int(native_roi.sum())
    inner=cv2.erode(roi,np.ones((3,3),np.uint8)).astype(bool)
    sample_size=int(valid.sum())
    if int(inner.sum())<64:raise ValueError("Selected road region is too small for texture analysis. Expand the four road corners to include at least 64 usable pixels.")
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
    processing_gray=gray.copy();processing_gray[~valid]=np.median(gray[valid])
    smooth=cv2.bilateralFilter(processing_gray,5,16,2)
    normalized=cv2.createCLAHE(clipLimit=2.,tileGridSize=(8,8)).apply(smooth)
    chip_model_mask,model=predict_mask(native_image,"chip")
    if chip_model_mask is not None:
        mask=cv2.resize(chip_model_mask,(width,height),interpolation=cv2.INTER_NEAREST).astype(bool)&inner
        method="local_onnx_mask_watershed"
    else:
        mask=_chip_regions(gray,normalized,smooth,inner);method="opencv_local_contrast_watershed"
    mask=morphology.remove_small_objects(mask,min_size=6)
    mask=morphology.remove_small_holes(mask,area_threshold=4)&inner
    if gray[valid].std()<2:mask[:]=False
    distance=ndi.distance_transform_edt(mask)
    peaks=feature.peak_local_max(distance,min_distance=3,labels=mask,exclude_border=False,threshold_abs=1.1)
    truncated=len(peaks)>3000
    if truncated:peaks=peaks[np.argsort(distance[tuple(peaks.T)])[-3000:]]
    markers=np.zeros(gray.shape,np.int32)
    if len(peaks):markers[tuple(peaks.T)]=np.arange(1,len(peaks)+1)
    labels=segmentation.watershed(-distance,markers,mask=mask)
    regions=[r for r in measure.regionprops(labels) if 6<=r.area<=min(sample_size*.02,12000)
             and r.bbox[0]>0 and r.bbox[1]>0 and r.bbox[2]<height and r.bbox[3]<width
             and r.eccentricity<.985 and r.solidity>=.4 and np.all(inner[tuple(r.coords.T)])]
    labels=np.where(np.isin(labels,[r.label for r in regions]),labels,0)
    diameters=np.array([r.equivalent_diameter_area for r in regions])
    boundaries=segmentation.find_boundaries(labels,mode="inner")
    edges=cv2.Canny(normalized,60,140)>0
    gradient=cv2.magnitude(cv2.Sobel(smooth,cv2.CV_32F,1,0),cv2.Sobel(smooth,cv2.CV_32F,0,1))
    gaps=np.array([])
    if len(regions)>1:
        centers=np.array([r.centroid for r in regions]);distances,neighbors=cKDTree(centers).query(centers,k=2)
        gaps=np.maximum(0,distances[:,1]-(diameters+diameters[neighbors[:,1]])/2)
    native_boundary_gaps=_boundary_gaps(regions,sx,sy)
    coverage_cells=[]
    for ys in np.array_split(np.arange(height),4):
        for xs in np.array_split(np.arange(width),4):
            cell_roi=valid[np.ix_(ys,xs)]
            if cell_roi.any():coverage_cells.append(np.mean(labels[np.ix_(ys,xs)][cell_roi]>0))
    dark=gray<max(0,float(gray[valid].mean()-1.5*gray[valid].std()))
    blackhat=cv2.morphologyEx(smooth,cv2.MORPH_BLACKHAT,np.ones((11,11),np.uint8))
    bh=blackhat[inner]
    thin=(blackhat>max(8,float(np.percentile(bh,90))))&inner
    thin=morphology.remove_small_objects(thin,min_size=12)
    linear=np.zeros_like(thin)
    for region in measure.regionprops(measure.label(thin)):
        if region.eccentricity>.95:linear[tuple(region.coords.T)]=True
    quantized=gray//8;matrices=[]
    for dy,dx in [(0,1),(1,0),(0,3),(3,0)]:
        a,b=quantized[:height-dy,:width-dx],quantized[dy:,dx:]
        paired=valid[:height-dy,:width-dx]&valid[dy:,dx:]
        counts=np.bincount((a[paired].astype(int)*32+b[paired]).ravel(),minlength=1024).reshape(32,32)
        counts=counts+counts.T;matrices.append(counts/max(1,counts.sum()))
    glcm=np.stack(matrices,axis=-1)[:,:,:,None]
    hist=np.bincount(quantized[valid],minlength=32)/sample_size;nonzero=hist[hist>0]
    lap=float(cv2.Laplacian(processing_gray,cv2.CV_64F)[inner].var())
    values=[len(regions)/sample_size*1e6,np.mean(labels[valid]>0),diameters.mean() if len(diameters) else 0,
            diameters.std()/diameters.mean() if len(diameters) else 0,
            np.mean([min(1,4*np.pi*r.area/max(r.perimeter**2,1)) for r in regions]) if regions else 0,
            gaps.mean() if len(gaps) else 0,
            1-min(1,np.std(coverage_cells)/np.mean(coverage_cells)) if regions and np.mean(coverage_cells)>0 else 0,
            edges[boundaries].mean() if boundaries.any() else 0,gradient[boundaries].mean()/255 if boundaries.any() else 0,
            linear[valid].mean(),dark[valid].mean(),feature.graycoprops(glcm,"contrast").mean(),feature.graycoprops(glcm,"homogeneity").mean(),
            -np.sum(nonzero*np.log2(nonzero)),gray[valid].mean()/255,gray[valid].std()/255,lap]
    features=dict(zip(FEATURE_NAMES,map(float,values)))
    std=float(gray[valid].std());brightness=float(gray[valid].mean());limited=std<4 or lap<8 or brightness<10 or brightness>245
    physical={"area_sq_ft":None,"chip_candidates_per_sq_ft":None,"mean_chip_diameter_mm":None,"mean_chip_gap_mm_proxy":None}
    if mm_per_pixel is not None:
        area=native_pixels*mm_per_pixel**2/92903.04
        physical={"area_sq_ft":area,"chip_candidates_per_sq_ft":len(regions)/area if not limited else None,
                  "mean_chip_diameter_mm":float(diameters.mean()*linear_scale*mm_per_pixel) if len(diameters) and not limited else None,
                  "mean_chip_gap_mm_proxy":float(native_boundary_gaps.mean()*mm_per_pixel) if len(native_boundary_gaps) and not limited else None}
    notes=[];issues=[]
    def issue(code,message,guidance,affects):issues.append({"code":code,"message":message,"guidance":guidance,"affects":affects})
    if std<4:issue("low_contrast","The selected region has very little contrast.","Move closer, use diffuse daylight and focus on visible surface grains.",["chip_diameter","chip_gap","candidate_density"])
    if lap<8:issue("low_detail","Fine surface boundaries are not resolved.","Hold the camera steady, tap to focus, and photograph the surface closer; do not enlarge a blurry image.",["chip_diameter","chip_gap"])
    if brightness<10:issue("underexposed","Most selected road pixels are almost black.","Increase exposure or use daylight; avoid deep shadows.",["texture","chips","defects"])
    if brightness>245:issue("overexposed","Most selected road pixels are almost white.","Reduce exposure and avoid direct glare on wet asphalt.",["texture","chips","defects"])
    if min(original_h,original_w)<180:issue("low_resolution","The source image is small; only coarse surface regions may be resolved.","Use the original camera file rather than a thumbnail or screenshot.",["chip_diameter","chip_gap"])
    if not regions:issue("no_resolved_candidates","No aggregate candidates passed the contrast, size and shape filters.","Use a sharp road-only close-up with individual grains visible. Zero detections does not prove an aggregate-free or healthy road.",["chip_diameter","chip_gap"])
    elif len(regions)<2:issue("too_few_candidates","Only one candidate was resolved; a gap requires two separate regions.","Include several clearly separated grains in the road crop.",["chip_gap"])
    if truncated:issue("candidate_limit","The processing limit of 3,000 candidate seeds was reached.","Analyze a smaller uniformly scaled close-up. Candidate density may be underestimated.",["candidate_density"])
    if mm_per_pixel is None:issue("scale_missing","Physical units have no calibration.","For millimetres and candidates/ft², choose an already rectified surface crop and set mm per original-image pixel using a measured reference.",["physical_measurements"])
    if model["configured"] and not model["used"]:issue("chip_model_failed",model["reason"],"Check the trusted ONNX model, class index and preprocessing configuration. OpenCV results remain available.",["chip_segmentation"])
    def metric(value,unit,reason=None):return {"value":value,"unit":unit,"status":"unavailable" if value is None else "limited" if limited else "estimated","reason":reason}
    measurements={"native_road_area":metric(native_pixels,"original px²"),
                  "candidate_density":metric(len(regions)/native_pixels*1e6,"candidates/original MP"),
                  "equivalent_diameter":metric(float(diameters.mean()*linear_scale) if len(diameters) else None,"original px","No candidates resolved." if not regions else None),
                  "inter_chip_gap":metric(float(native_boundary_gaps.mean()) if len(native_boundary_gaps) else None,"original px","At least two resolved candidates are required." if not len(native_boundary_gaps) else None)}
    notes.extend(i['message']+' '+i['guidance'] for i in issues)
    notes.extend(["Segmented regions are aggregate appearance candidates, not verified stones. Shadows, paint and cavities can be mistaken for particles.",
                  "Boundary gaps are sampled nearest-boundary estimates among neighboring candidates, not verified particle spacing or binder measurements."])
    overlay=image.copy();overlay[~valid]=(overlay[~valid]*.3).astype(np.uint8);overlay[boundaries]=(0,255,0);overlay[linear]=(0,0,255)
    audit={name:hashlib.sha256(np.ascontiguousarray(value).tobytes()).hexdigest() for name,value in
           {'decoded_pixels':native_image,'grayscale':gray,'smoothed':smooth,'contrast':normalized,
            'candidate_mask':mask,'watershed_peaks':peaks,'accepted_labels':labels}.items()}
    return {"features":features,"physical_measurements":physical,"surface_measurements":measurements,"processing_audit":audit,
            "surface_quality":{"status":"limited" if limited else "measured","issues":issues,"method":method,"model":model,"candidate_limit_reached":truncated},
            "chip_candidate_count":len(regions),"warnings":notes,
            "analysis_region":{"road_quad":[{"x":float(p['x'] if isinstance(p,dict) else p[0]),"y":float(p['y'] if isinstance(p,dict) else p[1])} for p in road_quad] if road_quad is not None else None,
              "processed_pixel_count":sample_size,"native_pixel_count":native_pixels,"image_fraction":float(valid.mean()),"scope":"selected_road" if road_quad is not None else "full_image"},
            "large_gap_fraction_proxy":float(np.mean(native_boundary_gaps>diameters.mean()*linear_scale)) if len(native_boundary_gaps) else None,
            "image":{"original_width":original_w,"original_height":original_h,"processed_width":width,"processed_height":height}},overlay
