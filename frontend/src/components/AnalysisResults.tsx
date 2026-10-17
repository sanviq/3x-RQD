import type {RoadQualityScore} from '../api/qualityScore';
import type { AnalysisResponse, FeatureName } from '../types/api';
import { number, percent, integer } from '../utils/formatters';
import { Badge, Note, PanelTitle } from './UI';
import { Icon } from './Icon';
const featureLabels:Record<FeatureName,[string,string]> = {
  chip_count_per_megapixel:['Candidates per processed megapixel','candidates/MP'],
  chip_coverage_fraction:['Visible chip coverage','fraction'],chip_diameter_mean_px:['Mean equivalent chip diameter','processed px'],
  chip_diameter_cv:['Chip diameter variation','ratio'],chip_circularity_mean:['Mean candidate circularity','ratio'],
  chip_spacing_mean_px:['Mean equivalent-circle gap (approximate)','processed px'],packing_uniformity:['Spatial coverage uniformity','fraction'],
  boundary_edge_fraction:['Boundary edge support','fraction'],boundary_contrast:['Boundary gradient contrast','raw normalized'],
  dark_linear_fraction:['Potential dark linear area','fraction'],dark_region_fraction:['Dark region area','fraction'],
  texture_contrast:['GLCM contrast','raw'],texture_homogeneity:['GLCM homogeneity','ratio'],texture_entropy:['Texture entropy','bits'],
  brightness_mean:['Mean brightness','normalized'],brightness_std:['Brightness standard deviation','normalized'],laplacian_variance:['Image detail proxy','raw'],
};
export function AnalysisResults({result,demo=false,score,scoreBusy=false,scoreError=''}:{result:AnalysisResponse;demo?:boolean;score?:RoadQualityScore|null;scoreBusy?:boolean;scoreError?:string}) {
  const assessment=result.assessment;
  const physical=result.physical_measurements;
  const surface=result.surface_quality;
  const linkedScore=score===undefined?result.defect_detection?.road_quality_score:score;
  const currentScore=!scoreBusy&&!scoreError?linkedScore:null;
  const value=surface?currentScore?.score??null:assessment.validated?assessment.road_quality_index:null;
  const pixels=result.surface_measurements;
  const issues=surface?.issues??[];
  const isScene=result.capture_type==='road_scene';
  const methodLabels={experimental_heuristic:'Experimental heuristic',trained_random_forest:'Trained random forest',insufficient_visual_detail:'Insufficient visual detail',unsuitable_capture:'Capture not suitable for scoring',no_trained_model:'No trained condition model',invalid_model_output:'Invalid model output'};
  const unavailable=isScene?'Use a road-only rectified surface crop and a measured mm/pixel scale for physical aggregate measurements.':physical.area_sq_ft===null?'Add a valid original-image scale to obtain physical measurements.':'No suitable candidates or gaps were detected for some measurements.';
  const physicalReason=(field:keyof typeof physical)=>{
    if(physical[field]!==null)return undefined;
    if(isScene)return 'Needs a rectified road-only crop and uniform mm/pixel scale.';
    if(physical.area_sq_ft===null)return 'Set a measured mm per original-image pixel scale.';
    if(surface?.status==='limited')return 'Surface detail is insufficient for this physical estimate. See capture guidance below.';
    return field==='mean_chip_gap_mm_proxy'?'Needs at least two resolved candidates.':'No suitable chip candidates were resolved.';
  };
  return <div className="results-stack">
    <section className="panel"><PanelTitle title="Road texture & aggregate candidates"/>{result.analysis_region&&<p className="fine-print">Selected road region · {integer(result.analysis_region.processed_pixel_count)} analyzed pixels · {percent(result.analysis_region.image_fraction)} of capture. Scenery outside the road is excluded.</p>}<div className="measurement-grid">
      <><Metric label="Detected chip candidates" value={integer(result.chip_candidate_count)}/>
      {pixels&&<><Metric label="Candidate density · image estimate" value={number(pixels.candidate_density.value)} unit={pixels.candidate_density.unit} hint={pixels.candidate_density.status==='limited'?'Limited capture detail; candidate count may be incomplete.':undefined}/><Metric label="Mean equivalent chip diameter · pixels" value={number(pixels.equivalent_diameter.value)} unit={pixels.equivalent_diameter.unit} hint={pixels.equivalent_diameter.reason??undefined}/><Metric label="Mean inter-chip boundary gap · pixels" value={number(pixels.inter_chip_gap.value)} unit={pixels.inter_chip_gap.unit} hint={pixels.inter_chip_gap.reason??'Nearest sampled boundary estimate; no physical scale assumed.'}/></>}
      <Metric label="Visible chip coverage" value={percent(result.features.chip_coverage_fraction)}/>
      <Metric label="Spatial coverage uniformity" value={percent(result.features.packing_uniformity)}/>
      <Metric label="Potential dark linear area" value={percent(result.features.dark_linear_fraction)}/>
      {result.large_gap_fraction_proxy!==undefined&&<Metric label="Large-gap fraction · visual proxy" value={result.large_gap_fraction_proxy===null?'Needs ≥2 candidates':percent(result.large_gap_fraction_proxy)}/>}</>
      {isScene&&<><Metric label="Mean image brightness" value={percent(result.features.brightness_mean)}/><Metric label="Image detail proxy" value={number(result.features.laplacian_variance)}/><Metric label="Dark image area" value={percent(result.features.dark_region_fraction)}/></>}
    </div><p className="fine-print">These are API-computed candidates inside the selected road polygon, not verified individual stones. Perspective scenes cannot resolve aggregate uniformly: candidates may include patches, reflections or larger regions, rather than individual stones. Use a sharp close-up for chip sizing. Dark regions may include shadows and joints.</p></section>
    <section className="assessment-card" aria-label="Surface assessment summary">
      <div className="assessment-heading"><span className="eyebrow">{demo?'SYNTHETIC EXAMPLE':'SURFACE ASSESSMENT'}</span><Badge tone="dark-soft">{surface?surface.status==='measured'?'Image measurements ready':'Limited surface detail':assessment.validated?'API validation flag: true':'Experimental · unvalidated'}</Badge></div>
      <div className="assessment-score"><strong data-testid="surface-assessment-score">{value===null?'—':number(value,1)}</strong><span>{surface?value!==null?'Provisional defect score':scoreBusy?'Updating current defect score…':'Condition score needs usable evidence':value===null?'Unable to assess':'out of 100'}<Badge tone={surface?'lavender':assessment.band}>{surface?currentScore?.rating?'Provisional · '+currentScore.rating:surface.status==='measured'?'Texture measured':'Capture needs review':value===null?'Unable to assess':assessment.band}</Badge></span></div>
      {surface?<><p>{scoreError||result.defect_detection?.score_error||'The condition number uses the same backend defect score shown above. Texture descriptors are calculated independently; missing physical calibration does not prevent pixel measurements.'}</p><p className="fine-print">{pixels?.equivalent_diameter.value==null?'Individual chips were not resolved; their diameter remains unknown.':'Candidate particle sizes describe image regions, not verified stones.'} {isScene?'Perspective changes the scale across this photo.':'Physical units depend on a user-supplied uniform scale.'} This is not a validated engineering or road-safety grade.</p><details><summary>Texture diagnostic and validated-grade status</summary><p>{assessment.interpretation}</p>{assessment.visual_proxy_index!=null&&<p>Legacy diagnostic texture index: {number(assessment.visual_proxy_index,1)} / 100. This is not the provisional defect score or model confidence.</p>}</details></>:<><p>{assessment.interpretation}</p>{assessment.visual_proxy_index!=null&&<details><summary>Diagnostic texture index: {number(assessment.visual_proxy_index,1)} / 100</summary><p className="fine-print">Unvalidated image descriptor only; neither model confidence nor measured road health.</p></details>}</>}
      <div className="assessment-method"><Icon name="flask" size={15}/>{surface?surface.method.replaceAll('_',' '):methodLabels[assessment.method]}<span>{result.feature_version}</span></div>
    </section>

    <section className="panel"><PanelTitle title="Physical measurements"><Badge>{physical.area_sq_ft===null?'Calibration required':'User-supplied scale'}</Badge></PanelTitle>{physical.area_sq_ft===null&&<p className="fine-print">Pixel measurements above are available. Physical dimensions need an already rectified road-only close-up and a measured reference scale; a perspective road photo cannot supply one uniform millimetre scale.</p>}<div className="measurement-grid">
      <Metric label="Original crop area" value={number(physical.area_sq_ft)} unit={physical.area_sq_ft===null?'':'ft²'} hint={physicalReason('area_sq_ft')}/>
      <Metric label="Candidate density" value={number(physical.chip_candidates_per_sq_ft)} unit={physical.chip_candidates_per_sq_ft===null?'':'candidates/ft²'} hint={physicalReason('chip_candidates_per_sq_ft')}/>
      <Metric label="Mean equivalent chip diameter" value={number(physical.mean_chip_diameter_mm)} unit={physical.mean_chip_diameter_mm===null?'':'mm'} hint={physicalReason('mean_chip_diameter_mm')}/>
      <Metric label="Mean inter-chip boundary gap" value={number(physical.mean_chip_gap_mm_proxy)} unit={physical.mean_chip_gap_mm_proxy===null?'':'mm · approximate'} hint={physicalReason('mean_chip_gap_mm_proxy')}/>
    </div>{Object.values(physical).some(x=>x===null)&&<p className="fine-print">{unavailable}</p>}
      {result.calibration&&<><p className="fine-print">{result.calibration.notice}</p>{result.calibration.scale_uncertainty_percent!=null?<details><summary>Scale uncertainty bounds · ±{result.calibration.scale_uncertainty_percent}%</summary><div className="table-scroll"><table><thead><tr><th>Measurement</th><th>Lower bound</th><th>Upper bound</th></tr></thead><tbody>{Object.entries(result.calibration.bounds).map(([name,b])=><tr key={name}><th>{name.replaceAll('_',' ')}</th><td>{b?number(b.lower,4):'Not available'}</td><td>{b?number(b.upper,4):'Not available'}</td></tr>)}</tbody></table></div><p className="fine-print">Units match the physical measurements above. These are scale-only bounds, not confidence intervals or total measurement-error limits.</p></details>:<p className="fine-print">Scale uncertainty is unknown; no error bounds are invented.</p>}</>}
      <div className="inclination-row"><Icon name="sliders" size={18}/><span>User-supplied sensor pitch<strong>{result.inclination.degrees===null?'No sensor input':number(result.inclination.degrees)}{result.inclination.degrees===null?'':'°'}</strong></span><Badge>{result.inclination.source==='user_supplied_sensor'?'Measured input':'Optional input'}</Badge></div><p className="fine-print">Pitch is supplied by the user. It is not estimated from the image and does not affect this API’s score.</p>
    </section>
    <section className="panel warnings-panel"><PanelTitle title="Assessment notes"><Badge>{result.warnings.length}</Badge></PanelTitle>
      {issues.length>0&&<ul className="capture-guidance">{issues.map(issue=><li key={issue.code}><Icon name="info" size={16}/><span><strong>{issue.message}</strong><br/>{issue.guidance}</span></li>)}</ul>}
      {result.warnings.length?<ul>{result.warnings.map((warning,index)=><li key={index}><Icon name="warning" size={16}/><span>{warning}</span></li>)}</ul>:<p className="fine-print">The API returned no image-specific warnings.</p>}
      <Note>Use this experimental output for investigation. It is not a validated engineering or road-safety grade. Ordinary imagery cannot verify material composition, friction, binder adhesion, or water resistance.</Note>
    </section>
    <details className="panel technical-panel"><summary><span>Technical features<small>All {Object.keys(result.features).length} values returned by the API</small></span><Icon name="down" size={18}/></summary><div className="table-scroll"><table><thead><tr><th>Feature</th><th>Value</th><th>Unit</th></tr></thead><tbody>{Object.entries(result.features).map(([key,value])=>{
      const [label,unit]=featureLabels[key as FeatureName];
      return <tr key={key}><td>{label}<code>{key}</code></td><td>{unit==='fraction'?percent(value):number(value)}</td><td>{unit==='fraction'?'%':unit}</td></tr>;
    })}</tbody></table></div><p className="fine-print">Pixel features refer to the processed image. Physical values already account for resizing; they are not converted again.</p></details>
  </div>;
}
function Metric({label,value,unit,hint}:{label:string;value:string;unit?:string;hint?:string}) {return <div className="measurement"><span>{label}</span><strong>{value}</strong>{unit&&<small>{unit}</small>}{hint&&<small className="measurement-hint">{hint}</small>}</div>}
