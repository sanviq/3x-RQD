import { useState } from 'react';
import type { DefectDetection } from '../types/api';
import { PanelTitle, Badge } from './UI';
const colors={Pothole:'#ed6c58',Crack:'#b68cde',Depression:'#e8b451','Uneven surface':'#63b9b2'};
interface Props {url:string;detection?:DefectDetection|null;busy?:boolean;error?:string;excluded?:string[];onToggle?:(id:string)=>void;onRetry:()=>void;onSelect?:(id:string)=>void}
export function DefectReview({url,detection,busy,error,excluded=[],onToggle,onRetry,onSelect}:Props) {
  const [outlines,setOutlines]=useState(true);
  const labelled=new Set([...(detection?.defects??[])].sort((a,b)=>b.area_fraction-a.area_fraction).slice(0,12).map(d=>d.id));
  return <section className="panel defect-review"><PanelTitle title="Detected road candidates"><Badge>{busy?'Detecting…':detection?detection.defects.length+' candidates':'Not detected'}</Badge></PanelTitle>
    {detection?.method==='yolo_rdd_detection'&&<p className="input-help">Trained RDD2022 detector · D00, D10, D20 and D40. Outlines are schematic bounding boxes, not segmentation or measured depth. Confidence is not road quality.</p>}
    <p className="input-help">The image is sent to the API automatically. Review the pixel-based candidates before using them. Labels, severity and confidence are unvalidated estimates; metric depth is unknown.</p>
    <div className="action-row"><label className="checkbox-row"><input type="checkbox" checked={outlines} onChange={e=>setOutlines(e.target.checked)}/>Show defect outlines</label><button className="text-button" disabled={busy} onClick={onRetry}>Detect again</button></div>
    <div className="defect-photo"><img src={url} alt={outlines?'Original uploaded road with API defect outlines':'Original uploaded road without outlines'}/>
      {outlines&&detection&&<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="API defect outlines">{detection.defects.map(d=><g key={d.id} opacity={excluded.includes(d.id)?.25:1} onClick={()=>onSelect?.(d.id)}>
        <polygon data-defect-id={d.id} points={d.polygon.map(p=>p.x*1000+','+p.y*1000).join(' ')} stroke={colors[d.kind]} fill={colors[d.kind]} fillOpacity=".12" strokeWidth="2" vectorEffect="non-scaling-stroke"><title>{d.id+' · '+d.kind+' candidate · '+d.severity_label+' visual severity · '+Math.round(d.confidence*100)+'% uncalibrated evidence'}</title></polygon>
        {labelled.has(d.id)&&<text x={d.polygon[0].x*1000} y={Math.max(20,d.polygon[0].y*1000-7)} fontSize="21" fill="#fff" stroke="#15222b" strokeWidth="4" paintOrder="stroke">{d.id}</text>}
      </g>)}</svg>}
    </div>
    <div className="defect-legend">{Object.entries(colors).map(([kind,color])=><span key={kind}><i style={{background:color}}/>{kind==='Uneven surface'?'Uneven patch':kind}</span>)}</div>
    {busy&&<p role="status" className="fine-print">Segmenting road regions and boundaries… The drive waits for this response.</p>}
    {error&&<p className="field-error" role="alert">{error} No substitute demo defects have been added.</p>}
    {detection&&!busy&&<><p className="fine-print">{detection.defects.length?'Untick false positives to exclude them from the provisional score, preview and lab. The backend recalculates the score.':'No candidates passed the visual filters. This does not prove the road is smooth.'} Simulation depth is a documented visual prior, not a measurement.</p>
      <div className="defect-candidate-list">{detection.defects.map(d=><div key={d.id} className="defect-candidate">
        <label><input type="checkbox" aria-label={'Use '+d.id+' in simulation'} checked={!excluded.includes(d.id)} onChange={()=>onToggle?.(d.id)} disabled={!onToggle}/><span><strong>{d.id} · {d.detection_code ? d.detection_code+' '+d.detection_label : d.kind+' candidate'}</strong><small>{d.severity_label} visual severity · {Math.round(d.confidence*100)}% evidence (uncalibrated)</small></span></label>
        <details><summary>Coordinates</summary><small>Original pixels: x {d.bbox.x}, y {d.bbox.y}, width {d.bbox.width}, height {d.bbox.height}. True depth and dimensions: unknown.</small></details>
      </div>)}</div>
      <details><summary>Detection limitations</summary><ul>{detection.warnings.map((note,i)=><li key={i}>{note}</li>)}</ul></details>
    </>}
  </section>;
}
