import { useState } from 'react';
import { LiveNetwork } from './LiveNetwork';
import type { Page, Weights } from '../types/api';
import { segments, score, band, conditionClass, factorNames } from '../data/demo';
import { number, percent } from '../utils/formatters';
import { NetworkMap } from './NetworkMap';
import { SurfaceArt } from './SurfaceArt';
import { Icon } from './Icon';
import { Badge, Note, PanelTitle } from './UI';
export function Network({demo,weights,selected,onSelect,onNavigate}:{demo:boolean;weights:Weights;selected:string;onSelect:(id:string)=>void;onNavigate:(page:Page)=>void}) {
  const [filter,setFilter]=useState('All');
  const [view,setView]=useState('detections');
  const [defectId,setDefectId]=useState('');
  const [profile,setProfile]=useState('Quality');
  const [threshold,setThreshold]=useState(.5);
  const [resolution,setResolution]=useState('1024');
  const segment=segments.find(x=>x.id===selected)!;
  const shownDefects=segment.defects.filter(d=>d.confidence>=threshold);
  const defect=shownDefects.find(x=>x.id===defectId)??shownDefects[0];
  const value=score(segment,weights);
  const confidence=shownDefects.length?shownDefects.reduce((sum,x)=>sum+x.confidence,0)/shownDefects.length:null;
  const totalWeight=weights.reduce((sum,x)=>sum+x,0)||1;
  if(!demo)return <LiveNetwork onNavigate={onNavigate}/>;
  const profileValues=segments.map(x=>profile==='Quality'?score(x,weights):profile==='Defect density'?x.defects.length/x.length:x.pitch);
  const maximum=Math.max(...profileValues,1),minimum=Math.min(...profileValues,0);
  const points=profileValues.map((v,i)=>(50+segments[i].distance/12.6*600)+','+(160-(v-minimum)/(maximum-minimum)*125)).join(' ');
  return <div className="page-enter">
    <div className="page-heading"><div><p className="eyebrow">ROAD NETWORK · DEMONSTRATION</p><h1>Road network<span className="heading-dot">.</span></h1><p>Review segment condition and inspection details.</p></div><Badge tone="lavender">Sample GPS-linked segments</Badge></div>
    <section className="panel"><PanelTitle title="East Bengaluru network"><div className="segmented">{['All','Good','Moderate','Bad'].map(x=><button key={x} className={filter===x?'active':''} aria-pressed={filter===x} onClick={()=>setFilter(x)}>{x}</button>)}</div></PanelTitle><NetworkMap weights={weights} selected={selected} onSelect={id=>{onSelect(id);setDefectId('')}} filter={filter}/></section>
    <div className="segment-picker" role="group" aria-label="Choose road segment">{segments.map(x=><button key={x.id} className={selected===x.id?'active':''} aria-pressed={selected===x.id} onClick={()=>{onSelect(x.id);setDefectId('')}}><i className={'dot '+conditionClass(score(x,weights))}/>{x.name}<small>{x.id}</small></button>)}</div>
    <div className="network-detail-grid">
      <section className="panel"><PanelTitle eyebrow={segment.id+' · '+segment.locality.toUpperCase()} title={segment.name}><Badge tone={conditionClass(value)}>{band(value)} · {value}/100</Badge></PanelTitle>
        <div className="segmented preview-tabs" role="group" aria-label="Synthetic inspection overlay">{['original','detections','segmentation','heatmap'].map(x=><button key={x} className={view===x?'active':''} aria-pressed={view===x} onClick={()=>setView(x)}>{x==='segmentation'?'Chip masks':x.charAt(0).toUpperCase()+x.slice(1)}</button>)}</div>
        <details className="detector-options"><summary>Demo detector controls</summary><label className="field">Sample confidence threshold · {Math.round(threshold*100)}%<input type="range" min=".5" max=".99" step=".01" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></label><label className="field" htmlFor="detector-resolution">Planned inference resolution</label><select id="detector-resolution" value={resolution} onChange={e=>setResolution(e.target.value)}>{['640','1024','1280'].map(x=><option key={x} value={x}>{x} px</option>)}</select><p className="fine-print">Confidence filters synthetic detections only. The resolution selection previews future detector configuration; it is not sent to the surface API, which controls its own image processing.</p></details><SurfaceArt mode={view} defects={shownDefects} active={defect?.id} onSelect={setDefectId}/>
        <div className="overlay-legend">{view==='heatmap'?<><span><i className="dot poor"/>High severity</span><span><i className="dot fair"/>Moderate</span><span><i className="dot good"/>Low detected damage</span></>:<span>Synthetic boxes, classes, confidence, and masks · no live inference</span>}</div>
        <div className="measurement-grid compact-metrics"><div className="measurement"><span>Defects</span><strong>{shownDefects.length}</strong></div><div className="measurement"><span>Defect density</span><strong>{number(shownDefects.length/segment.length,1)}</strong><small>per km</small></div><div className="measurement"><span>Sample mean confidence</span><strong>{confidence===null?'Not available':percent(confidence)}</strong></div><div className="measurement"><span>Assumed damaged area</span><strong>{percent(shownDefects.reduce((s,d)=>s+d.area,0)/(segment.length*1000*6))}</strong><small>Assumed 6 m road width</small></div></div>
        <Note>All detections and dimensions on this screen are fixtures. Inference time and FPS are not measured. Real tracking, segmentation, and confidence need a detection backend.</Note>
      </section>
      <div className="results-stack">
        <section className="panel"><PanelTitle title="Defect register"><Badge>{shownDefects.length}</Badge></PanelTitle>{shownDefects.length?<><div className="defect-list">{shownDefects.map(d=><button key={d.id} className={defect?.id===d.id?'active':''} onClick={()=>setDefectId(d.id)}><span className="defect-thumb"><SurfaceArt mode="heatmap" defects={[d]}/></span><span><strong>{d.kind}</strong><small>{d.id} · {Math.round(d.confidence*100)}% sample confidence</small></span><Badge tone={d.severity==='High'?'poor':d.severity==='Moderate'?'fair':'good'}>{d.severity}</Badge></button>)}</div>{defect&&<div className="defect-detail"><h3>{defect.id} / {defect.kind}</h3><dl><div><dt>Illustrative size</dt><dd>{defect.width} × {defect.height} m</dd></div><div><dt>Illustrative area</dt><dd>{defect.area} m²</dd></div><div><dt>Image location</dt><dd>{defect.x}% across · {defect.y}% down</dd></div><div><dt>Depth</dt><dd>Not measured</dd></div></dl></div>}</>:<p className="fine-print">No sample detections meet the selected threshold. This does not establish a defect-free real road.</p>}</section>
        <section className="panel"><PanelTitle title="Why this score?"/><div className="score-explanation">{factorNames.map((name,i)=><div key={name}><span>{name}<small>{weights[i]}% example weight</small></span><strong>−{number(segment.burdens[i]*weights[i]/totalWeight*100,1)}</strong></div>)}</div><p className="fine-print">100 minus the normalized visible-condition penalties, rounded once. Thresholds: Good ≥75, Moderate ≥50, Bad &lt;50.</p><div className="inclination-row"><Icon name="sliders" size={17}/><span>Illustrative sensor pitch<strong>{segment.pitch}°</strong></span><Badge>Demo IMU</Badge></div><p className="fine-print">GPS and inclination are sample inputs. No image-derived slope or roll is available.</p><button className="button secondary full-width" onClick={()=>onNavigate('lab')}>Open scenario lab<Icon name="cube" size={16}/></button></section>
      </div>
    </div>
    <section className="panel"><PanelTitle title="Along the route"><div className="segmented">{['Quality','Defect density','Inclination'].map(x=><button key={x} className={profile===x?'active':''} onClick={()=>setProfile(x)}>{x}</button>)}</div></PanelTitle><div className="route-profile"><svg viewBox="0 0 720 210" role="img" aria-label={profile+' by segment distance: '+segments.map((x,i)=>x.distance+' km '+number(profileValues[i],1)).join(', ')}>{[35,95,160].map(y=><path key={y} d={'M45 '+y+'H685'} stroke="#dcdccd" strokeDasharray="4 5"/>)}<polyline points={points} fill="none" stroke="#867e96" strokeWidth="3" strokeLinejoin="round"/>{profileValues.map((v,i)=><g key={i}><circle cx={50+segments[i].distance/12.6*600} cy={160-(v-minimum)/(maximum-minimum)*125} r="5" fill="#34271f"/><text x={50+segments[i].distance/12.6*600} y="188" textAnchor="middle" fontSize="11" fill="#6c6c60">{segments[i].distance} km</text></g>)}<text x="12" y="38" fontSize="11" fill="#6c6c60">{number(maximum,1)}</text><text x="12" y="164" fontSize="11" fill="#6c6c60">{number(minimum,1)}</text></svg></div><p className="fine-print">Synthetic segment samples at cumulative distance. {profile==='Quality'?'Score out of 100.':profile==='Defect density'?'Defects per km.':'Pitch in degrees; sample sensor input.'} Not a continuous survey.</p></section>
  </div>;
}
