"""A reusable road mesh with explicit horizontal and vertical provenance."""
import numpy as np
from app.assessment import AssessmentRequest, mask_for


def build_twin(req: AssessmentRequest):
    nx, nz = 24, 48
    width = req.width*req.mm_per_pixel/1000 if req.mm_per_pixel else 7
    length = req.height*req.mm_per_pixel/1000 if req.mm_per_pixel else 30
    severity = np.zeros((nz+1,nx+1),float)
    depth = np.zeros_like(severity)
    measured = np.zeros_like(severity,dtype=bool)
    for d in req.defects:
        if d.id in req.repaired:
            continue
        source = mask_for(d)
        ys = np.minimum(511,(np.arange(nz+1)/nz*511).astype(int))
        xs = np.minimum(511,(np.arange(nx+1)/nx*511).astype(int))
        region = source[np.ix_(ys,xs)].astype(bool)
        severity[region] = np.maximum(severity[region],d.severity)
        if d.depth_mm is not None:
            depth[region] = np.maximum(depth[region],d.depth_mm/1000)
            measured[region] = True
    # Keep schematic displacement separate from actual depth evidence.
    schematic = np.where(measured,0,severity*min(width,length)*.06)
    vertices = []
    for z in range(nz+1):
        for x in range(nx+1):
            vertices.append([round((x/nx-.5)*width,5),round(-depth[z,x]-schematic[z,x],5),round((z/nz-.5)*length,5)])
    faces = []
    for z in range(nz):
        for x in range(nx):
            i = z*(nx+1)+x
            faces.append([i,i+1,i+nx+2,i+nx+1])
    return {'vertices':vertices,'faces':faces,'severity':severity.ravel().round(4).tolist(),
            'measured_depth_mm':[round(depth[z,x]*1000,3) if measured[z,x] else None for z in range(nz+1) for x in range(nx+1)],
            'width_m':width,'length_m':length,'horizontal_source':'uniform_image_calibration' if req.mm_per_pixel else 'schematic_7m_by_30m',
            'vertical_source':'mixed_explicit_depth_and_schematic' if measured.any() else 'schematic_severity_displacement',
            'notice':'Schematic road grid, not a surveyed digital twin. Unmeasured vertical deformation illustrates severity, not actual depth. measured_depth_mm is null where no sensor or validated reconstruction depth was supplied. Image pixels are mapped to a plane; horizontal dimensions are schematic unless a valid uniform image calibration was provided.'}
