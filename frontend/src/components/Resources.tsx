import { useState } from 'react';
import { BackendEvaluationTool } from './BackendEvaluation';
import { Badge, EmptyState, Note, PanelTitle } from './UI';
import { Icon } from './Icon';
import { downloadJson, number, percent } from '../utils/formatters';
interface EvaluationReport {
  dataset: string; precision: number; recall: number; f1: number; map: number;
  labels: string[]; confusion: number[][]; counts: number[];
  pr: { recall: number; precision: number }[];
}
const sampleReport:EvaluationReport={
  dataset:'Synthetic report layout — not an evaluated model',precision:.83,recall:.76,f1:.793,map:.71,
  labels:['Pothole','Crack','Ravelling','Patch'],confusion:[[22,2,1,0],[3,19,2,1],[0,2,18,3],[1,0,2,21]],counts:[25,25,23,24],
  pr:[{recall:0,precision:1},{recall:.2,precision:.97},{recall:.4,precision:.91},{recall:.6,precision:.85},{recall:.8,precision:.67},{recall:1,precision:.25}],
};
function validateReport(value:unknown):value is EvaluationReport{
  if(typeof value!=='object'||!value)return false;
  const v=value as Record<string,unknown>;
  const metric=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
  const count=(n:unknown)=>typeof n==='number'&&Number.isInteger(n)&&n>=0;
  if(typeof v.dataset!=='string'||!['precision','recall','f1','map'].every(k=>metric(v[k])))return false;
  if(!Array.isArray(v.labels)||!v.labels.length||v.labels.length>12||!v.labels.every(x=>typeof x==='string'))return false;
  const size=v.labels.length;
  return Array.isArray(v.confusion)&&v.confusion.length===size&&v.confusion.every(row=>Array.isArray(row)&&row.length===size&&row.every(count))&&
    Array.isArray(v.counts)&&v.counts.length===size&&v.counts.every(count)&&
    Array.isArray(v.pr)&&v.pr.length>=2&&v.pr.every(p=>p&&typeof p==='object'&&metric(p.recall)&&metric(p.precision));
}
export function Evaluation(){
  const [report,setReport]=useState<EvaluationReport|null>(null);
  const [demo,setDemo]=useState(false);
  const [error,setError]=useState('');
  const importFile=async(file:File)=>{
    setError('');
    if(file.size>100000){setError('Evaluation reports must be smaller than 100 KB.');return}
    try{const data:unknown=JSON.parse(await file.text());if(!validateReport(data))throw new Error('Report format is invalid. Use the downloadable schema example.');setReport(data);setDemo(false)}catch(e){setError((e as Error).message)}
  };
  return <div className="page-enter"><div className="page-heading"><div><p className="eyebrow">MODEL EVALUATION</p><h1>Model evaluation<span className="heading-dot">.</span></h1><p>Inspect evaluation data from a held-out, labeled dataset.</p></div><label className="button primary file-button"><Icon name="upload" size={16}/>Import evaluation JSON<input type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importFile(f)}}/></label></div>
    <Note>Import an independently generated report, or calculate detection metrics from raw ground truth and predictions below. A loaded model and an experimental score do not establish validated accuracy.</Note>
    <BackendEvaluationTool onCalculated={value=>{setReport(value);setDemo(false)}}/>
    {error&&<p className="field-error" role="alert">{error}</p>}
    {!report?<section className="panel"><EmptyState icon="chart" title="No evaluation dataset connected" description="Precision, recall, F1, mAP, a confusion matrix, and class distribution need real labeled test results. Import your report or explore an explicitly synthetic example." action={<div className="action-row"><button className="button secondary" onClick={()=>{setReport(sampleReport);setDemo(true)}}>View synthetic example</button><button className="text-button" onClick={()=>downloadJson({...sampleReport,schema_note:'Replace every value with your real evaluation results. Rows are actual classes; columns are predicted classes. map is a fraction; record your IoU definition in the dataset description.'},'evaluation-schema-example')}>Download format example<Icon name="download" size={15}/></button></div>}/></section>:<>
      <div className="workspace-note"><span><i className={'dot '+(demo?'lavender':'good')}/>{demo?'Synthetic evaluation example':'Imported report · user supplied'}</span><p>{report.dataset}</p><button className="text-button" onClick={()=>setReport(null)}>Clear report<Icon name="close" size={15}/></button></div>
      <div className="stats-grid">{([['Precision',report.precision],['Recall',report.recall],['F1 score',report.f1],['mAP',report.map]] as const).map(([label,value])=><div key={label} className="stat-card"><span className="stat-label">{label}</span><strong className="stat-value">{percent(value)}</strong><span className="stat-foot">{demo?'Illustrative value':'From imported evaluation report'}</span></div>)}</div>
      <div className="overview-bottom"><section className="panel"><PanelTitle title="Precision–recall curve"/><svg className="evaluation-curve" viewBox="0 0 400 250" role="img" aria-label="Precision recall curve from the loaded report"><path d="M40 15V210H380" stroke="#b7b6a8" fill="none"/>{[0,.25,.5,.75,1].map(v=><g key={v}><path d={'M40 '+(210-v*185)+'H380'} stroke="#e2e1d5" strokeDasharray="3 5"/><text x="20" y={214-v*185} fontSize="10" fill="#6e6d60">{v}</text><text x={40+v*330} y="228" fontSize="10" fill="#6e6d60">{v}</text></g>)}<polyline points={[...report.pr].sort((a,b)=>a.recall-b.recall).map(p=>(40+p.recall*330)+','+(210-p.precision*185)).join(' ')} fill="none" stroke="#8c829d" strokeWidth="3"/><text x="185" y="247" fontSize="11" fill="#6e6d60">Recall</text></svg><p className="fine-print">Precision on the vertical axis, recall on the horizontal axis. IoU thresholds and averaging definitions must be documented by the report producer.</p></section>
      <section className="panel"><PanelTitle title="Class distribution"/>{report.labels.map((label,i)=><div className="distribution-row" key={label}><span>{label}</span><div><i style={{width:(report.counts[i]/Math.max(...report.counts,1)*100)+'%'}}/></div><strong>{report.counts[i]}</strong></div>)}</section></div>
      <section className="panel"><PanelTitle title="Confusion matrix"><Badge>{demo?'Synthetic data':'Imported counts'}</Badge></PanelTitle><div className="table-scroll"><table className="confusion-table"><thead><tr><th>Actual ↓ / Predicted →</th>{report.labels.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{report.confusion.map((row,i)=><tr key={i}><th>{report.labels[i]}</th>{row.map((v,j)=><td key={j} style={{background:i===j?'rgba(161,175,141,'+(0.2+v/Math.max(...report.confusion.flat(),1)*.45)+')':undefined}}>{v}</td>)}</tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
export function Materials(){
  const [id,setId]=useState('');
  const [mass,setMass]=useState('');
  const [metal,setMetal]=useState('');
  const [loose,setLoose]=useState('');
  const [error,setError]=useState('');
  const [result,setResult]=useState<{id:string;mass:number;metal:number;loose:number}|null>(null);
  const change=(set:(v:string)=>void,v:string)=>{set(v);setResult(null);setError('')};
  return <div className="page-enter"><div className="page-heading"><div><p className="eyebrow">MATERIAL SAMPLE RECORD</p><h1>Material samples<span className="heading-dot">.</span></h1><p>A separate workflow for measurements supplied by your lab.</p></div></div><Note>Ordinary road imagery cannot verify metal content or material composition. These ratios use your manually supplied sample measurements. No composition is inferred from a photograph.</Note>
    <div className="material-layout"><section className="panel"><PanelTitle title="Sample measurements" eyebrow="USER-SUPPLIED LAB INPUT"/><form onSubmit={e=>{e.preventDefault();const m=Number(mass),me=Number(metal),l=Number(loose);if(!id.trim()||!mass.trim()||!metal.trim()||!loose.trim()||![m,me,l].every(Number.isFinite)||m<=0||me<0||l<0||me>m||l>m){setError('Enter a sample ID, positive total mass, and measured component masses from 0 to the total mass.');return}setResult({id:id.trim(),mass:m,metal:me,loose:l});setError('')}}>
      <label className="field" htmlFor="sample-id">Sample identifier</label><input id="sample-id" value={id} onChange={e=>change(setId,e.target.value)} placeholder="e.g. LAB-2026-014"/>
      {([['sample-mass','Total dry sample mass (g)',mass,setMass],['metal-mass','Separated metallic fraction mass (g)',metal,setMetal],['loose-mass','Loose aggregate fraction mass (g)',loose,setLoose]] as const).map(([name,label,value,set])=><div key={name}><label className="field" htmlFor={name}>{label}</label><input id={name} type="number" min="0" step="any" value={value} onChange={e=>change(set,e.target.value)} placeholder="Measured in grams"/></div>)}<button className="button primary full-width" type="submit">Calculate measured fractions<Icon name="arrow" size={16}/></button>{error&&<p className="field-error" role="alert">{error}</p>}</form></section>
      <section className="panel">{result?<><PanelTitle title={result.id}><Badge>User-supplied measurements</Badge></PanelTitle><div className="measurement-grid"><div className="measurement"><span>Total dry mass</span><strong>{number(result.mass)} g</strong></div><div className="measurement"><span>Metallic mass fraction</span><strong>{percent(result.metal/result.mass)}</strong></div><div className="measurement"><span>Loose aggregate mass fraction</span><strong>{percent(result.loose/result.mass)}</strong></div></div><Note>Ratios depend on your separation and measurement procedure. Metallic and loose fractions may overlap; they are not summed. No road grade is calculated.</Note><button className="button secondary" onClick={()=>downloadJson({source:'User-supplied laboratory measurements',...result,metallic_mass_fraction:result.metal/result.mass,loose_aggregate_mass_fraction:result.loose/result.mass,validated:false},'material-sample')}><Icon name="download" size={15}/>Export record</button></>:<EmptyState title="Your measured fractions" description="Enter the sample masses to calculate ratios. Binder adhesion, friction, and water resistance require their own tests and remain unavailable." icon="flask"/>}</section></div>
  </div>;
}
