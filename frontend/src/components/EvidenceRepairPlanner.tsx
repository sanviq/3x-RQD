import {useState} from 'react';
import type {MappedRoadsController} from '../hooks/useMappedRoads';
import {repairPriorities,inspectionDate} from '../network/analytics';
import {Badge,Note,PanelTitle} from './UI';
import {downloadJson} from '../utils/formatters';
export function EvidenceRepairPlanner({roads,onNetwork}:{roads:MappedRoadsController;onNetwork:()=>void}){
 const [selected,setSelected]=useState<string[]>([]),[budget,setBudget]=useState('');
 const candidates=repairPriorities(roads.network?.segments??[]);
 return <div className="page-enter"><div className="page-heading"><div><p className="eyebrow">INSPECTION-BACKED MAINTENANCE REVIEW</p><h1>Repair planning<span className="heading-dot">.</span></h1><p>Review actual observed damage before choosing a treatment.</p></div><button className="button secondary" disabled={!candidates.length} onClick={()=>downloadJson({provisional:true,selected_segments:candidates.filter(s=>selected.includes(s.id)),declared_budget:budget.trim()?Number(budget):null,notice:'Review shortlist only. No repair cost or quality improvement is inferred without surveyed quantities and treatment specifications.'},'repair-review-shortlist')}>Export shortlist</button></div>
  <Note>Recommendations use the latest inspection-backed score and severity. Physical repair quantities, contractor rates and treatment effectiveness are not established by a photograph, so no invented repair prices or post-repair scores are displayed.</Note>
  <section className="panel"><PanelTitle title="Maintenance shortlist"/><label className="field">Optional planning budget · ₹<input type="number" min="0" step="1000" value={budget} onChange={e=>setBudget(e.target.value)}/></label><p className="fine-print">Budget is recorded for your planning discussion. Affordability requires independently measured quantities and costs.</p>
   {!candidates.length?<p>No linked defect evidence yet. Upload a road capture and link it to a mapped segment to build a review shortlist.</p>:<div className="table-scroll"><table className="repair-table"><thead><tr><th>Select</th><th>Road / inspection date</th><th>Provisional score</th><th>Visible road affected</th><th>Candidates / high severity</th><th>Action</th></tr></thead><tbody>{candidates.map(s=><tr key={s.id}><td><input type="checkbox" aria-label={'Shortlist '+s.name} checked={selected.includes(s.id)} onChange={()=>setSelected(old=>old.includes(s.id)?old.filter(id=>id!==s.id):[...old,s.id])}/></td><td>{s.name}<small>{inspectionDate(s.inspection!.analyzed_at)}</small></td><td><Badge tone="lavender">{s.inspection!.score.score.toFixed(1)} / 100</Badge></td><td>{s.inspection!.score.summary.affected_road_percent.toFixed(1)}%</td><td>{s.inspection!.score.summary.included_count} / {s.inspection!.score.summary.by_severity.High??0}</td><td><button className="text-button" onClick={()=>{roads.setSelected(s.id);onNetwork()}}>Review evidence</button></td></tr>)}</tbody></table></div>}
  </section>
 </div>;
}
