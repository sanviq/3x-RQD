import {useState} from 'react';
import type {MappedSegment} from '../api/map';
import {inspectionDate,scoreTone} from '../network/analytics';
import {Badge,Note,PanelTitle} from './UI';
export function RoadSegmentEvidence({segment}:{segment:MappedSegment|undefined}){
 const [view,setView]=useState<'outlined_preview'|'original_preview'>('outlined_preview');
 if(!segment)return <section className="panel"><PanelTitle title="Segment inspection"/><p>Select a mapped road to view its location and evidence.</p></section>;
 const inspection=segment.inspection,score=inspection?.score,xy=segment.coordinates[Math.floor(segment.coordinates.length/2)];
 return <section className="panel segment-evidence"><PanelTitle title={segment.name} eyebrow="SELECTED ROAD SEGMENT"><Badge tone={scoreTone(score?.score)}>{score?score.score.toFixed(1)+' / 100 · '+score.rating:'Not inspected'}</Badge></PanelTitle>
  <p className="fine-print">{segment.id} · {(segment.length_m/1000).toFixed(2)} km · {segment.highway.replaceAll('_',' ')}<br/>{xy[1].toFixed(6)}, {xy[0].toFixed(6)} · <a href={'https://www.openstreetmap.org/way/'+segment.osm_way_id} target="_blank" rel="noreferrer">View OSM road</a></p>
  {!inspection||!score?<Note>No inspection evidence is linked to this segment. Map geometry supplies its location, not its pavement quality.</Note>:<>
   <div className="evidence-meta"><Badge tone="lavender">Provisional score</Badge><Badge>{inspection.review_status==='user_reviewed'?'User reviewed':'Awaiting human review'}</Badge></div>
   <p>Analyzed {inspectionDate(inspection.analyzed_at)}<br/><small>Declared capture: {inspection.latitude.toFixed(6)}, {inspection.longitude.toFixed(6)}</small></p>
   <div className="segmented preview-tabs"><button className={view==='outlined_preview'?'active':''} onClick={()=>setView('outlined_preview')}>Detected regions</button><button className={view==='original_preview'?'active':''} onClick={()=>setView('original_preview')}>Original preview</button></div>
   <img className="segment-photo" src={inspection[view]} alt={view==='outlined_preview'?'Uploaded road with detected regions outlined':'Unannotated uploaded-road preview'}/>
   <p className="fine-print">Preview from {inspection.source_width} × {inspection.source_height} source pixels. Source-image hash checked against backend detection evidence. This verifies the evidence link, not detection accuracy or GPS.</p>
   <div className="measurement-grid"><div className="measurement"><span>Retained candidates</span><strong>{score.summary.included_count}</strong></div><div className="measurement"><span>Visible road affected</span><strong>{score.summary.affected_road_percent.toFixed(1)}%</strong></div><div className="measurement"><span>Estimated severity</span><strong>{score.summary.by_severity.High??0} high</strong></div></div>
   <div className="score-explanation">{score.components.map(c=><div key={c.id}><span>{c.label}</span><strong>−{c.points.toFixed(1)}</strong></div>)}</div>
   <details><summary>Method and uncertainty</summary><p>{inspection.scope}</p><p>100 minus area, hotspot, and spread penalties. Defect type, visual severity, confidence and location affect each deduction. Overlap uses the strongest penalty, not repeated addition.</p><p>{inspection.detector_method==='opencv_multiscale_contours'?'OpenCV appearance candidates require review.':'Road-model predictions remain uncalibrated.'}</p><ul>{score.uncertainty.map((text,i)=><li key={i}>{text}</li>)}</ul><code>{inspection.source_hash}</code></details>
  </>}
 </section>;
}
