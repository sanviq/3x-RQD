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
export function AnalysisResults({result,demo=false}:{result:AnalysisResponse;demo?:boolean}) {
  const assessment=result.assessment;
  const physical=result.physical_measurements;
  const value=assessment.road_quality_index;
  const methodLabels={experimental_heuristic:'Experimental heuristic',trained_random_forest:'Trained random forest',insufficient_visual_detail:'Insufficient visual detail'};
  const unavailable=physical.area_sq_ft===null?'Add a valid original-image scale to obtain physical measurements.':'No suitable candidates or gaps were detected for some measurements.';
  return <div className="results-stack">
    <section className="assessment-card">
      <div className="assessment-heading"><span className="eyebrow">{demo?'SYNTHETIC EXAMPLE':'SURFACE ASSESSMENT'}</span><Badge tone="dark-soft">{assessment.validated?'API validation flag: true':'Experimental · unvalidated'}</Badge></div>
      <div className="assessment-score"><strong>{value===null?'—':number(value,1)}</strong><span>{value===null?'Unable to assess':'out of 100'}<Badge tone={assessment.band}>{value===null?'Unable to assess':assessment.band}</Badge></span></div>
      <div className="score-scale" aria-hidden="true">{value!==null&&<span style={{left:value+'%'}}/>}</div><div className="scale-labels"><span>0 · Poor</span><span>50 · Fair</span><span>75 · Good</span><span>100</span></div>
      <p>{assessment.interpretation}</p><div className="assessment-method"><Icon name="flask" size={15}/>{methodLabels[assessment.method]}<span>{result.feature_version}</span></div>
    </section>
    <section className="panel"><PanelTitle title="Surface measurements"/><div className="measurement-grid">
      <Metric label="Detected chip candidates" value={integer(result.chip_candidate_count)}/>
      <Metric label="Visible chip coverage" value={percent(result.features.chip_coverage_fraction)}/>
      <Metric label="Spatial coverage uniformity" value={percent(result.features.packing_uniformity)}/>
      <Metric label="Potential dark linear area" value={percent(result.features.dark_linear_fraction)}/>
      {result.large_gap_fraction_proxy!==undefined&&<Metric label="Large-gap fraction · visual proxy" value={result.large_gap_fraction_proxy===null?'Not available':percent(result.large_gap_fraction_proxy)}/>}
    </div><p className="fine-print">Visible coverage is not volumetric compaction. Dark regions can include shadows, joints, and aggregate boundaries.</p></section>
    <section className="panel"><PanelTitle title="Calibrated measurements"/><div className="measurement-grid">
      <Metric label="Original crop area" value={number(physical.area_sq_ft)} unit={physical.area_sq_ft===null?'':'ft²'}/>
      <Metric label="Candidate density" value={number(physical.chip_candidates_per_sq_ft)} unit={physical.chip_candidates_per_sq_ft===null?'':'candidates/ft²'}/>
      <Metric label="Mean equivalent chip diameter" value={number(physical.mean_chip_diameter_mm)} unit={physical.mean_chip_diameter_mm===null?'':'mm'}/>
      <Metric label="Mean equivalent-circle gap" value={number(physical.mean_chip_gap_mm_proxy)} unit={physical.mean_chip_gap_mm_proxy===null?'':'mm · approximate'}/>
    </div>{Object.values(physical).some(x=>x===null)&&<p className="fine-print">{unavailable}</p>}
      <div className="inclination-row"><Icon name="sliders" size={18}/><span>User-supplied sensor pitch<strong>{number(result.inclination.degrees)}{result.inclination.degrees===null?'':'°'}</strong></span><Badge>{result.inclination.source==='user_supplied_sensor'?'Measured input':'Unavailable'}</Badge></div><p className="fine-print">Pitch is supplied by the user. It is not estimated from the image and does not affect this API’s score.</p>
    </section>
    <section className="panel warnings-panel"><PanelTitle title="Assessment notes"><Badge>{result.warnings.length}</Badge></PanelTitle>
      {result.warnings.length?<ul>{result.warnings.map((warning,index)=><li key={index}><Icon name="warning" size={16}/><span>{warning}</span></li>)}</ul>:<p className="fine-print">The API returned no image-specific warnings.</p>}
      <Note>Use this experimental output for investigation. It is not a validated engineering or road-safety grade. Ordinary imagery cannot verify material composition, friction, binder adhesion, or water resistance.</Note>
    </section>
    <details className="panel technical-panel"><summary><span>Technical features<small>All {Object.keys(result.features).length} values returned by the API</small></span><Icon name="down" size={18}/></summary><div className="table-scroll"><table><thead><tr><th>Feature</th><th>Value</th><th>Unit</th></tr></thead><tbody>{Object.entries(result.features).map(([key,value])=>{
      const [label,unit]=featureLabels[key as FeatureName];
      return <tr key={key}><td>{label}<code>{key}</code></td><td>{unit==='fraction'?percent(value):number(value)}</td><td>{unit==='fraction'?'%':unit}</td></tr>;
    })}</tbody></table></div><p className="fine-print">Pixel features refer to the processed image. Physical values already account for resizing; they are not converted again.</p></details>
  </div>;
}
function Metric({label,value,unit}:{label:string;value:string;unit?:string}) {return <div className="measurement"><span>{label}</span><strong>{value}</strong>{unit&&<small>{unit}</small>}</div>}
