import { useEffect, useState } from 'react';
import type { AnalysisController } from '../hooks/useAnalysis';
import type { Page, Weights } from '../types/api';
import { segments, score, band } from '../data/demo';
import { Badge, EmptyState, Note, PanelTitle } from './UI';
import { Icon } from './Icon';
import { SurfaceArt } from './SurfaceArt';
import { number } from '../utils/formatters';
export function ScenarioLab({demo,weights,selected,onNavigate,analysis}:{demo:boolean;weights:Weights;selected:string;onNavigate:(p:Page)=>void;analysis:AnalysisController}) {
  const segment=segments.find(x=>x.id===selected)!;
  const [tab,setTab]=useState('Digital twin');
  const [scenario,setScenario]=useState('Current');
  const [months,setMonths]=useState(6);
  const [repairs,setRepairs]=useState<string[]>([]);
  const [severity,setSeverity]=useState(1);
  const [areaScale,setAreaScale]=useState(1);
  const [rotation,setRotation]=useState(-22);
  const [zoom,setZoom]=useState(1);
  const [stress,setStress]=useState('Shadow');
  const [intensity,setIntensity]=useState(40);
  const [driving,setDriving]=useState(false);
  const [progress,setProgress]=useState(0);
  const [speed,setSpeed]=useState(35);
  const [goodThreshold,setGoodThreshold]=useState(75);
  const [fairThreshold,setFairThreshold]=useState(50);
  const remaining=segment.defects.filter(x=>scenario!=='Repaired'||!repairs.includes(x.id));
  const deterioration=scenario==='Deteriorated'?months/100:0;
  const factor=segment.defects.length?remaining.length/segment.defects.length:1;
  const custom={...segment,burdens:segment.burdens.map(x=>Math.min(1,x*severity*areaScale*(scenario==='Repaired'?(.25+.75*factor):1))) as typeof segment.burdens};
  const currentScore=score(segment,weights);
  const nextScore=score(custom,weights,false,deterioration);
  const nextBand=nextScore>=goodThreshold?'Good':nextScore>=fairThreshold?'Moderate':'Bad';
  const vibration=remaining.reduce((s,d)=>s+d.area*(d.severity==='High'?3:d.severity==='Moderate'?2:1),0)*severity*areaScale*speed/350;
  const originalVibration=segment.defects.reduce((s,d)=>s+d.area*(d.severity==='High'?3:d.severity==='Moderate'?2:1),0)*speed/350;
  useEffect(()=>{
    if(!driving)return;
    const interval=setInterval(()=>setProgress(x=>Math.min(100,x+speed/120)),80);
    return()=>clearInterval(interval);
  },[driving,speed]);
  useEffect(()=>{if(progress>=100)setDriving(false)},[progress]);
  const captureFrame=()=>{
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#626356';ctx.fillRect(0,0,800,500);
    ctx.strokeStyle='#e0dac3';ctx.lineWidth=6;ctx.setLineDash([32,28]);ctx.beginPath();ctx.moveTo(400,0);ctx.lineTo(400,500);ctx.stroke();ctx.setLineDash([]);
    remaining.forEach(d=>{ctx.fillStyle='#33382e';ctx.beginPath();ctx.ellipse(d.x*8,d.y*5,30*Math.sqrt(d.area)*areaScale,18*Math.sqrt(d.area),0,0,Math.PI*2);ctx.fill()});
    canvas.toBlob(blob=>{if(blob){void analysis.select(new File([blob],'synthetic-driving-frame.png',{type:'image/png'}));onNavigate('inspection')}},'image/png');
  };
  if(!demo)return <section className="panel"><EmptyState title="A sandbox for road scenarios" description="The lab uses synthetic geometry and assumed deterioration. Switch to demo mode to explore it. Real depth, forecasts, and vehicle dynamics require validated sensor and simulation data." icon="cube"/></section>;
  return <div className="page-enter"><div className="page-heading"><div><p className="eyebrow">SCENARIO LAB · SYNTHETIC</p><h1>Scenario lab<span className="heading-dot">.</span></h1><p>{segment.name} · explore an illustrative repair scenario.</p></div><Badge tone="lavender">Simulation, not a forecast</Badge></div>
    <div className="segmented lab-tabs">{['Digital twin','Severity heatmap','Weather lab','Driving comparison'].map(x=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}><Icon name={x==='Digital twin'?'cube':x==='Severity heatmap'?'layers':x==='Weather lab'?'sun':'car'} size={16}/>{x}</button>)}</div>
    <div className="lab-layout">
      <section className="panel lab-stage"><PanelTitle title={tab} eyebrow={segment.id+' / SCHEMATIC GEOMETRY'}><Badge tone={nextBand==='Good'?'good':nextBand==='Moderate'?'fair':'poor'}>{nextBand} · {nextScore}/100</Badge></PanelTitle>
        {tab==='Digital twin'||tab==='Driving comparison'?<>
          <div className="twin-viewport"><div className="twin-horizon"/><div className="twin-plane" style={{transform:'perspective(850px) rotateX(51deg) rotateZ('+rotation+'deg) scale('+zoom+')'}}><div className="twin-road"><div className="lane-line"/>{remaining.map(d=><button key={d.id} className={'twin-defect '+(d.severity==='High'?'poor':d.severity==='Moderate'?'fair':'good')} aria-label={d.kind+' '+d.id+', '+d.severity+' severity; schematic, no measured depth'} title={d.id+' · '+d.kind} style={{left:d.x+'%',top:d.y+'%',width:(15+Math.sqrt(d.area)*18*areaScale)+'px',height:(12+Math.sqrt(d.area)*12)+'px'}} onClick={()=>{setRepairs(v=>v.includes(d.id)?v.filter(id=>id!==d.id):[...v,d.id]);setScenario('Repaired')}}/>)}{tab==='Driving comparison'&&<div className={'twin-car '+(driving&&progress<100?'moving':'')} style={{left:(44+Math.sin(progress/14)*4)+'%',top:(90-progress*.8)+'%', '--vibration':Math.min(3,vibration)+'px'} as React.CSSProperties}><Icon name="car" size={32}/></div>}</div></div><span className="twin-caption">Schematic surface · no measured depth</span></div>
          <div className="twin-controls"><label>Rotate<input type="range" aria-label="Rotate road twin" min="-65" max="65" value={rotation} onChange={e=>setRotation(Number(e.target.value))}/></label><label>Zoom<input type="range" aria-label="Zoom road twin" min=".6" max="1.3" step=".05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label></div>
          {tab==='Driving comparison'&&<><label className="field">Assumed driving speed · {speed} km/h<input type="range" min="10" max="60" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/></label><div className="action-row"><button className="button primary" onClick={()=>{if(progress>=100)setProgress(0);setDriving(!driving)}}><Icon name="car" size={17}/>{driving&&progress<100?'Pause drive':progress>=100?'Drive again':'Start drive'}</button><button className="button secondary" onClick={()=>{setDriving(false);setProgress(0)}}>Reset path</button><button className="text-button" onClick={captureFrame}>Inspect synthetic frame<Icon name="arrow" size={15}/></button></div><div className="driving-comparison"><div><span>Original vibration proxy</span><strong>{number(originalVibration)}</strong></div><div><span>Scenario vibration proxy</span><strong>{number(vibration)}</strong></div><div><span>Remaining sample defects</span><strong>{remaining.length}</strong></div></div><Note>Unitless vibration is an illustrative proxy from sample defect area, severity, and assumed speed. No vehicle dynamics or comfort measurements are available. Frame capture sends a labeled synthetic drawing to the surface-analysis workflow.</Note></>}
        </>:tab==='Severity heatmap'?<><div className="side-by-side"><div><span className="eyebrow">SYNTHETIC ORIGINAL</span><SurfaceArt defects={segment.defects}/></div><div><span className="eyebrow">ASSUMED SEVERITY</span><SurfaceArt mode="heatmap" defects={remaining}/></div></div><div className="overlay-legend"><span><i className="dot poor"/>High severity</span><span><i className="dot fair"/>Moderate</span><span><i className="dot good"/>Low detected damage</span></div><Note>Heat regions are drawn from the sample defect positions and severity labels. They are not model predictions.</Note></>:<>
          <div className="side-by-side"><div><span className="eyebrow">ORIGINAL ILLUSTRATION</span><SurfaceArt/></div><div><span className="eyebrow">{stress.toUpperCase()} / SYNTHETIC</span><SurfaceArt stress={stress} intensity={intensity}/></div></div><div className="weather-options">{['Shadow','Low light','Glare','Blur','Perspective','Rain'].map(x=><button key={x} className={'button small '+(stress===x?'primary':'secondary')} onClick={()=>setStress(x)}>{x}</button>)}</div><label className="field">Stress intensity · {intensity}%<input type="range" min="0" max="100" value={intensity} onChange={e=>setIntensity(Number(e.target.value))}/></label><Note>Synthetic visual stress only. Detection confidence and score changes are not calculated without inference. This does not demonstrate real-weather robustness.</Note>
        </>}
        {tab!=='Driving comparison'&&<p className="fine-print">Depth, slope geometry, and repaired outcomes are schematic. Actual defect depth requires a depth sensor or validated reconstruction.</p>}
      </section>
      <section className="panel scenario-controls"><PanelTitle title="Adjust the scenario" eyebrow="ASSUMPTIONS"/><div className="segmented scenario-tabs">{['Current','Deteriorated','Repaired'].map(x=><button key={x} className={scenario===x?'active':''} onClick={()=>setScenario(x)}>{x}</button>)}</div>
        {scenario==='Deteriorated'&&<label className="field">Illustrative time · {months} months<input type="range" min="0" max="24" value={months} onChange={e=>setMonths(Number(e.target.value))}/><small>Assumed penalty increase of 0.01 per month; not a validated forecast.</small></label>}
        <label className="field">Defect severity multiplier · {severity.toFixed(1)}×<input type="range" min=".5" max="1.8" step=".1" value={severity} onChange={e=>setSeverity(Number(e.target.value))}/></label>
        <label className="field">Defect size / area multiplier · {areaScale.toFixed(1)}×<input type="range" min=".5" max="2" step=".1" value={areaScale} onChange={e=>setAreaScale(Number(e.target.value))}/></label>
        <div className="repair-choices"><h3>Select defects to repair</h3><p className="input-help">Applies in the Repaired scenario. Untreated defects retain their existing sample properties.</p>{segment.defects.length?segment.defects.map(d=><label key={d.id} className="checkbox-row"><input type="checkbox" checked={repairs.includes(d.id)} onChange={()=>{setRepairs(v=>v.includes(d.id)?v.filter(id=>id!==d.id):[...v,d.id]);setScenario('Repaired')}}/><span>{d.id} · {d.kind}<small>{d.severity} severity · assumed {d.area} m²</small></span></label>):<p className="fine-print">No listed defects in this sample segment.</p>}</div>
        <div className="scenario-score"><span>Current → scenario</span><strong>{currentScore}<Icon name="arrow" size={21}/>{nextScore}<small>/100</small></strong><Badge tone={nextBand==='Good'?'good':nextBand==='Moderate'?'fair':'poor'}>{nextBand}</Badge></div>
        <details className="lab-thresholds"><summary>Scenario classification thresholds</summary><label className="field">Good at or above<input type="number" min={fairThreshold+1} max="100" value={goodThreshold} onChange={e=>setGoodThreshold(Math.min(100,Math.max(fairThreshold+1,Number(e.target.value))))}/></label><label className="field">Moderate at or above<input type="number" min="1" max={goodThreshold-1} value={fairThreshold} onChange={e=>setFairThreshold(Math.max(1,Math.min(goodThreshold-1,Number(e.target.value))))}/></label><p className="fine-print">Applies to this sandbox only. API bands and the default demo network classification keep their documented thresholds.</p></details>
        <button className="text-button" onClick={()=>{setScenario('Current');setRepairs([]);setSeverity(1);setAreaScale(1);setMonths(6);setGoodThreshold(75);setFairThreshold(50)}}><Icon name="refresh" size={15}/>Reset scenario</button><p className="fine-print">Baseline: {band(currentScore)}. Scores use the workspace’s example weights; sensor pitch is not included in this model.</p>
      </section>
    </div>
  </div>;
}
