import { useState } from 'react';
import { LiveNetwork } from './LiveNetwork';
import type { Page, Weights } from '../types/api';
import type { AnalysisController } from '../hooks/useAnalysis';
import { segments, summary, score, band, conditionClass } from '../data/demo';
import { Icon } from './Icon';
import { NetworkMap } from './NetworkMap';
import { Badge, PanelTitle } from './UI';
import { number } from '../utils/formatters';
export function Overview({demo,weights,onNavigate,onSegment,onExploreDemo}:{demo:boolean;onExploreDemo:()=>void;weights:Weights;onNavigate:(page:Page)=>void;onSegment:(id:string)=>void;analysis:AnalysisController}) {
  const [selected,setSelected]=useState(segments[0].id);
  const [filter,setFilter]=useState('All conditions');
  const stats=summary(weights);
  const selectedSegment=segments.find(x=>x.id===selected)!;
  const ongoing=segments.filter(x=>filter==='All conditions'||band(score(x,weights))===filter).slice(0,3);
  if(!demo)return <LiveNetwork onNavigate={onNavigate} onExploreDemo={onExploreDemo} compact/>;
  return <div className="page-enter">
    <div className="page-heading"><div><p className="eyebrow">YOUR INSPECTION WORKSPACE</p><h1>Roads at a glance<span className="heading-dot">.</span></h1><p>Condition, coverage, and maintenance priorities.</p></div><button className="button primary" onClick={()=>onNavigate('inspection')}><Icon name="plus" size={17}/>New inspection</button></div>
    <div className="workspace-note"><span><i className="dot lavender"/>Demo workspace</span><p>Six sample segments in East Bengaluru. All metrics below are illustrative.</p><button className="text-button" onClick={()=>onNavigate('network')}>Explore network<Icon name="arrow" size={15}/></button></div>
    <div className="stats-grid">
      <article className="stat-card"><div className="stat-label">Average road quality<Icon name="scan" size={16}/></div><div className="stat-value">{stats.average}<small>/ 100</small></div><span className="stat-foot"><i className="dot fair"/>Distance-weighted sample score</span></article>
      <article className="stat-card"><div className="stat-label">Visible defects<Icon name="layers" size={16}/></div><div className="stat-value">{stats.defects}<small>defects</small></div><span className="stat-foot">Across {segments.length} sample segments</span></article>
      <article className="stat-card"><div className="stat-label">Inspected distance<Icon name="road" size={16}/></div><div className="stat-value">{number(stats.length,1)}<small>km</small></div><span className="stat-foot">Demonstration route length</span></article>
      <article className="stat-card"><div className="stat-label">Needs attention<Icon name="warning" size={16}/></div><div className="stat-value">{stats.bad}<small>segments</small></div><span className="stat-foot"><i className="dot poor"/>Quality score below 50</span></article>
    </div>
    <section className="inspection-section">
      <PanelTitle title="Inspection overview"><label className="select-wrap"><span className="sr-only">Filter inspection condition</span><select value={filter} onChange={e=>setFilter(e.target.value)}>{['All conditions','Good','Moderate','Bad'].map(x=><option key={x}>{x}</option>)}</select><Icon name="down" size={13}/></label></PanelTitle>
      <div className="inspection-cards">{ongoing.length?ongoing.map((segment,index)=>{
        const value=score(segment,weights);
        return <button key={segment.id} className={'inspection-card '+(index===0?'featured':'')} onClick={()=>onSegment(segment.id)}>
          <div className="card-top"><span className={'road-avatar avatar-'+index}><Icon name="road" size={25}/></span><span className="round-arrow"><Icon name="diagonal" size={17}/></span></div>
          <p className="eyebrow">{segment.id} <span>· {segment.length} km</span></p><h3>{segment.name}</h3><p className="card-locality">{segment.locality}</p>
          <div className="card-footer"><Badge tone={conditionClass(value)}>{band(value)}</Badge><span>{segment.defects.length} defects</span><strong>{value}<small>/100</small></strong></div>
        </button>;
      }):<p>No segments match this condition.</p>}</div>
    </section>
    <div className="overview-bottom">
      <section className="panel network-panel"><PanelTitle title="Your road network" eyebrow="BENGALURU EAST · SAMPLE"><button className="icon-button" aria-label="Open road network" onClick={()=>onNavigate('network')}><Icon name="diagonal" size={18}/></button></PanelTitle>
        <NetworkMap weights={weights} selected={selected} onSelect={setSelected} compact/>
        <button className="map-selection" onClick={()=>onSegment(selected)}><span><strong>{selectedSegment.name}</strong><small>{selectedSegment.locality} · {selectedSegment.length} km</small></span><Badge tone={conditionClass(score(selectedSegment,weights))}>{score(selectedSegment,weights)} / 100</Badge><Icon name="arrow" size={17}/></button>
      </section>
      <section className="panel condition-panel"><PanelTitle title="Condition profile" eyebrow="SEGMENT QUALITY"/><div className="profile-summary"><strong>{stats.average}<small>/100</small></strong><p>Average quality<br/><span>Weighted by segment length</span></p></div>
        <div className="condition-chart" role="img" aria-label={'Sample segment scores: '+segments.map(x=>x.id+' '+score(x,weights)).join(', ')}>
          <div className="chart-grid"><span>100</span><span>75</span><span>50</span><span>25</span></div><div className="chart-bars">{segments.map(x=><button key={x.id} aria-label={x.name+', score '+score(x,weights)} onClick={()=>onSegment(x.id)}><div className="bar-track"><span className={conditionClass(score(x,weights))} style={{height:score(x,weights)+'%'}}><b>{score(x,weights)}</b></span></div><small>{x.id.replace('RH-','S')}</small></button>)}</div>
        </div>
        <div className="condition-footer"><span><i className="dot poor"/>{stats.bad} segments need attention</span><button className="text-button" onClick={()=>onNavigate('planner')}>Plan repairs<Icon name="arrow" size={15}/></button></div>
      </section>
    </div>
    <div className="bottom-caption"><span><Icon name="info" size={14}/>Demo scores use the configurable example weights. No validated road grade is implied.</span><span>RH / WORKSPACE 01</span></div>
  </div>;
}
