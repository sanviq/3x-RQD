"""Extract visual proxies from a close-up, rectified road surface crop.

Bright regions are aggregate candidates, not verified individual stones.
Dark thin regions can be cracks, joints, shadows, or aggregate boundaries.
"""
from io import BytesIO
import warnings

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage import feature, measure, morphology, segmentation

MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 20_000_000
FEATURE_VERSION = "surface-v1"
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


def extract_features(image: np.ndarray, mm_per_pixel: float | None = None):
    original_h, original_w = image.shape[:2]
    scale = min(1.0, 1024 / max(original_h, original_w))
    width, height = round(original_w * scale), round(original_h * scale)
    image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
    # Use actual rounded dimensions for calibration, rather than nominal scale.
    area_scale = (original_w / width) * (original_h / height)
    linear_scale = np.sqrt(area_scale)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    normalized = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(smooth)
    _, mask = cv2.threshold(normalized, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = morphology.remove_small_objects(mask.astype(bool), min_size=24)
    mask = morphology.remove_small_holes(mask, area_threshold=16)
    # A constant crop contains no separable chips.
    if gray.std() < 2:
        mask[:] = False
    distance = ndi.distance_transform_edt(mask)
    peaks = feature.peak_local_max(distance, min_distance=5, labels=mask,
                                   exclude_border=False, threshold_abs=2)
    markers = np.zeros(gray.shape, dtype=np.int32)
    if len(peaks):
        markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    labels = segmentation.watershed(-distance, markers, mask=mask)
    regions = [r for r in measure.regionprops(labels)
               if 24 <= r.area <= gray.size * 0.1
               and r.bbox[0] > 0 and r.bbox[1] > 0
               and r.bbox[2] < height and r.bbox[3] < width]
    labels = np.where(np.isin(labels, [r.label for r in regions]), labels, 0)
    diameters = np.array([r.equivalent_diameter_area for r in regions])
    boundaries = segmentation.find_boundaries(labels, mode="inner")
    edges = cv2.Canny(normalized, 60, 140) > 0
    gradient = cv2.magnitude(cv2.Sobel(smooth, cv2.CV_32F, 1, 0),
                             cv2.Sobel(smooth, cv2.CV_32F, 0, 1))
    gaps = np.array([])
    if len(regions) > 1:
        centers = np.array([r.centroid for r in regions])
        distances, neighbors = cKDTree(centers).query(centers, k=2)
        # Equivalent-circle gap proxy; irregular chip edges need annotated validation.
        gaps = np.maximum(0, distances[:, 1] - (diameters + diameters[neighbors[:, 1]]) / 2)
    coverage_cells = [np.mean(cell > 0) for row in np.array_split(labels, 4)
                      for cell in np.array_split(row, 4, axis=1)]
    dark = gray < max(0, float(gray.mean() - 1.5 * gray.std()))
    blackhat = cv2.morphologyEx(smooth, cv2.MORPH_BLACKHAT, np.ones((11, 11), np.uint8))
    thin = blackhat > max(15, float(blackhat.mean() + 2 * blackhat.std()))
    thin = morphology.remove_small_objects(thin, min_size=20)
    # Retain elongated connected components as potential linear distress.
    linear = np.zeros_like(thin)
    for region in measure.regionprops(measure.label(thin)):
        if region.eccentricity > 0.95:
            linear[tuple(region.coords.T)] = True
    glcm = feature.graycomatrix(gray // 8, distances=[1, 3], angles=[0, np.pi / 2],
                               levels=32, symmetric=True, normed=True)
    hist = np.bincount((gray // 8).ravel(), minlength=32) / gray.size
    nonzero = hist[hist > 0]
    values = [
        len(regions) / gray.size * 1e6, np.mean(labels > 0),
        diameters.mean() if len(diameters) else 0,
        diameters.std() / diameters.mean() if len(diameters) else 0,
        np.mean([min(1, 4 * np.pi * r.area / max(r.perimeter ** 2, 1)) for r in regions]) if regions else 0,
        gaps.mean() if len(gaps) else 0,
        1 - min(1, np.std(coverage_cells) / max(np.mean(coverage_cells), 1e-6)),
        edges[boundaries].mean() if boundaries.any() else 0,
        gradient[boundaries].mean() / 255 if boundaries.any() else 0,
        linear.mean(), dark.mean(), feature.graycoprops(glcm, "contrast").mean(),
        feature.graycoprops(glcm, "homogeneity").mean(),
        -np.sum(nonzero * np.log2(nonzero)), gray.mean() / 255, gray.std() / 255,
        cv2.Laplacian(gray, cv2.CV_64F).var(),
    ]
    features = dict(zip(FEATURE_NAMES, map(float, values)))
    physical = {"area_sq_ft": None, "chip_candidates_per_sq_ft": None,
                "mean_chip_diameter_mm": None, "mean_chip_gap_mm_proxy": None}
    if mm_per_pixel is not None:
        area_sq_ft = original_h * original_w * mm_per_pixel ** 2 / 92903.04
        physical = {"area_sq_ft": area_sq_ft,
                    "chip_candidates_per_sq_ft": len(regions) / area_sq_ft,
                    "mean_chip_diameter_mm": float(diameters.mean() * linear_scale * mm_per_pixel) if len(diameters) else None,
                    "mean_chip_gap_mm_proxy": float(gaps.mean() * linear_scale * mm_per_pixel) if len(gaps) else None}
    overlay = image.copy()
    overlay[boundaries] = (0, 255, 0)
    overlay[linear] = (0, 0, 255)
    notes = ["Candidate chips and dark linear regions are unvalidated visual proxies.",
             "Unsegmented area can include binder, fines, shadows, or missed chips; it is not a binder measurement."]
    if mm_per_pixel is None:
        notes.append("Supply mm_per_pixel for a rectified, uniformly scaled surface crop to obtain physical units.")
    if gray.std() < 8 or features["laplacian_variance"] < 25:
        notes.append("Low detail or contrast: segmentation and scoring may be unreliable.")
    if not regions:
        notes.append("No chip candidates detected; use a sharper close-up or validate segmentation settings.")
    return {"features": features, "physical_measurements": physical,
            "chip_candidate_count": len(regions), "warnings": notes,
            "image": {"original_width": original_w, "original_height": original_h,
                      "processed_width": width, "processed_height": height}}, overlay
