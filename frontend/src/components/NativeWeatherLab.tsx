
import {useEffect,useRef,useState} from 'react';
import {compareWeather,evidenceUrl,weatherConditions} from '../api/weatherComparison';
import type {WeatherComparison,WeatherCondition,WeatherFrame} from '../api/weatherComparison';
import type {RoadQuad} from '../simulation/projection';
import {NativeEvidenceViewer} from './NativeEvidenceViewer';
import {downloadJson,number} from '../utils/formatters';
interface Props {capture:{file:File;url:string;width:number;height:number};quad:RoadQuad}
const metric=(v:number|null|undefined)=>v==null?'Not available':(v*100).toFixed(1)+'%';
export function NativeWeatherLab({capture,quad}:Props){
 const [condition,setCondition]=useState<WeatherCondition>('rain'),[intensity,setIntensity]=useState(50),[preprocessing,setPreprocessing]=useState(true);
 const [annotations,setAnnotations]=useState<string|undefined>(),[annotationName,setAnnotationName]=useState('');
 const [result,setResult]=useState<WeatherComparison|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [showLabels,setShowLabels]=useState(true),[aligned,setAligned]=useState(false),[showEffect,setShowEffect]=useState(false);
 const request=useRef<AbortController|null>(null),revision=useRef(0);
 const quadKey=JSON.stringify(quad);
 useEffect(()=>{setAnnotations(undefined);setAnnotationName('')},[capture.file]);
 useEffect(()=>{revision.current++;request.current?.abort();request.current=null;setBusy(false);setResult(null);setError('');return()=>{request.current?.abort()}},[capture.file,quadKey,intensity,preprocessing,annotations]);
 const run=async(all=false)=>{
   if(request.current)return;
   const controller=new AbortController();request.current=controller;const version=++revision.current;
   setBusy(true);setError('');setResult(null);
   try{
     const response=await compareWeather(capture.file,quad,all?Object.keys(weatherConditions) as WeatherCondition[]:[condition],intensity/100,preprocessing,annotations,controller.signal);
     if(version===revision.current&&!controller.signal.aborted)setResult(response);
   }catch(e){if(version===revision.current&&!controller.signal.aborted)setError((e as Error).message)}
   finally{if(version===revision.current){request.current=null;setBusy(false)}}
 };
 const cancel=()=>{revision.current++;request.current?.abort();request.current=null;setBusy(false)};
 const selectCondition=(value:WeatherCondition)=>{if(busy)cancel();setCondition(value)};
 const original=result?.frames.find(f=>f.condition==='original'),altered=result?.frames.find(f=>f.condition===condition);
 const load=async(file:File)=>{
   try{if(file.size>1_000_000)throw Error('Use an annotation JSON smaller than 1 MiB.');const text=await file.text();const a=JSON.parse(text);if(!Array.isArray(a))throw Error('Annotations must be a JSON array.');setAnnotations(text);setAnnotationName(file.name);setError('')}
   catch(e){setError((e as Error).message)}
 };
 return <section className="native-weather-lab" aria-label="Native-resolution weather comparison">
 <h3>Native-resolution weather evidence</h3><p className="input-help">The original file stays unchanged at {capture.width} × {capture.height}. Each synthetic condition is analyzed independently on native-size copies within your selected road outline. Detection and preprocessing do not replace, stretch or crop your source.</p>
 <div className="weather-options">{Object.entries(weatherConditions).map(([key,label])=><button key={key} className={'button small '+(condition===key?'primary':'secondary')} aria-pressed={condition===key} onClick={()=>selectCondition(key as WeatherCondition)}>{label}</button>)}</div>
 <label className="field">Effect intensity · {intensity}%<input aria-label="Native weather intensity" type="range" min="0" max="100" value={intensity} onChange={e=>setIntensity(Number(e.target.value))}/></label>
 <label className="checkbox-row"><input type="checkbox" checked={preprocessing} onChange={e=>setPreprocessing(e.target.checked)}/>CLAHE, edge-preserving denoising and raw-image verification</label>
 <div className="action-row"><button className="button primary" disabled={busy} onClick={()=>void run()}>Analyze original & altered images</button><button className="button secondary" disabled={busy} onClick={()=>void run(true)}>Analyze all seven conditions</button>{busy&&<button className="text-button" onClick={cancel}>Cancel weather analysis</button>}</div>
 {busy&&<p role="status" className="input-help"><span className="spinner"/> Independently analyzing native images and writing full-resolution evidence. Large captures and CPU models can take several minutes. Cancelling discards late results; server computation may already be running.</p>}
 {error&&<p role="alert" className="field-error">{error}</p>}
 <div className="native-weather-evidence">
 <NativeEvidenceViewer title="Original road" url={capture.url} width={capture.width} height={capture.height} defects={original?.defects??[]} showLabels={showLabels}/>
 {altered?<NativeEvidenceViewer title={aligned?weatherConditions[condition]+' detections mapped to original':weatherConditions[condition]+' altered road'} url={aligned?capture.url:evidenceUrl(altered.image_path)} width={altered.width} height={altered.height} defects={altered.defects} reference={aligned} showLabels={showLabels} maskUrl={showEffect&&!aligned?evidenceUrl(altered.effect_mask_path):undefined}/>:<div className="native-weather-placeholder">Run the comparison to display actual {weatherConditions[condition].toLowerCase()} evidence. No image or detection is substituted.</div>}
 </div>
 <div className="action-row"><label className="checkbox-row"><input type="checkbox" checked={showLabels} onChange={e=>setShowLabels(e.target.checked)}/>Show labels</label><label className="checkbox-row"><input type="checkbox" checked={aligned} onChange={e=>setAligned(e.target.checked)}/>Map condition detections onto original coordinates</label><label className="checkbox-row"><input type="checkbox" checked={showEffect} onChange={e=>setShowEffect(e.target.checked)}/>Show synthetic effect footprint</label><a className="text-button" href={capture.url} download={capture.file.name}>Download unchanged original file</a></div>
 {result&&<><p className="workspace-note">{original?.engine==='trained_yolo'?'Actual trained-model outputs':'OpenCV candidates · no trained detector is active'}. Confidence and visual severity are uncalibrated. Surface wear and patches marked “not assessed” need a suitable model; zero candidates never proves absence.</p>
 {altered&&original&&<><div className="measurement-grid native-weather-metrics"><Metric label="Defect candidates · original → condition" value={original.summary.count+' → '+altered.summary.count}/><Metric label="Mapped region pixels · original → condition" value={number(original.summary.affected_pixel_area,0)+' → '+number(altered.summary.affected_pixel_area,0)}/><Metric label="Visible road affected · original → condition" value={number(original.summary.visible_road_affected_percent,1)+'% → '+number(altered.summary.visible_road_affected_percent,1)+'%'}/><Metric label="Matched / missed / added detections" value={altered.changes.matched.length+' / '+altered.changes.missed.length+' / '+altered.changes.added.length}/></div>
 <p className="fine-print">{altered.summary.area_interpretation} New detections may be weather artifacts or baseline misses; missed detections may be obscured. Neither establishes a real physical road change.</p>
 <div className="table-scroll"><table><thead><tr><th>Type</th><th>Original</th><th>{weatherConditions[condition]}</th></tr></thead><tbody>{Object.keys(original.summary.by_type).map(kind=><tr key={kind}><th>{kind}</th><td>{original.summary.by_type[kind]??'Not assessed'}</td><td>{altered.summary.by_type[kind]??'Not assessed'}</td></tr>)}</tbody></table></div>
 <details open><summary>Added, missed and uncertain under {weatherConditions[condition].toLowerCase()}</summary><p className="fine-print">Added detections: {altered.changes.added.join(', ')||'None'}<br/>Missed original candidates: {altered.changes.missed.join(', ')||'None'}<br/>Preprocessing only: {altered.preprocessing.preprocessing_only.join(', ')||'None'}<br/>Raw-only detections lost after preprocessing: {altered.preprocessing.raw_only.join(', ')||'None'}</p>{altered.quality.flags.map(flag=><p className="fine-print" key={flag}>{flag}</p>)}</details>
 <div className="table-scroll"><table aria-label="Condition defect measurements"><thead><tr><th>Condition detection</th><th>Geometry / original-pixel area</th><th>Road %</th><th>Severity / confidence</th><th>Location and changes vs original</th><th>Uncertainty</th></tr></thead><tbody>{altered.defects.map(d=>{const match=altered.changes.matched.find(m=>m.condition_id===d.id);return <tr key={d.id}><td>{d.id}<br/>{d.kind}{d.detection_code?' · '+d.detection_code:''}</td><td>{d.geometry.replaceAll('_',' ')}<br/>{number(d.pixel_area,0)} px</td><td>{number(d.visible_road_percent,2)}%</td><td>{d.severity_label} · {number(d.severity,2)}<br/>{metric(d.confidence)} uncalibrated</td><td>{d.bbox_reference_px.map(v=>Math.round(v)).join(', ')}<br/>{match?match.original_id+'; Δ area '+number(match.pixel_area_change,0)+' px; Δ severity '+number(match.severity_change,2)+'; Δ confidence '+number(match.confidence_change*100,1)+' pp':'Added detection; genuine defect not confirmed'}</td><td>{d.uncertainty.join(' ')||'Consistent evidence; still requires review.'}</td></tr>})}</tbody></table></div>
 <a className="text-button" href={evidenceUrl(altered.image_path)} download={'road-'+condition+'-native.png'}>Download altered native image</a>
 </>}
 <details><summary>Original defect measurements</summary><div className="table-scroll"><table aria-label="Original defect measurements"><thead><tr><th>Detection / type</th><th>Original coordinates</th><th>Region area / visible road</th><th>Visual severity / confidence</th><th>Evidence</th></tr></thead><tbody>{original?.defects.map(d=><tr key={d.id}><td>{d.id}<br/>{d.kind}</td><td>{d.bbox_reference_px.map(Math.round).join(', ')}</td><td>{number(d.pixel_area,0)} px · {number(d.visible_road_percent,2)}%</td><td>{d.severity_label} · {number(d.severity,2)}<br/>{metric(d.confidence)} uncalibrated</td><td>{d.geometry.replaceAll('_',' ')}<br/>{d.uncertainty.join(' ')||'Review required'}</td></tr>)}</tbody></table></div></details>
 <h3>Known-annotation robustness</h3><p className="fine-print">{result.ground_truth_supplied?'Ground truth: '+(result.ground_truth_source??'User-supplied known annotations'):'No ground truth supplied. Precision, recall and F1 are unavailable; baseline agreement is not accuracy.'}</p>
 <p className="fine-print">One-to-one class-aware box IoU ≥ 0.50; undefined denominators remain unavailable. Bundled RDD annotations evaluate cracks and potholes only; other types are excluded, not assumed absent. These synthetic checks do not establish real-weather accuracy.</p>
 <div className="table-scroll"><table aria-label="Weather robustness metrics"><thead><tr><th>Condition</th><th>Engine</th><th>TP / FP / FN</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>{result.frames.map(f=><MetricRow key={f.condition} frame={f}/>)}</tbody></table></div>
 <details><summary>Metadata, coordinate mapping and limitations</summary><p className="fine-print">SHA-256: {result.metadata.sha256}<br/>Original file: {result.metadata.original_bytes} bytes · {result.metadata.format} · raw {result.metadata.raw_width} × {result.metadata.raw_height} · EXIF orientation {result.metadata.exif_orientation}. Coordinates refer to the upright original. Native PNG derivatives expire after {result.evidence_expires_seconds/60} minutes.</p><ul className="fine-print">{result.notice.map((n,i)=><li key={i}>{n}</li>)}</ul></details>
 <button className="button secondary" onClick={()=>downloadJson(result,'native-weather-comparison')}>Download comparison JSON</button>
 </>}
 <details className="native-annotation-input"><summary>Load known defect annotations for this exact capture</summary><p className="fine-print">JSON array: id, kind, polygon [[x,y],…], optional detection_code. Coordinates must be normalized in the EXIF-oriented original using x/(width−1), y/(height−1). Use independently labeled ground truth, never copied predictions. Exact bundled RDD2022 files can use their existing annotations automatically.</p><input type="file" accept=".json,application/json" aria-label="Known weather defect annotations" onChange={e=>{const f=e.target.files?.[0];if(f)void load(f);e.target.value=''}}/>{annotationName&&<span className="fine-print">{annotationName} <button className="text-button" onClick={()=>{setAnnotations(undefined);setAnnotationName('')}}>Clear annotations</button></span>}</details>
 </section>;
}
function Metric({label,value}:{label:string;value:string}){return <div className="measurement"><span>{label}</span><strong>{value}</strong></div>}
function MetricRow({frame}:{frame:WeatherFrame}){const m=frame.metrics;return <tr><th>{frame.condition}</th><td>{frame.engine==='trained_yolo'?'Trained model':'Unvalidated CV candidates'}</td><td>{m.available?m.tp+' / '+m.fp+' / '+m.fn:'No ground truth'}</td><td>{metric(m.precision)}</td><td>{metric(m.recall)}</td><td>{metric(m.f1)}</td></tr>}
