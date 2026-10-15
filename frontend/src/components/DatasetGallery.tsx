import {useEffect,useState} from 'react';
import {apiBaseUrl,request} from '../api/client';
import {Note,PanelTitle,Badge} from './UI';

type Example={image:string;yolo_labels:string;original_xml:string;country:string;damage_codes:string[];source_image:string;original_size:[number,number];change:string};
type Catalog={examples:Example[];notice:string;source:string;license:string};
export function DatasetGallery({onSelect}:{onSelect:(file:File)=>void}){
 const [catalog,setCatalog]=useState<Catalog|null>(null),[country,setCountry]=useState(''),[chosen,setChosen]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const c=new AbortController();void request('/dataset/examples',{signal:c.signal}).then(r=>setCatalog(r as Catalog)).catch(()=>{});return()=>c.abort()},[]);
 const list=catalog?.examples.filter(r=>!country||r.country===country)??[];
 const selected=list.find(r=>r.image===chosen)??list[0];
 const [boxes,setBoxes]=useState<number[][]>([]);
 useEffect(()=>{const c=new AbortController();setBoxes([]);if(selected)void fetch(apiBaseUrl+'/dataset/examples/'+encodeURIComponent(selected.yolo_labels),{signal:c.signal}).then(r=>{if(!r.ok)throw Error('Annotation unavailable');return r.text()}).then(text=>{if(!c.signal.aborted)setBoxes(text.trim()?text.trim().split('\n').map(line=>line.split(/\s+/).map(Number)):[])}).catch(()=>{});return()=>c.abort()},[selected]);
 if(!catalog?.examples.length)return null;
 return <section className="panel"><PanelTitle title="Real RDD2022 country samples" eyebrow="DATASET EXPLORER"><Badge>Human ground truth</Badge></PanelTitle><Note>{catalog.notice}</Note>
 <div className="backend-controls"><label className="field">Country / capture subset<select value={country} onChange={e=>{setCountry(e.target.value);setChosen('')}}><option value="">All country subsets</option>{[...new Set(catalog.examples.map(r=>r.country))].sort().map(c=><option key={c}>{c}</option>)}</select></label><label className="field">Real sample<select value={selected?.image??''} onChange={e=>setChosen(e.target.value)}>{list.map(r=><option key={r.image} value={r.image}>{r.country} · {r.damage_codes.join(', ')} · {r.image}</option>)}</select></label></div>
 {selected&&<><div style={{position:'relative',maxWidth:700,margin:'1rem auto'}}><img loading="lazy" style={{display:'block',width:'100%',borderRadius:12}} src={apiBaseUrl+'/dataset/examples/'+encodeURIComponent(selected.image)} alt={'Real '+selected.country+' road sample; human annotations'}/><svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}} aria-label="Human ground-truth boxes">{boxes.map(([c,x,y,w,h],i)=><rect key={i} x={(x-w/2)*100} y={(y-h/2)*100} width={w*100} height={h*100} fill="none" stroke="#50e879" strokeWidth=".4"><title>{['D00','D10','D20','D40'][c]} · human annotation</title></rect>)}</svg></div><p className="fine-print">{selected.country} · {selected.damage_codes.join(', ')} · green boxes = human annotations · original {selected.original_size.join(' × ')} px. {selected.change}</p>
 <button className="button secondary" disabled={busy} onClick={()=>{setBusy(true);setError('');void fetch(apiBaseUrl+'/dataset/examples/'+encodeURIComponent(selected.image)).then(r=>{if(!r.ok)throw Error('Sample could not be loaded');return r.blob()}).then(b=>onSelect(new File([b],selected.image,{type:'image/jpeg'}))).catch(e=>setError((e as Error).message)).finally(()=>setBusy(false))}}>Use this real image for defect analysis</button>{error&&<p role="alert">{error}</p>}</>}
 <p className="fine-print">{catalog.license} · <a href={catalog.source} target="_blank" rel="noreferrer">Official RDD2022 source and dataset authors</a>. Gallery examples come only from training data; held-out test images are excluded.</p></section>;
}
