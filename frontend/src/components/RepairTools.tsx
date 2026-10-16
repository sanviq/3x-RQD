import { useMemo } from 'react';
import { effectiveMarks, markArea } from '../simulation/model';
import type { GrowthRates, Mark, RoadConfig, Scenario } from '../simulation/model';
import { scenarioTexture } from '../simulation/image';
import { number } from '../utils/formatters';
interface Props {texture:HTMLCanvasElement|null;marks:Mark[];config:RoadConfig;scenario:Scenario;months:number;growth:GrowthRates;
  onScenario:(s:Scenario)=>void;onMonths:(n:number)=>void;onGrowth:(r:GrowthRates)=>void;onAll:(value:boolean)=>void;
  busy:boolean;progress:number;error:string;onCompare:()=>void;onCancel:()=>void}
export function RepairTools(p:Props) {
  const states=useMemo(()=>(['Original','Repaired','Deteriorated'] as Scenario[]).map(s=>{
    const marks=effectiveMarks(p.marks,s,p.months,p.growth);
    return {scenario:s,marks,url:p.texture?scenarioTexture(p.texture,p.marks,s,p.months,p.growth).toDataURL():undefined};
  }),[p.texture,p.marks,p.months,p.growth]);
  return <div className="repair-tools"><h3>Plan a treatment, then compare the response</h3><p className="input-help">Selected repairs flatten their mapped relief. Deterioration grows untreated geometry using the explicit rates below. This is a what-if model, not a maintenance forecast.</p>
    <div className="segmented" role="group" aria-label="Repair preview scenario">{states.map(s=><button key={s.scenario} aria-pressed={p.scenario===s.scenario} className={p.scenario===s.scenario?'active':''} onClick={()=>p.onScenario(s.scenario)}>{s.scenario}</button>)}</div>
    <div className="action-row"><button className="text-button" disabled={!p.marks.length} onClick={()=>p.onAll(true)}>Select all repairs</button><button className="text-button" onClick={()=>p.onAll(false)}>Clear repair selection</button><span className="fine-print">{p.marks.filter(m=>m.repaired).length} / {p.marks.length} selected</span></div>
    <div className="repair-assumptions"><label className="field">Deterioration horizon · {p.months} months<input aria-label="Deterioration months" type="range" min="0" max="24" value={p.months} onChange={e=>p.onMonths(Number(e.target.value))}/></label>
      <label className="field">Depth growth (% / month)<input aria-label="Depth growth percent per month" type="number" min="0" max="10" step=".5" value={p.growth.depth*100} onChange={e=>p.onGrowth({...p.growth,depth:Math.max(0,Math.min(10,Number(e.target.value)||0))/100})}/></label>
      <label className="field">Footprint growth (% / month)<input aria-label="Footprint growth percent per month" type="number" min="0" max="5" step=".5" value={p.growth.size*100} onChange={e=>p.onGrowth({...p.growth,size:Math.max(0,Math.min(5,Number(e.target.value)||0))/100})}/></label>
    </div>
    <div className="repair-state-grid">{states.map(s=><figure key={s.scenario}><figcaption>{s.scenario==='Deteriorated'?'After '+p.months+' months · assumed':s.scenario}</figcaption>{s.url&&<img src={s.url} alt={s.scenario+' contour-aligned road texture'}/>}<strong>{s.marks.length} active defects</strong><small>{number(s.marks.reduce((sum,m)=>sum+markArea(m,p.config),0))} m² summed footprint · {number(Math.max(0,...s.marks.map(m=>m.depthMm*m.severity)),1)} mm max assumed relief</small></figure>)}</div>
    <div className="action-row"><button className="button primary" disabled={!p.texture||p.busy} onClick={p.onCompare}>{p.busy?'Comparing drives…':'Compare all three drives'}</button>{p.busy&&<button className="text-button" onClick={p.onCancel}>Cancel comparison</button>}</div>
    {p.busy&&<div className="comparison-progress" role="progressbar" aria-label="Drive comparison progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress*100)}><span style={{width:p.progress*100+'%'}}/></div>}
    {p.error&&<p className="field-error" role="alert">{p.error}</p>}
    <p className="fine-print">All three drives use exactly the same path, speed and vehicle parameters. Results appear in “Before & after driving” below. Individual work areas may overlap and are billed separately; quantities and rates are assumptions.</p>
  </div>;
}
