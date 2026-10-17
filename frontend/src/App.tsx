import { useRef, useState } from 'react';
import type { Page } from './types/api';
import { useHealth } from './hooks/useHealth';
import { useAnalysis } from './hooks/useAnalysis';
import { InspectionDashboard } from './components/InspectionDashboard';
import { Inspection } from './components/Inspection';
import { InspectionRoadNetwork } from './components/InspectionRoadNetwork';
import { EvidenceRepairPlanner } from './components/EvidenceRepairPlanner';
import { useMappedRoads } from './hooks/useMappedRoads';
import { ScenarioLab } from './components/ScenarioLab';
import { Evaluation, Materials } from './components/Resources';
import { Badge, Note } from './components/UI';
import { Icon } from './components/Icon';


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

  const [drawer,setDrawer]=useState(false);
  const [notifications,setNotifications]=useState(false);
  const [query,setQuery]=useState('');
  const settings=useRef<HTMLDialogElement>(null);
  const search=useRef<HTMLDialogElement>(null);
  const health=useHealth();
  const analysis=useAnalysis();
  const roadsState=useMappedRoads();
  const navigate=(next:Page)=>{setPage(next);if(next==='lab')setLabOpened(true);setDrawer(false);setNotifications(false);window.scrollTo({top:0,behavior:'instant'})};
  const selectSegment=(id:string)=>{roadsState.setSelected(id);navigate('network')};
  const healthLabel=health.loading?'Connecting…':health.health?health.health.model_loaded?'Trained model connected':'Image analysis connected':'Backend offline';
  const openSettings=()=>settings.current?.showModal();
  const searchResults=navigation.filter(x=>(x.label+' '+x.group).toLowerCase().includes(query.toLowerCase()));
  const roads=(roadsState.network?.segments??[]).filter(x=>(x.name+' '+x.id).toLowerCase().includes(query.toLowerCase()));
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
          <div className="topbar-actions"><span className="mode-select"><i className="dot good"/>Inspection data</span><span className="topbar-separator"/><button className="icon-button" aria-label="Search workspace" onClick={()=>{setQuery('');search.current?.showModal()}}><Icon name="search" size={18}/></button><div className="notification-wrapper"><button className="icon-button notification-trigger" aria-label="Service notifications" aria-expanded={notifications} onClick={()=>setNotifications(!notifications)}><Icon name="bell" size={18}/>{!health.health&&!health.loading&&<i/>}</button>{notifications&&<div className="notification-popover"><div className="panel-title"><h3>Workspace status</h3><button className="icon-button" aria-label="Close notifications" onClick={()=>setNotifications(false)}><Icon name="close" size={14}/></button></div><p><i className={'dot '+(health.health?'good':'fair')}/>{healthLabel}</p><small>{health.health?'Feature version: '+health.health.feature_version:health.error||'Checking the local service.'}</small><p><Icon name="scan" size={15}/>{analysis.result?'Latest analysis is ready.':'No completed live analysis this session.'}</p><button className="text-button" onClick={health.retry}>Retry service check<Icon name="refresh" size={14}/></button></div>}</div><div className="profile-avatar" aria-label="Local officer workspace" title="Local session · no account required">OF</div></div>
        </header>
        <div className="service-strip" role="status"><span><i className={'dot '+(health.loading?'lavender':health.health?'good':'offline')}/>{healthLabel}</span>{health.health?<small>{health.health.feature_version} · experimental assessment</small>:<button onClick={health.retry} disabled={health.loading} className="text-button">{health.loading?'Checking connection':'Retry connection'}<Icon name="refresh" size={12}/></button>}</div>
        <main id="main-content">
          {page==='overview'&&<InspectionDashboard roads={roadsState} analysis={analysis} onNavigate={navigate}/>}
          {page==='inspection'&&<><Inspection analysis={analysis} onSimulate={()=>navigate('lab')}/>{analysis.selected&&<section className="panel"><h2>Link this inspection to a real road</h2><p>Choose its location on the map and confirm the road segment. Saving is explicit; no location is inferred from the image.</p><button className="button primary" onClick={()=>navigate('network')}>Choose road on map</button></section>}</>}
          {page==='network'&&<InspectionRoadNetwork roads={roadsState} analysis={analysis} onInspect={()=>navigate('inspection')} onOverview={()=>navigate('overview')}/>}
          {page==='planner'&&<EvidenceRepairPlanner roads={roadsState} onNetwork={()=>navigate('network')}/>}
          {labOpened&&<div hidden={page!=='lab'}>{analysis.selected?<ScenarioLab active={page==='lab'} demo={false} selected={roadsState.selected} onNavigate={navigate} analysis={analysis}/>:<section className="panel"><h1>Scenario lab</h1><p>Upload a road capture to simulate its detected surface. No sample defects are substituted.</p><button className="button primary" onClick={()=>navigate('inspection')}>Upload road capture</button></section>}</div>}
          {page==='evaluation'&&<Evaluation/>}
          {page==='materials'&&<Materials/>}
        </main>
        <footer className="workspace-footer"><span>Road Health <i>·</i> Inspection & maintenance workspace</span><span>Inspection-backed analytics<i>·</i>Experimental v1.0</span></footer>
      </div>
    </div>
    <dialog ref={settings} className="settings-dialog" aria-labelledby="settings-title"><div className="dialog-header"><div><p className="eyebrow">LOCAL PREFERENCES</p><h2 id="settings-title">Workspace settings</h2></div><button className="icon-button" aria-label="Close settings" onClick={()=>settings.current?.close()}><Icon name="close"/></button></div><Note>Dashboard scores come from backend detection evidence. Map geometry never supplies road quality.</Note><h3>Provisional Road Quality Score</h3><p>Start at 100 and subtract area, hotspot and spread penalties. Defect type, visible severity, location and confidence affect the calculation; overlapping regions are not counted repeatedly.</p><p className="fine-print">Excellent ≥90; Good ≥75; Fair ≥55; Poor ≥35; otherwise Critical. These bands are uncalibrated. Confidence is separate from the condition score.</p><div className="settings-api"><Badge tone={health.health?'good':'fair'}>{healthLabel}</Badge><p>Local API: <code>/api → 127.0.0.1:8000</code></p><small>Provider URLs and scoring configuration are set on the backend. Public services have request limits. No secret keys belong in frontend variables.</small></div><div className="dialog-actions"><button className="button primary" onClick={()=>settings.current?.close()}>Close settings</button></div></dialog>
    <dialog ref={search} className="search-dialog" aria-labelledby="search-title"><div className="dialog-header"><h2 id="search-title">Search workspace</h2><button className="icon-button" aria-label="Close search" onClick={()=>search.current?.close()}><Icon name="close"/></button></div><label className="search-field"><Icon name="search" size={19}/><input autoFocus placeholder="Search tools, roads, or localities…" aria-label="Search tools, roads, or localities" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="search-results"><p className="eyebrow">WORKSPACE</p>{searchResults.map(x=><button key={x.id} onClick={()=>{navigate(x.id);search.current?.close()}}><Icon name={x.icon} size={17}/>{x.label}<Icon name="arrow" size={15}/></button>)}<p className="eyebrow">MAPPED ROAD SEGMENTS</p>{roads.map(x=><button key={x.id} onClick={()=>{selectSegment(x.id);search.current?.close()}}><Icon name="road" size={17}/><span>{x.name}<small>{x.inspection?'Inspection linked':'Not inspected'} · {x.id}</small></span><Icon name="arrow" size={15}/></button>)}{!searchResults.length&&!roads.length&&<p className="fine-print">No matching roads or tools.</p>}</div></dialog>
  </>;
}
