import {useState} from 'react';
import type {MappedRoadsController} from '../hooks/useMappedRoads';
import type {AnalysisController} from '../hooks/useAnalysis';
import type {Page} from '../types/api';
import {inspectionDate,repairPriorities,scoreTone,scoreColor} from '../network/analytics';
import {RoadMapPanel} from './RoadMapPanel';
import {RoadSegmentEvidence} from './RoadSegmentEvidence';
import {Badge,Note,PanelTitle} from './UI';
import {Icon} from './Icon';
export function InspectionDashboard({roads,analysis,onNavigate}:{roads:MappedRoadsController;analysis?:AnalysisController;onNavigate:(page:Page)=>void}){
 const [filter,setFilter]=useState('All roads');
 const segments=roads.network?.segments??[],summary=roads.network?.summary;
 const retained=segments.filter(s=>s.inspection),priorities=repairPriorities(segments);
 const visible=[...segments].sort((a,b)=>Number(!!b.inspection)-Number(!!a.inspection)).filter(s=>filter==='All roads'||(filter==='Not inspected'?!s.inspection:s.inspection?.score.rating===filter)).slice(0,3);
 const select=(id:string)=>{roads.setSelected(id);onNavigate('network')};
 const currentPhoto=analysis?.selected,currentScore=analysis?.qualityScore;
 const linkedPhoto=currentScore?segments.find(s=>s.inspection?.source_hash===currentScore.image.sha256):undefined;
 const ready=!!currentScore&&!analysis?.qualityScoreBusy&&!analysis?.detectionBusy;
 const analysisError=analysis?.detectionError||analysis?.qualityScoreError;
 const needsLink=!!currentPhoto&&!linkedPhoto;
 return <div className="page-enter">
  <div className="page-heading"><div><p className="eyebrow">YOUR INSPECTION WORKSPACE</p><h1>Roads at a glance<span className="heading-dot">.</span></h1><p>Real locations. Traceable inspections. Provisional condition estimates.</p></div><button className="button primary" onClick={()=>onNavigate('inspection')}><Icon name="plus" size={17}/>New inspection</button></div>
  <div className="workspace-note"><span><i className="dot good"/>Saved road inspections</span><p>{retained.length?'These results use photos saved to roads. Open a road card to view its evidence.':'No inspections saved yet. Upload a photo, review the detections, then save it to the correct road to fill this overview.'}</p><button className="text-button" disabled={roads.busy||roads.saving} onClick={()=>void roads.refresh()}>Refresh saved results<Icon name="refresh" size={13}/></button></div>
  {(!retained.length||needsLink)&&<section className="panel dashboard-setup" aria-labelledby="dashboard-setup-title">
   <div className="setup-heading"><div><p className="eyebrow">COMPLETE YOUR INSPECTION</p><h2 id="dashboard-setup-title">{currentPhoto?'Save your photo to its road':'Start with a road photo'}</h2><p>{currentPhoto?'A photo analysis appears in these totals after you confirm its location and save the inspection.':'The map supplies road locations. Your reviewed photos supply the condition scores.'}</p></div><button className="button primary" onClick={()=>onNavigate(currentPhoto?'network':'inspection')}>{currentPhoto?'Choose the correct road':'Upload a road photo'}<Icon name="arrow" size={15}/></button></div>
   {currentPhoto&&<div className="pending-inspection"><img src={currentPhoto.url} alt="Current road photo awaiting a saved road link"/><div><strong>{currentPhoto.file.name}</strong><p>{analysisError?'Analysis needs attention. Open Surface inspection to retry.':ready?`${currentScore!.summary.included_count} retained candidates · ${currentScore!.score.toFixed(1)} / 100 provisional score`:'Analyzing your photo… You can choose its road while this finishes.'}</p><button className="text-button" onClick={()=>onNavigate('inspection')}>{analysisError?'Open Surface inspection':'Review photo and detections'}<Icon name="arrow" size={13}/></button></div><Badge tone={ready?'lavender':'unknown'}>Not saved to a road</Badge></div>}
   <ol className="inspection-steps">
    <li><span className="step-number">1</span><div><h3>Upload and review</h3><p>Check the road outline and untick false detections.</p><button className="text-button" onClick={()=>onNavigate('inspection')}>{currentPhoto?'Review current photo':'Upload photo'}<Icon name="arrow" size={13}/></button></div></li>
    <li><span className="step-number">2</span><div><h3>Choose its real road</h3><p>Search the capture location and select a road outline on the map.</p><button className="text-button" onClick={()=>onNavigate('network')}>Open road map<Icon name="arrow" size={13}/></button></div></li>
    <li><span className="step-number">3</span><div><h3>Confirm and save</h3><p>Confirm the capture location, then press “Save inspection to this road.” These totals update immediately.</p></div></li>
   </ol>
  </section>}
  <div className="stats-grid">
   <article className="stat-card"><div className="stat-label">Average road quality<Icon name="scan" size={16}/></div><div className="stat-value">{summary?.average_quality==null?'—':summary.average_quality.toFixed(1)}<small>/ 100</small></div><span className="stat-foot">{retained.length?'Length-weighted · inspected segments only · provisional':'Save an inspection to calculate the average'}</span></article>
   <article className="stat-card"><div className="stat-label">Detected candidates<Icon name="layers" size={16}/></div><div className="stat-value">{summary?.defect_count??'—'}<small>candidates</small></div><span className="stat-foot">{retained.length?'Latest linked image per inspected segment':'Candidates from saved road inspections appear here'}</span></article>
   <article className="stat-card"><div className="stat-label">Segments with evidence<Icon name="road" size={16}/></div><div className="stat-value">{summary?.inspected_segments??0}<small>/ {summary?.segment_count??0}</small></div><span className="stat-foot">{summary?.represented_length_percent.toFixed(1)??'0'}% of mapped length represented; not surveyed coverage</span></article>
   <article className="stat-card"><div className="stat-label">Needs review<Icon name="warning" size={16}/></div><div className="stat-value">{summary?.inspected_segments?summary.needs_attention:'—'}<small>segments</small></div><span className="stat-foot">Provisional score below 55</span></article>
  </div>
  <section className="inspection-section"><PanelTitle title="Inspection overview"><label className="select-wrap"><span className="sr-only">Filter inspection condition</span><select value={filter} onChange={e=>setFilter(e.target.value)}>{['All roads','Not inspected','Excellent','Good','Fair','Poor','Critical'].map(x=><option key={x}>{x}</option>)}</select></label></PanelTitle>
   <div className="inspection-cards">{visible.map((s,index)=><button key={s.id} className={'inspection-card '+(s.id===roads.selected?'featured':'')} onClick={()=>select(s.id)}>
    <div className="card-top">{s.inspection?<img className="inspection-thumb" src={s.inspection.outlined_preview} alt="Road inspection evidence"/>:<span className={'road-avatar avatar-'+index}><Icon name="road" size={25}/></span>}<span className="round-arrow"><Icon name="diagonal" size={17}/></span></div>
    <p className="eyebrow">OSM {s.osm_way_id} · {(s.length_m/1000).toFixed(2)} km</p><h3>{s.name}</h3><p className="card-locality">{s.inspection?inspectionDate(s.inspection.analyzed_at):'No capture linked'}</p>
    <div className="card-footer"><Badge tone={scoreTone(s.inspection?.score.score)}>{s.inspection?s.inspection.score.rating+' · provisional':'Not inspected'}</Badge>{s.inspection&&<><span>{s.inspection.score.summary.included_count} candidates</span><strong>{s.inspection.score.score.toFixed(1)}<small>/100</small></strong></>}</div>
   </button>)}</div>
   {!visible.length&&<p className="dashboard-empty">{roads.busy?'Loading your road network…':segments.length?'No roads match this filter.':'Load a real road area below, then upload and link an inspection. No sample scores are substituted.'}</p>}
   <div className="inspection-list-footer"><span>{visible.length} of {segments.length} loaded road segments shown</span><button className="text-button" onClick={()=>onNavigate('network')}>View all roads and link inspections<Icon name="arrow" size={14}/></button></div>
  </section>
  <div className="overview-bottom"><RoadMapPanel roads={roads} compact/>
   <section className="panel condition-panel"><PanelTitle title="Condition profile" eyebrow="INSPECTED SEGMENTS ONLY"/><div className="profile-summary"><strong>{summary?.average_quality?.toFixed(1)??'—'}<small>/100</small></strong><p>Average quality<br/><span>Weighted by mapped segment length</span></p></div>
    {retained.length?<div className="real-score-chart" aria-label="Scores of inspected road segments">{retained.map(s=><button key={s.id} className="score-chart-row" onClick={()=>select(s.id)} aria-label={s.name+', score '+s.inspection!.score.score}><span title={s.name}>{s.name}</span><i><b style={{width:s.inspection!.score.score+'%',background:scoreColor(s.inspection!.score.score)}}/></i><strong>{s.inspection!.score.score.toFixed(1)}</strong></button>)}</div>:<p className="dashboard-empty">No inspection-backed scores yet. Unknown roads are not assigned zero or a sample grade.</p>}
    {summary&&!summary.comparable_configurations&&<Note tone="warning">Scoring settings differ between inspections. The network average is withheld until the inspections use a consistent configuration.</Note>}
    {retained.length>0&&<div className="defect-count-breakdown"><h3>Observed candidates</h3>{Object.entries(summary?.by_type??{}).map(([kind,count])=><span key={kind}>{kind}<strong>{count}</strong></span>)}<p className="fine-print">Severity: {summary?.by_severity.Low??0} low · {summary?.by_severity.Moderate??0} moderate · {summary?.by_severity.High??0} high. Unsupported classes remain unassessed.</p></div>}
    <div className="condition-footer"><span>{summary?.not_inspected_segments??0} roads not inspected</span><button className="text-button" onClick={()=>onNavigate('planner')}>Review repairs<Icon name="arrow" size={15}/></button></div>
   </section></div>
  <div className="network-detail-grid"><RoadSegmentEvidence segment={segments.find(s=>s.id===roads.selected)}/>
   <section className="panel"><PanelTitle title="Repair review priorities" eyebrow="FROM LINKED DETECTIONS"/>{priorities.length?<ol className="repair-priorities">{priorities.slice(0,5).map(s=><li key={s.id}><button className="text-button" onClick={()=>select(s.id)}>{s.name}<strong>{s.inspection!.score.score.toFixed(1)} / 100</strong></button><p className="fine-print">{s.inspection!.score.summary.included_count} candidates · {s.inspection!.score.summary.affected_road_percent.toFixed(1)}% of visible road affected · {s.inspection!.score.summary.by_severity.High??0} high severity</p></li>)}</ol>:<p>No repair priorities can be derived until defect evidence is linked. A missing detection does not establish a safe road.</p>}
    <p className="fine-print">Priorities sort by provisional condition score, then high-severity candidate count. Review evidence before authorizing work.</p>
   </section></div>
  <details className="panel map-methodology"><summary>Score methodology and network coverage</summary><p>{summary?.methodology??'Unknown roads are excluded from quality averages. No evidence means no condition score.'}</p><p>Each image score starts at 100 and deducts weighted area, hotspot and distribution penalties using defect type, confidence, estimated severity and location. Overlapping pixels use the strongest penalty. The formula is not calibrated against independent expert road-condition ratings. Road length does not establish how much surface a photo shows.</p></details>
 </div>;
}
