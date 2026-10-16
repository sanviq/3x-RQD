import { useState } from 'react';
import { LivePlanner } from './LiveNetwork';
import type { Weights } from '../types/api';
import { segments, optimize, score, summary, band, conditionClass } from '../data/demo';
import { Badge, Note, PanelTitle } from './UI';
import { Icon } from './Icon';
import { NetworkMap } from './NetworkMap';
import { money, downloadJson } from '../utils/formatters';
export function Planner({demo,weights}:{demo:boolean;weights:Weights}) {
  const [budget,setBudget]=useState(800000);
  const [selected,setSelected]=useState<string[]>(()=>optimize(800000,weights));
  const [mapSelected,setMapSelected]=useState(segments[0].id);
  const spent=segments.filter(x=>selected.includes(x.id)).reduce((sum,x)=>sum+x.cost,0);
  const before=summary(weights);
  const after=summary(weights,selected);
  const ranking=[...segments].sort((a,b)=>((score(b,weights,true)-score(b,weights))*b.length/b.cost)-((score(a,weights,true)-score(a,weights))*a.length/a.cost));
  if(!demo)return <LivePlanner weights={weights}/>;
  return <div className="page-enter">
    <div className="page-heading"><div><p className="eyebrow">MAINTENANCE · DEMONSTRATION</p><h1>Repair planning<span className="heading-dot">.</span></h1><p>Compare budgets and select priority segments.</p></div><button className="button secondary" onClick={()=>downloadJson({demo:true,assumptions:'Illustrative costs; 75% reduction in visible-condition penalties after repair. Not a validated engineering estimate.',budget,selected,spent,before,after,weights},'demo-repair-plan')}><Icon name="download" size={16}/>Export scenario</button></div>
    <Note tone="warning">Planning sandbox. Costs and repair outcomes are assumptions, not quotations or validated forecasts. The optimizer ranks quality gain × segment length per rupee and selects affordable segments greedily.</Note>
    <div className="planner-layout">
      <section className="panel budget-panel"><PanelTitle title="Maintenance budget" eyebrow="SET YOUR SCENARIO"/><strong className="budget-value">{money(budget)}</strong><label className="field" htmlFor="budget">Available budget<input id="budget" type="range" min="0" max="1500000" step="10000" value={budget} onChange={e=>{const v=Number(e.target.value);setBudget(v);setSelected(optimize(v,weights))}}/></label><div className="range-labels"><span>₹0</span><span>₹15,00,000</span></div>
        <div className="budget-use"><div><span>Selected repairs</span><strong>{money(spent)}</strong></div><div><span>{spent>budget?'Over budget':'Remaining'}</span><strong className={spent>budget?'error-text':''}>{money(Math.abs(budget-spent))}</strong></div><div className="budget-track"><span style={{width:Math.min(100,budget?spent/budget*100:spent?100:0)+'%'}}/></div></div>
        {spent>budget&&<p className="field-error" role="alert">This selection exceeds the available budget. Deselect a segment or increase the budget.</p>}
        <button className="button primary full-width" onClick={()=>setSelected(optimize(budget,weights))}><Icon name="refresh" size={16}/>Recalculate recommendation</button>
        <div className="planner-impact"><p className="eyebrow">ASSUMED NETWORK OUTCOME</p><div><span>Average quality</span><strong>{before.average}<Icon name="arrow" size={17}/>{after.average}<small>/100</small></strong></div><div><span>Remaining sample defects</span><strong>{before.defects}<Icon name="arrow" size={17}/>{after.defects}</strong></div><div><span>Bad segments</span><strong>{before.bad}<Icon name="arrow" size={17}/>{after.bad}</strong></div></div><p className="fine-print">Selected repairs remove listed sample defects and reduce condition penalties by 75%. Residual texture deterioration remains. These assumptions are illustrative.</p>
      </section>
      <div className="results-stack"><section className="panel"><PanelTitle title="Repair scenario map"><Badge tone="lavender">{selected.length} selected</Badge></PanelTitle><NetworkMap weights={weights} selected={mapSelected} onSelect={setMapSelected} repaired={selected}/><p className="fine-print">Selected roads show their assumed score after repair; unselected roads retain their original sample score.</p></section>
      <section className="panel"><PanelTitle title="Ranked repair recommendations"/><div className="table-scroll"><table className="repair-table"><thead><tr><th>Select</th><th>Road segment</th><th>Current</th><th>After repair</th><th>Assumed cost</th></tr></thead><tbody>{ranking.map((x,i)=><tr key={x.id}><td><input type="checkbox" aria-label={'Include '+x.name+' in repair scenario'} checked={selected.includes(x.id)} onChange={()=>setSelected(v=>v.includes(x.id)?v.filter(id=>id!==x.id):[...v,x.id])}/></td><td><strong>{i+1}. {x.name}</strong><small>{x.id} · {x.length} km</small></td><td><Badge tone={conditionClass(score(x,weights))}>{score(x,weights)} · {band(score(x,weights))}</Badge></td><td>{score(x,weights,true)} / 100</td><td>{money(x.cost)}</td></tr>)}</tbody></table></div></section></div>
    </div>
  </div>;
}
