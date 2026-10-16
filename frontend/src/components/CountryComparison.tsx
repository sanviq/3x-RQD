import {useEffect,useState} from 'react';
import {request} from '../api/client';
import {Badge,Note,PanelTitle} from './UI';
import {downloadJson} from '../utils/formatters';
type Row={subset:string;images:number;annotation_counts:Record<string,number>;annotation_boxes_per_image:number;mean_box_union_image_fraction:number;small_box_fraction:number;mean_original_megapixels:number;detection_evaluation:{images:number;precision:number;recall:number;f1:number}|null};
type Report={images:number;rows:Row[];notice:string;coverage_method:string;evaluation_split:string|null;needed_for_country_quality_comparison:string[]};
export function CountryComparison(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();void request('/dataset/comparison',{signal:c.signal}).then(r=>setReport(r as Report)).catch(e=>{if(!c.signal.aborted)setError((e as Error).message)});return()=>c.abort()},[]);
 return <section className="panel"><PanelTitle title="Compare real country samples" eyebrow="RDD2022 RESEARCH"><Badge>Sample comparison</Badge></PanelTitle>
 <Note>These samples can show differences in visible annotations and detector performance. They cannot establish which country has better roads or explain why.</Note>
 {error&&<p role="alert">{error}</p>}{!report&&!error&&<p>Loading dataset summary…</p>}
 {report&&<><p>{report.images.toLocaleString()} real labelled images · D00 longitudinal crack · D10 transverse crack · D20 alligator crack · D40 pothole</p>
 <div className="table-scroll"><table><thead><tr><th>Country / capture</th><th>Images</th><th>D00</th><th>D10</th><th>D20</th><th>D40</th><th>Boxes / image</th><th>Box coverage*</th><th>Small boxes</th><th>Original MP</th></tr></thead><tbody>{report.rows.map(r=><tr key={r.subset}><th>{r.subset.replaceAll('_',' ')}</th><td>{r.images}</td>{['D00','D10','D20','D40'].map(c=><td key={c}>{r.annotation_counts[c]}</td>)}<td>{r.annotation_boxes_per_image.toFixed(2)}</td><td>{(r.mean_box_union_image_fraction*100).toFixed(1)}%</td><td>{(r.small_box_fraction*100).toFixed(1)}%</td><td>{r.mean_original_megapixels.toFixed(2)}</td></tr>)}</tbody></table></div>
 <p className="fine-print">*{report.coverage_method} Small boxes occupy less than 1% of the image; downsampling can make them harder to detect.</p>
 {report.rows.some(r=>r.detection_evaluation)&&<><h3>Measured detector results · {report.evaluation_split}</h3><p className="fine-print">Precision = correct detections among reported detections. Recall = labelled defects found. Small samples and class mix affect these results. Neither metric is a road-health grade.</p><div className="table-scroll"><table><thead><tr><th>Country / capture</th><th>Evaluated images</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>{report.rows.filter(r=>r.detection_evaluation).map(r=>{const d=r.detection_evaluation!;return <tr key={r.subset}><th>{r.subset.replaceAll('_',' ')}</th><td>{d.images}</td><td>{(d.precision*100).toFixed(1)}%</td><td>{(d.recall*100).toFixed(1)}%</td><td>{d.f1.toFixed(3)}</td></tr>})}</tbody></table></div></>}
 <Note>{report.notice}</Note><details><summary>What is needed to compare road quality fairly?</summary><ul>{report.needed_for_country_quality_comparison.map(x=><li key={x}>{x}</li>)}</ul></details>
 <button className="text-button" onClick={()=>downloadJson(report,'rdd-country-sample-comparison')}>Export sample comparison</button></>}
 </section>;
}
