import {useEffect,useRef,useState} from 'react';
import type {MappedRoadsController} from '../hooks/useMappedRoads';
import type {AnalysisController} from '../hooks/useAnalysis';
import type {MappedSegment} from '../api/map';
import {RoadMapPanel} from './RoadMapPanel';
import {RoadSegmentEvidence} from './RoadSegmentEvidence';
import {Note,PanelTitle} from './UI';
import {downloadJson} from '../utils/formatters';
export function InspectionRoadNetwork({roads,analysis,onInspect,onOverview}:{roads:MappedRoadsController;analysis:AnalysisController;onInspect:()=>void;onOverview?:()=>void}){
 const [point,setPoint]=useState<{id:string;coordinates:[number,number]}|null>(null);
 const evidence=useRef<HTMLDivElement>(null);
 const segments=roads.network?.segments??[],segment=segments.find(s=>s.id===roads.selected);
 return <div className="page-enter"><div className="page-heading"><div><p className="eyebrow">REAL ROAD GEOMETRY · LOCAL INSPECTION EVIDENCE</p><h1>Road network<span className="heading-dot">.</span></h1><p>Search a location, select a road, and explicitly link your uploaded capture.</p></div><button className="button secondary" disabled={!roads.network} onClick={()=>downloadJson(roads.network,'inspection-road-network')}>Export network & evidence</button></div>
  <div className="workspace-note road-link-shortcut"><div><strong>{segment?'Selected road: '+segment.name:'Choose the road where your photo was taken'}</strong><p>{analysis.selected?'Current photo: '+analysis.selected.file.name+'. Confirm its location below before saving.':'Upload a road photo to add condition evidence to the map and overview.'}</p></div>{analysis.selected?<button className="button primary small" disabled={!segment} onClick={()=>evidence.current?.scrollIntoView({behavior:'smooth',block:'start'})}>Link photo to selected road</button>:<button className="button primary small" onClick={onInspect}>Upload a road photo</button>}</div>
  <RoadMapPanel roads={roads} onLocation={(id,coordinates)=>setPoint({id,coordinates})}/>
  <label className="field">Mapped road segment<select className="sim-select" value={roads.selected} onChange={e=>{roads.setSelected(e.target.value);setPoint(null)}}><option value="">Choose a segment</option>{segments.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id} · {s.inspection?'Inspection linked':'Not inspected'}</option>)}</select></label>
  <div className="network-detail-grid" ref={evidence}><RoadSegmentEvidence segment={segment}/>{segment?<LinkInspection key={segment.id} segment={segment} point={point?.id===segment.id?point.coordinates:undefined} roads={roads} analysis={analysis} onInspect={onInspect} onOverview={onOverview}/>:<section className="panel"><p>Load roads in the map view and select the segment containing your capture.</p></section>}</div>
  <Note>OSM supplies street names and geometry. Road quality comes only from linked detector evidence. Segments use stable consecutive OSM node pairs. Shared node IDs preserve real connections; apparent crossings can be bridges. No GPS is extracted or invented from the uploaded image.</Note>
 </div>;
}
function LinkInspection({segment,point,roads,analysis,onInspect,onOverview}:{segment:MappedSegment;point?:[number,number];roads:MappedRoadsController;analysis:AnalysisController;onInspect:()=>void;onOverview?:()=>void}){
 const middle=segment.coordinates[Math.floor(segment.coordinates.length/2)];
 const [latitude,setLatitude]=useState(String(point?.[0]??middle[1])),[longitude,setLongitude]=useState(String(point?.[1]??middle[0]));
 const [confirmed,setConfirmed]=useState(false),[reviewed,setReviewed]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{if(point){setLatitude(String(point[0]));setLongitude(String(point[1]));setConfirmed(false);setSaved(false)}},[point]);
 useEffect(()=>{setConfirmed(false);setReviewed(false);setSaved(false)},[analysis.qualityScore]);
 const lat=Number(latitude),lon=Number(longitude),valid=latitude.trim()!==''&&longitude.trim()!==''&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=85&&Math.abs(lon)<=180;
 const ready=!!analysis.selected&&!!analysis.qualityScore&&!!analysis.detection?.score_token&&analysis.qualityScore.snapshot_id===analysis.detection.score_token&&!analysis.qualityScoreBusy&&!analysis.detectionBusy;
 const saveHint=!analysis.selected?'Upload and review a road photo first.':analysis.detectionError||analysis.qualityScoreError?'Open Surface inspection to resolve the analysis error, then return here.':!ready?'Waiting for the current photo analysis to finish.':!valid?'Enter valid capture coordinates.':!confirmed?'Confirm that the photo belongs to this road to enable saving.':roads.busy?'Wait for the map request to finish before saving.':'';
 return <section className="panel"><PanelTitle title={segment.inspection?'Update linked inspection':'Link current inspection'}/>
  {analysis.selected?<><p><strong>{analysis.selected.file.name}</strong><br/>{analysis.qualityScore?analysis.qualityScore.score.toFixed(1)+' / 100 · Provisional':analysis.qualityScoreError||'Waiting for current detection and score…'}</p><p className="fine-print">Review detected outlines in Surface inspection before linking. The backend checks the original image hash and recalculates from its detection snapshot.</p></>:<p>Upload and analyze a road photo before assigning evidence.</p>}
  <button className="text-button" onClick={onInspect}>{analysis.selected?'Review current upload':'Upload a road photo'}</button>
  <div className="backend-controls"><label className="field">Capture latitude<input type="number" step="any" min="-85" max="85" value={latitude} onChange={e=>{setLatitude(e.target.value);setConfirmed(false);setSaved(false)}}/></label><label className="field">Capture longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={e=>{setLongitude(e.target.value);setConfirmed(false);setSaved(false)}}/></label></div>
  <p className="fine-print">Coordinates initially refer to a map point on the selected segment. Replace them with your capture location if known. They are not image-derived GPS. The server rejects points over 100 m from the selected segment.</p>
  <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);setSaved(false)}}/>I confirm this capture belongs to {segment.name} at the declared location.</label>
  <label className="check-label"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the candidate outlines and excluded false positives.</label>
  {saveHint&&<p className="fine-print" id="road-link-help">{saveHint}</p>}
  <button className="button primary" aria-describedby={saveHint?'road-link-help':undefined} disabled={!ready||!confirmed||!valid||roads.saving||roads.busy} onClick={()=>{setSaved(false);void roads.attach(analysis,[lat,lon],confirmed,reviewed).then(ok=>setSaved(ok))}}>{roads.saving?'Saving verified evidence link…':segment.inspection?'Update linked inspection':'Save inspection to this road'}</button>
  {saved&&<div className="inspection-saved"><p role="status">Inspection saved to {segment.name}. The overview now includes its score and candidates.</p>{onOverview&&<button className="button primary small" onClick={onOverview}>View updated overview</button>}</div>}{roads.saveError&&<p className="field-error" role="alert">{roads.saveError}</p>}
  <p className="fine-print">This saves an explicit snapshot and evidence previews locally. Later exclusions or reruns require updating the linked inspection. “Reviewed” records your review; the score remains provisional. One photo does not survey the whole segment.</p>
 </section>;
}
