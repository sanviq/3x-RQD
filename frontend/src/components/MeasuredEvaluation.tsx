import {useEffect,useState} from 'react';
import {request} from '../api/client';
import {Badge,Note,PanelTitle} from './UI';
import {downloadJson} from '../utils/formatters';
type Metrics={images:number;checkpoint_sha256:string;ultralytics_metrics:Record<string,number>;diagnostic:{precision:number;recall:number;f1:number;confidence:number;tp:number;fp:number;fn:number};per_class_metrics:Record<string,{precision:number;recall:number;f1:number;map50:number;map50_95:number}>};
type Report={run:string;test:Metrics;validation:Metrics;baseline?:Metrics;activation:Record<string,unknown>;release_url:string};
type Progress={heartbeat_stale?:boolean;estimated_training_seconds_remaining?:number;latest_validation?:{epoch:number;precision:number;recall:number;map50:number;map50_95:number};phase:string;completed_epochs?:number;target_epochs?:number;collected_images?:number;target_images?:number;notice?:string};
export function MeasuredEvaluation(){
 const [report,setReport]=useState<Report|null>(null),[progress,setProgress]=useState<Progress|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const c=new AbortController();let pending=false;
  const update=async()=>{
   if(pending||c.signal.aborted)return;pending=true;
   try{
    const results=await Promise.allSettled([request('/research/training-status',{signal:c.signal}),request('/research/model-evaluation',{signal:c.signal})]);
    if(c.signal.aborted)return;
    if(results[0].status==='fulfilled')setProgress(results[0].value as Progress);
    if(results[1].status==='fulfilled'){setReport(results[1].value as Report);setError('')}
    else setError((results[1].reason as Error).message);
   }finally{pending=false}
  };
  void update();const timer=window.setInterval(()=>void update(),30000);
  return()=>{c.abort();window.clearInterval(timer)};
 },[]);
 const percent=(n:number)=>(n*100).toFixed(1)+'%';
 return <section className="panel"><PanelTitle title="Measured RDD2022 evaluation" eyebrow="REAL LABELLED HOLDOUT"><Badge>{report?.run??'Loading…'}</Badge></PanelTitle>
 {progress&&<p role="status">Local improvement job: {progress.phase.replaceAll('_',' ')}{progress.completed_epochs!=null?' · '+progress.completed_epochs+' / '+progress.target_epochs+' epochs':''}{progress.collected_images!=null?' · '+progress.collected_images+' / '+progress.target_images+' images':''}. {progress.notice}</p>}
 {progress?.heartbeat_stale&&!['complete','failed','not_running','status_unavailable'].includes(progress.phase)&&<Note tone="warning">Training status has not updated recently. The process may be paused or stopped; the last saved epoch is shown.</Note>}
 {progress?.latest_validation&&<div aria-label="Interim training validation">
 <h3>Current run · interim validation, epoch {progress.latest_validation.epoch}</h3>
 <p>Precision {percent(progress.latest_validation.precision)} · Recall {percent(progress.latest_validation.recall)} · mAP@.50 {percent(progress.latest_validation.map50)} · mAP@.50:.95 {percent(progress.latest_validation.map50_95)}</p>
 <p className="fine-print">These are training-time validation metrics at Ultralytics' operating point. They can fluctuate between epochs and are separate from final test results below. Higher confidence thresholds may reduce false positives while also missing more defects.</p>
 {progress.estimated_training_seconds_remaining!=null&&<p className="fine-print">Estimated training time remaining: about {Math.ceil(progress.estimated_training_seconds_remaining/60)} minutes, based on recent completed epochs. Evaluation time is additional; pauses and early stopping can change this estimate.</p>}
 </div>}
 {error&&<p role="alert">{error}</p>}
 {report&&<><h3>Published results · {report.run}</h3><Note>Real internal held-out results, separate from the synthetic charts and user-supplied reports below. This is detection performance on a class-enriched subset, not a validated road-health grade. A failed detector is not activated automatically.</Note>
 <div className="table-scroll"><table><thead><tr><th>Split</th><th>Images</th><th>Precision*</th><th>Recall*</th><th>F1*</th><th>mAP@.50</th><th>mAP@.50:.95</th></tr></thead><tbody>{([['Validation',report.validation],['Held-out test',report.test],...(report.baseline?[['Previous detector · same test',report.baseline]]:[])] as [string,Metrics][]).map(([name,r])=><tr key={name}><th>{name}</th><td>{r.images}</td><td>{percent(r.diagnostic.precision)}</td><td>{percent(r.diagnostic.recall)}</td><td>{r.diagnostic.f1.toFixed(3)}</td><td>{percent(r.ultralytics_metrics['metrics/mAP50(B)'])}</td><td>{percent(r.ultralytics_metrics['metrics/mAP50-95(B)'])}</td></tr>)}</tbody></table></div>
 <p className="fine-print">*Precision, recall and F1 use explicit confidence thresholds: validation {report.validation.diagnostic.confidence}, test {report.test.diagnostic.confidence}{report.baseline?', previous detector '+report.baseline.diagnostic.confidence:''}; matching IoU .50. AP uses full confidence rankings. Test: {report.test.diagnostic.tp} true positives, {report.test.diagnostic.fp} false positives, {report.test.diagnostic.fn} missed labels.</p>
 <h3>Per-class held-out test results</h3><div className="table-scroll"><table><thead><tr><th>Class</th><th>AP@.50</th><th>AP@.50:.95</th><th>Precision†</th><th>Recall†</th></tr></thead><tbody>{Object.entries(report.test.per_class_metrics).map(([name,r])=><tr key={name}><th>{name}</th><td>{percent(r.map50)}</td><td>{percent(r.map50_95)}</td><td>{percent(r.precision)}</td><td>{percent(r.recall)}</td></tr>)}</tbody></table></div><p className="fine-print">†Per-class precision and recall follow Ultralytics' selected operating point and differ from the explicit-threshold diagnostics above.</p>
 <details><summary>Activation decision and evaluated checkpoint</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(report.activation,null,2)}</pre><p className="fine-print">SHA256: {report.test.checkpoint_sha256}</p></details>
 <div className="action-row"><a className="text-button" href={report.release_url} target="_blank" rel="noreferrer">Download weights, PR curves, confusion matrices and error examples</a><button className="text-button" onClick={()=>downloadJson(report,'measured-rdd-evaluation')}>Export measured results</button></div></>}
 </section>;
}
