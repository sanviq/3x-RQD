import {useEffect,useRef,useState} from 'react';
import {request} from '../api/client';
import {downloadJson,number} from '../utils/formatters';
import {Badge,Note,PanelTitle} from './UI';
type Review={saved:boolean;count:number;defects:number;declared_distance_m:number;notice:string;records:{id:string;name:string;latitude:number;longitude:number;provenance:string;defects:number}[]};
const template={instructions:'FORMAT ONLY. Replace nulls and labels with actual inspection data; keep normalized defect boxes and actual provenance. No measurements or GPS are supplied by this template.',segments:[{id:'REPLACE_WITH_UNIQUE_SEGMENT_ID',name:'REPLACE_WITH_ROAD_NAME',latitude:null,longitude:null,distance_start_m:null,length_m:null,width_m:7,provenance:'REPLACE_WITH_model_OR_manual',assessment:{width:960,height:640,mm_per_pixel:null,inclination:{source:'unavailable'},defects:[],repaired:[],config:{}},evidence:{},capture_notes:'Replace with capture date, source and inspection notes. Fill defects with actual annotations; an empty list is not evidence that a road is healthy.'}]};
export function SurveyImport({onImported}:{onImported:()=>void}){
 const [text,setText]=useState(''),[review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState('');
 const controller=useRef<AbortController|null>(null),revision=useRef(0);
 useEffect(()=>()=>{revision.current++;controller.current?.abort()},[]);
 const change=(value:string)=>{revision.current++;controller.current?.abort();setBusy(false);setText(value);setReview(null);setError('');setSaved('')};
 const read=async(file:File)=>{const version=++revision.current;setReview(null);setSaved('');setError('');try{if(file.size>10*1024*1024)throw Error('Survey JSON must be at most 10 MiB.');const value=await file.text();if(version===revision.current)change(value)}catch(e){if(version===revision.current)setError((e as Error).message)}};
 const submit=async(save:boolean)=>{
  if(busy)return;setError('');setSaved('');setBusy(true);const c=new AbortController();controller.current=c;
  try{
   if(new Blob([text]).size>10*1024*1024)throw Error('Survey JSON must be at most 10 MiB.');
   let data:unknown;try{data=JSON.parse(text)}catch{throw Error('Enter valid JSON or choose a survey JSON file.')}
   const value=await request(save?'/segments/import':'/segments/import/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:c.signal}) as Review;
   if(c.signal.aborted)return;
   if(save){setReview(null);setText('');setSaved(value.count+' inspection records saved locally.');onImported()}else setReview(value);
  }catch(e){if(!c.signal.aborted){setError((e as Error).message);if(save)setReview(null)}}finally{if(!c.signal.aborted)setBusy(false)}
 };
 return <section className="panel"><PanelTitle title="Import GPS inspection records" eyebrow="LIVE WORKSPACE · EXPLICIT LOCAL SAVE"><Badge>Real records only</Badge></PanelTitle>
 <Note>Import your team's inspection JSON or a previous “Export local survey” file containing model/manual records. Review first, then save locally. Demo roads stay in Demo workspace; existing record IDs are never overwritten.</Note>
 <label className="field">GPS inspection JSON file<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void read(file);e.currentTarget.value=''}}/></label>
 <label className="field">GPS inspection JSON<textarea value={text} disabled={busy} onChange={e=>change(e.target.value)} rows={5} maxLength={10*1024*1024} placeholder='{"segments": [...]}' style={{width:'100%',fontFamily:'monospace'}}/></label>
 <p className="fine-print">Up to 200 total local records and 10 MiB per import. Each record needs a unique ID, road name, latitude, longitude, declared distance/length, actual defect annotations and model/manual provenance. Coordinates are WGS84 degrees; defect boxes are normalized x1,y1,x2,y2. Geometry-only GeoJSON belongs in Road network → Your connected network.</p>
 <div className="action-row"><button className="button secondary" disabled={busy||!text.trim()} onClick={()=>void submit(false)}>{busy?'Checking records…':'Preview import'}</button><button className="text-button" onClick={()=>downloadJson(template,'gps-inspection-IMPORT-FORMAT')}>Download inspection JSON format</button></div>
 {error&&<p role="alert" className="field-error">{error}</p>}
 {review&&<><h3>Review {review.count} inspection records</h3><p>{review.defects} annotated defects · {number(review.declared_distance_m/1000,2)} km declared length</p><div className="table-scroll"><table><thead><tr><th>ID / road</th><th>GPS</th><th>Source</th><th>Defects</th></tr></thead><tbody>{review.records.map(r=><tr key={r.id}><th>{r.id} · {r.name}</th><td>{r.latitude}, {r.longitude}</td><td>{r.provenance}</td><td>{r.defects}</td></tr>)}</tbody></table></div><Note>{review.notice}</Note><button className="button primary" disabled={busy} onClick={()=>void submit(true)}>Save {review.count} records locally</button></>}
 {saved&&<p role="status">{saved}</p>}
 </section>;
}
