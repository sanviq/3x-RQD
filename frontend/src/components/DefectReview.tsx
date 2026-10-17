import { useState } from 'react';
import type { DefectDetection, RoadDetectorSettings } from '../types/api';
import { PanelTitle, Badge } from './UI';
const colors={Pothole:'#ed6c58',Crack:'#b68cde',Depression:'#e8b451','Uneven surface':'#63b9b2'};
interface Props {url:string;detection?:DefectDetection|null;busy?:boolean;error?:string;excluded?:string[];onToggle?:(id:string)=>void;onRetry:()=>void;onSelect?:(id:string)=>void;settings?:RoadDetectorSettings;onSettings?:(settings:RoadDetectorSettings)=>void}
export function DefectReview({url,detection,busy,error,excluded=[],onToggle,onRetry,onSelect,settings,onSettings}:Props) {
  const [outlines,setOutlines]=useState(true);
  const trained=detection?.method==='yolo_rdd_detection';
  const labelled=new Set([...(detection?.defects??[])].sort((a,b)=>b.area_fraction-a.area_fraction).slice(0,12).map(d=>d.id));
  return <section className="panel defect-review"><PanelTitle title="Detected road candidates"><Badge>{busy?'Detecting…':detection?detection.defects.length+' candidates':'Not detected'}</Badge></PanelTitle>
    {settings&&onSettings&&<div className="settings-grid">
      <label className="field">Detector<select aria-label="Road candidate detector" value={settings.mode} onChange={e=>onSettings({...settings,mode:e.target.value as RoadDetectorSettings['mode']})}><option value="model">Trained YOLO · experimental</option><option value="opencv">Untrained visual candidates · OpenCV</option></select></label>
      {settings.mode==='model'&&<><label className="field">Minimum confidence<select aria-label="Road candidate confidence" value={settings.confidence} onChange={e=>onSettings({...settings,confidence:Number(e.target.value)})}><option value={.15}>0.15 · more candidates, more false alarms</option><option value={.25}>0.25 · review more candidates</option><option value={.35}>0.35 · saved model threshold</option><option value={.5}>0.50 · fewer candidates, more misses</option></select></label><label className="field">Model image size<select aria-label="Road candidate resolution" value={settings.resolution} onChange={e=>onSettings({...settings,resolution:Number(e.target.value)})}><option value={640}>640 px</option><option value={768}>768 px · evaluated setting</option><option value={1024}>1024 px · experimental</option></select></label></>}
    </div>}
    {detection&&<p className="input-help">{trained?'Trained YOLO predictions from your photo · experimental RDD2022 model. Rectangles are detection boxes, not measured pothole boundaries.':'Untrained OpenCV contours from brightness and texture. These can mistake tiny cracks, shadows and puddles for potholes.'} Review every candidate; severity and depth are not measured.</p>}
    {trained&&<p className="input-help" role="note"><strong>Depressions and uneven patches: not assessed.</strong> This checkpoint was trained on potholes and three crack types only. Missing damage may still be present. Lower confidence can reveal additional candidates and also increases false alarms.</p>}
    <div className="action-row"><label className="checkbox-row"><input type="checkbox" checked={outlines} onChange={e=>setOutlines(e.target.checked)}/>Show defect outlines</label><button className="text-button" disabled={busy} onClick={onRetry}>Detect again</button></div>
    <div className="defect-photo"><img src={url} alt={outlines?'Original uploaded road with API defect outlines':'Original uploaded road without outlines'}/>
      {outlines&&detection&&<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="API defect outlines">{detection.defects.map(d=><g key={d.id} opacity={excluded.includes(d.id)?.25:1} onClick={()=>onSelect?.(d.id)}>
        <polygon data-defect-id={d.id} points={d.polygon.map(p=>p.x*1000+','+p.y*1000).join(' ')} stroke={colors[d.kind]} fill={colors[d.kind]} fillOpacity=".12" strokeWidth="2" vectorEffect="non-scaling-stroke"><title>{d.id+' · '+d.kind+' candidate · '+d.severity_label+' visual severity · '+Math.round(d.confidence*100)+'% uncalibrated evidence'}</title></polygon>
        {labelled.has(d.id)&&<text x={d.polygon[0].x*1000} y={Math.max(20,d.polygon[0].y*1000-7)} fontSize="21" fill="#fff" stroke="#15222b" strokeWidth="4" paintOrder="stroke">{d.id}</text>}
      </g>)}</svg>}
    </div>
    <div className="defect-legend">{Object.entries(colors).filter(([kind])=>!trained||kind==='Pothole'||kind==='Crack').map(([kind,color])=><span key={kind}><i style={{background:color}}/>{kind==='Uneven surface'?'Uneven patch':kind}</span>)}</div>
    {busy&&<p role="status" className="fine-print">{settings?.mode==='model'?'Running the trained detector on your photo…':'Finding visual candidates…'} The drive waits for this response.</p>}
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
