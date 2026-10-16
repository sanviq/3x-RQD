import { useRef, useState } from 'react';
import type { Page, Weights } from './types/api';
import { useHealth } from './hooks/useHealth';
import { useAnalysis } from './hooks/useAnalysis';
import { Overview } from './components/Overview';
import { Inspection } from './components/Inspection';
import { Network } from './components/Network';
import {ConnectedNetwork} from './components/ConnectedNetwork';
import {useRoadNetwork} from './hooks/useRoadNetwork';
import { Planner } from './components/Planner';
import { ScenarioLab } from './components/ScenarioLab';
import { Evaluation, Materials } from './components/Resources';
import { Badge, Note } from './components/UI';
import { Icon } from './components/Icon';
import { defaultWeights, factorNames, segments } from './data/demo';

const navigation:{id:Page;label:string;icon:string;group:string}[]=[
  {id:'overview',label:'Overview',icon:'grid',group:'WORKSPACE'},
  {id:'inspection',label:'Surface inspection',icon:'scan',group:'WORKSPACE'},
  {id:'network',label:'Road network',icon:'map',group:'WORKSPACE'},
  {id:'planner',label:'Repair planner',icon:'tool',group:'PLANNING'},
  {id:'lab',label:'Scenario lab',icon:'cube',group:'PLANNING'},
  {id:'evaluation',label:'Model evaluation',icon:'chart',group:'RESOURCES'},
  {id:'materials',label:'Material samples',icon:'flask',group:'RESOURCES'},
];
export default function App(){
  const [page,setPage]=useState<Page>('overview');
  const [labOpened,setLabOpened]=useState(false);
  const [workspaceDate]=useState(()=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date()));
  const [demo,setDemo]=useState(true);
  const [selected,setSelected]=useState(segments[0].id);
  const [weights,setWeights]=useState<Weights>(defaultWeights);
  const [draftWeights,setDraftWeights]=useState<Weights>(defaultWeights);
  const [drawer,setDrawer]=useState(false);
  const [notifications,setNotifications]=useState(false);
  const [query,setQuery]=useState('');
  const settings=useRef<HTMLDialogElement>(null);
  const search=useRef<HTMLDialogElement>(null);
  const health=useHealth();
  const analysis=useAnalysis();
  const roadNetwork=useRoadNetwork();
  const [sampleNetwork,setSampleNetwork]=useState(false);
  const [savedNetwork,setSavedNetwork]=useState(false);
  const navigate=(next:Page)=>{setPage(next);if(next==='lab')setLabOpened(true);if(next==='inspection')setDemo(false);setDrawer(false);setNotifications(false);window.scrollTo({top:0,behavior:'instant'})};
  const selectSegment=(id:string)=>{setSampleNetwork(true);setDemo(true);setSelected(id);navigate('network')};
  const healthLabel=health.loading?'Connecting…':health.health?health.health.model_loaded?'Trained model connected':'Texture analysis connected':'Backend offline';
  const openSettings=()=>{setDraftWeights([...weights] as Weights);settings.current?.showModal()};
  const total=draftWeights.reduce((s,x)=>s+x,0);
  const searchResults=navigation.filter(x=>(x.label+' '+x.group).toLowerCase().includes(query.toLowerCase()));
  const roads=segments.filter(x=>(x.name+' '+x.locality+' '+x.id).toLowerCase().includes(query.toLowerCase()));
  return <>
    <a href="#main-content" className="skip-link">Skip to main content</a>
    <div className="app-shell">
      {drawer&&<button className="drawer-backdrop" aria-label="Close navigation" onClick={()=>setDrawer(false)}/>}
      <aside className={'sidebar '+(drawer?'mobile-open':'')} aria-label="Workspace navigation">
        <a href="#overview" className="brand" onClick={e=>{e.preventDefault();navigate('overview')}}><span className="brand-mark"><Icon name="road" size={24}/></span><span>road health<span className="brand-period">.</span></span></a>
        <div className="sidebar-intro"><span className="eyebrow">A BETTER WAY FORWARD</span><p>Inspection<br/>workspace</p><small>{workspaceDate}</small></div>
        <nav>{['WORKSPACE','PLANNING','RESOURCES'].map(group=><div className="nav-group" key={group}><span className="nav-heading">{group}</span>{navigation.filter(x=>x.group===group).map(item=><button key={item.id} className={'nav-item '+(page===item.id?'active':'')} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><Icon name={item.icon} size={17}/><span>{item.label}</span>{page===item.id&&<span className="nav-active-dot"/>}</button>)}</div>)}</nav>
        <button className="sidebar-callout" onClick={()=>navigate('planner')}><span className="callout-icon"><Icon name="tool" size={18}/></span><strong>Maintenance<br/>planning.</strong><span>Compare repair scenarios<Icon name="diagonal" size={15}/></span><i className="callout-orbit"/></button>
        <button className="sidebar-settings" onClick={openSettings}><Icon name="sliders" size={16}/>Workspace settings<Icon name="chevron" size={13}/></button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={drawer} onClick={()=>setDrawer(!drawer)}><Icon name="menu"/></button>
          <div className="top-tabs" aria-label="Workspace shortcuts">{([['overview','Overview'],['inspection','Inspection'],['network','Network'],['planner','Planning']] as const).map(([id,label])=><button key={id} className={page===id?'active':''} onClick={()=>navigate(id)}>{label}</button>)}</div>
          <div className="topbar-actions"><label className="mode-select"><i className={'dot '+(demo?'lavender':'good')}/><span className="sr-only">Workspace data source</span><select value={demo?'demo':'live'} onChange={e=>setDemo(e.target.value==='demo')}><option value="demo">Demo workspace</option><option value="live">Live workspace</option></select><Icon name="down" size={12}/></label><span className="topbar-separator"/><button className="icon-button" aria-label="Search workspace" onClick={()=>{setQuery('');search.current?.showModal()}}><Icon name="search" size={18}/></button><div className="notification-wrapper"><button className="icon-button notification-trigger" aria-label="Service notifications" aria-expanded={notifications} onClick={()=>setNotifications(!notifications)}><Icon name="bell" size={18}/>{!health.health&&!health.loading&&<i/>}</button>{notifications&&<div className="notification-popover"><div className="panel-title"><h3>Workspace status</h3><button className="icon-button" aria-label="Close notifications" onClick={()=>setNotifications(false)}><Icon name="close" size={14}/></button></div><p><i className={'dot '+(health.health?'good':'fair')}/>{healthLabel}</p><small>{health.health?'Feature version: '+health.health.feature_version:health.error||'Checking the local service.'}</small><p><Icon name="scan" size={15}/>{analysis.result?'Latest analysis is ready.':'No completed live analysis this session.'}</p><button className="text-button" onClick={health.retry}>Retry service check<Icon name="refresh" size={14}/></button></div>}</div><div className="profile-avatar" aria-label="Local officer workspace" title="Local session · no account required">OF</div></div>
        </header>
        <div className="service-strip" role="status"><span><i className={'dot '+(health.loading?'lavender':health.health?'good':'offline')}/>{healthLabel}</span>{health.health?<small>{health.health.feature_version} · experimental assessment</small>:<button onClick={health.retry} disabled={health.loading} className="text-button">{health.loading?'Checking connection':'Retry connection'}<Icon name="refresh" size={12}/></button>}</div>
        <main id="main-content">
          {page==='overview'&&<Overview demo={demo} weights={weights} onNavigate={navigate} onSegment={selectSegment} analysis={analysis}/>}
          {page==='inspection'&&<Inspection analysis={analysis} onSimulate={()=>navigate('lab')}/>}
          {page==='network'&&<><div className="segmented preview-tabs"><button className={!sampleNetwork&&!savedNetwork?'active':''} onClick={()=>{setSampleNetwork(false);setSavedNetwork(false)}}>Your connected network</button><button className={sampleNetwork?'active':''} onClick={()=>{setSampleNetwork(true);setSavedNetwork(false)}}>Sample network</button><button className={savedNetwork&&!sampleNetwork?'active':''} onClick={()=>{setSampleNetwork(false);setSavedNetwork(true);setDemo(false)}}>Saved GPS surveys</button></div>{sampleNetwork?<Network demo weights={weights} selected={selected} onSelect={setSelected} onNavigate={navigate}/>:savedNetwork?<Network demo={false} weights={weights} selected={selected} onSelect={setSelected} onNavigate={navigate}/>:<ConnectedNetwork network={roadNetwork} analysis={analysis} onInspect={()=>navigate('inspection')} onTwin={()=>navigate('lab')}/>}</>}
          {page==='planner'&&<Planner demo={demo} weights={weights}/>}
          {labOpened&&<div hidden={page!=='lab'}><ScenarioLab active={page==='lab'} demo={demo} selected={selected} onNavigate={navigate} analysis={analysis}/></div>}
          {page==='evaluation'&&<Evaluation/>}
          {page==='materials'&&<Materials/>}
        </main>
        <footer className="workspace-footer"><span>Road Health <i>·</i> Inspection & maintenance workspace</span><span>{demo?'Illustrative workspace':'Connected surface analysis'}<i>·</i>Experimental v1.0</span></footer>
      </div>
    </div>
    <dialog ref={settings} className="settings-dialog" aria-labelledby="settings-title"><div className="dialog-header"><div><p className="eyebrow">LOCAL PREFERENCES</p><h2 id="settings-title">Workspace settings</h2></div><button className="icon-button" aria-label="Close settings" onClick={()=>settings.current?.close()}><Icon name="close"/></button></div><Note>Example weights affect the demo network and scenario planner. Live surface scores and bands are always taken from the API.</Note><h3>Example condition weights</h3>{factorNames.map((name,i)=><label className="weight-field" key={name}><span>{name}</span><span><input type="number" aria-label={name+' weight'} min="0" max="100" value={draftWeights[i]} onChange={e=>setDraftWeights(draftWeights.map((v,j)=>i===j?Math.max(0,Math.min(100,Number(e.target.value)||0)):v) as Weights)}/>%</span></label>)}<p className="fine-print">Weights are normalized by their total ({total}%). The baseline example is 35 / 30 / 25 / 10. Classification defaults: Good ≥75; Moderate ≥50. Scenario thresholds can be adjusted in the lab.</p><div className="settings-api"><Badge tone={health.health?'good':'fair'}>{healthLabel}</Badge><p>Local API: <code>/api → 127.0.0.1:8000</code></p><small>Set VITE_API_BASE_URL before building to change the API address. No secrets belong in Vite variables.</small></div><div className="dialog-actions"><button className="text-button" onClick={()=>setDraftWeights([...defaultWeights] as Weights)}>Restore defaults</button><button className="button primary" disabled={total===0} onClick={()=>{setWeights([...draftWeights] as Weights);settings.current?.close()}}>Apply weights<Icon name="check" size={16}/></button></div></dialog>
    <dialog ref={search} className="search-dialog" aria-labelledby="search-title"><div className="dialog-header"><h2 id="search-title">Search workspace</h2><button className="icon-button" aria-label="Close search" onClick={()=>search.current?.close()}><Icon name="close"/></button></div><label className="search-field"><Icon name="search" size={19}/><input autoFocus placeholder="Search tools, roads, or localities…" aria-label="Search tools, roads, or localities" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="search-results"><p className="eyebrow">WORKSPACE</p>{searchResults.map(x=><button key={x.id} onClick={()=>{navigate(x.id);search.current?.close()}}><Icon name={x.icon} size={17}/>{x.label}<Icon name="arrow" size={15}/></button>)}<p className="eyebrow">SAMPLE ROAD SEGMENTS</p>{roads.map(x=><button key={x.id} onClick={()=>{selectSegment(x.id);search.current?.close()}}><Icon name="road" size={17}/><span>{x.name}<small>{x.locality} · {x.id}</small></span><Icon name="arrow" size={15}/></button>)}{!searchResults.length&&!roads.length&&<p className="fine-print">No matching roads or tools.</p>}</div></dialog>
  </>;
}
