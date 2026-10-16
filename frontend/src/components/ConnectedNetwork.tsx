
import {useMemo,useState} from 'react';
import type {AnalysisController} from '../hooks/useAnalysis';
import type {NetworkController} from '../hooks/useRoadNetwork';
import {projectNetwork,roadGraph,shortestRoute,roadHitPath} from '../network/graph';
import {Badge,Note,PanelTitle} from './UI';
import {DefectReview} from './DefectReview';
import {downloadJson,number,percent} from '../utils/formatters';
export function ConnectedNetwork({network,analysis,onInspect,onTwin}:{network:NetworkController;analysis:AnalysisController;onInspect:()=>void;onTwin:()=>void}){
  const [zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0});
  const [start,setStart]=useState(''),[end,setEnd]=useState('');
  const graph=useMemo(()=>roadGraph(network.links),[network.links]);
  const project=useMemo(()=>graph.nodes.length?projectNetwork(graph):()=>[0,0] as [number,number],[graph]);
  const route=useMemo(()=>start!==''&&end!==''?shortestRoute(graph,Number(start),Number(end)):null,[graph,start,end]);
  const link=network.links.find(x=>x.id===network.selected);
  const record=network.records[network.selected];
  const sameCapture=record?.result===analysis.result;
  const junctions=graph.nodes.filter(n=>n.links.length>1);
  const candidates=(record?.result.defect_detection?.defects??[]).filter(d=>!record?.excludedCandidates.includes(d.id));
  const captureReady=!!analysis.result&&!!analysis.selected&&!analysis.busy;
  return <div className="page-enter connected-network">
    <div className="page-heading"><div><p className="eyebrow">CONNECTED ROAD NETWORK</p><h1>Road network<span className="heading-dot">.</span></h1><p>Import surveyed road lines, inspect connectivity, and attach actual capture results.</p></div><label className="button secondary file-button">Import road GeoJSON<input type="file" accept=".geojson,.json,application/geo+json,application/json" aria-label="Import road GeoJSON" onChange={e=>{const file=e.target.files?.[0];if(file)void network.importFile(file);e.target.value='';setStart('');setEnd('');setZoom(1);setPan({x:0,y:0})}}/></label></div>
    {network.error&&<p role="alert" className="field-error">{network.error}</p>}
    <Note>Import WGS84 LineString or MultiLineString roads with shared junction vertices. Vertices within 2 m are joined; crossings without shared vertices remain separate. Road geometry and capture associations stay in this session. Photos are never located automatically.</Note>
    {!network.links.length?<section className="panel"><PanelTitle title="Your network has no mapped roads yet"/><p>Choose a GeoJSON road export to display its real geometry, junctions, lengths and connected routes.</p><div className="sim-actions"><button className="button secondary" onClick={onInspect}>Inspect an uploaded road</button><a className="button secondary" href="/road-network-template.geojson" download>Download format example</a></div><p className="fine-print">The downloadable example contains explicitly fictional coordinates for checking the file format. It is not a surveyed network.</p></section>:<>
    <section className="panel"><PanelTitle title="Mapped roads"><Badge>{graph.components} connected component{graph.components===1?'':'s'}</Badge></PanelTitle>
      <div className="measurement-grid compact-metrics"><div className="measurement"><span>Road length</span><strong>{number(network.links.reduce((s,l)=>s+l.length,0)/1000,2)} km</strong></div><div className="measurement"><span>Segments</span><strong>{network.links.length}</strong></div><div className="measurement"><span>Shared junctions</span><strong>{junctions.length}</strong></div><div className="measurement"><span>Inspected segments</span><strong>{Object.keys(network.records).length}</strong></div></div>
      <div className="network-map" style={{touchAction:'none'}}>
        <svg viewBox="0 0 720 400" className="map-svg" aria-label="Imported connected road geometry" onPointerDown={e=>{if((e.target as Element).closest('[role="button"]'))return;e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.dataset.dragX=String(e.clientX);e.currentTarget.dataset.dragY=String(e.clientY)}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const ratio=1/(e.currentTarget.getScreenCTM()?.a??1);const x=Number(e.currentTarget.dataset.dragX),y=Number(e.currentTarget.dataset.dragY);setPan(p=>({x:p.x+(e.clientX-x)*ratio,y:p.y+(e.clientY-y)*ratio}));e.currentTarget.dataset.dragX=String(e.clientX);e.currentTarget.dataset.dragY=String(e.clientY)}}>
          <rect width="720" height="400" fill="#e7e8dc"/>
          <g transform={'translate('+(360-360*zoom+pan.x)+' '+(200-200*zoom+pan.y)+') scale('+zoom+')'}>
            {network.links.map(l=>{const active=l.id===network.selected,attached=!!network.records[l.id];return <g key={l.id}>
              <polyline points={l.coordinates.map(p=>project(p).join(',')).join(' ')} fill="none" stroke="#fcfbf5" strokeWidth={12/zoom} strokeLinejoin="round" strokeLinecap="round"/>
              <polyline points={l.coordinates.map(p=>project(p).join(',')).join(' ')} fill="none" stroke={route?.links.includes(l.id)?'#946d32':active?'#403548':attached?'#6b8690':'#9c9d92'} strokeWidth={(active?6:4)/zoom} strokeLinejoin="round" strokeLinecap="round"/>
              <path d={roadHitPath(l.coordinates.map(project),11/zoom)} fill="transparent" role="button" tabIndex={0} aria-label={'Select road '+l.name} aria-pressed={active} onClick={()=>network.setSelected(l.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();network.setSelected(l.id)}}}><title>{l.name+' · '+number(l.length)+' m'}</title></path>
            </g>})}
            {junctions.map(n=>{const [x,y]=project(n.position);return <g key={n.id}><circle cx={x} cy={y} r={5/zoom} fill="#faf9f1" stroke="#6a6257" strokeWidth={1.5/zoom}/><title>J{n.id+1} · {n.links.length} roads share this vertex</title></g>})}
            {[start,end].filter(Boolean).map((id,i)=>{const n=graph.nodes[Number(id)];if(!n)return null;const [x,y]=project(n.position);return <g key={i}><circle cx={x} cy={y} r={10/zoom} fill={i?'#916442':'#484c3a'}/><text x={x} y={y+3/zoom} fontSize={10/zoom} textAnchor="middle" fill="white">{i?'B':'A'}</text></g>})}
          </g>
        </svg>
        <div className="map-bottom"><span className="fine-print">Geometry to scale · gray: uninspected · blue: capture attached · amber: route</span><div className="map-controls"><button aria-label="Fit imported network" onClick={()=>{setZoom(1);setPan({x:0,y:0})}}>Fit</button><button aria-label="Zoom imported network out" disabled={zoom<=.5} onClick={()=>setZoom(z=>Math.max(.5,z/1.3))}>−</button><button aria-label="Zoom imported network in" disabled={zoom>=8} onClick={()=>setZoom(z=>Math.min(8,z*1.3))}>+</button></div></div>
      </div>
      <div className="network-routing">{(['From','To'] as const).map((label,i)=><label className="field" key={label}>{label}<select aria-label={label+' network node'} value={i?end:start} onChange={e=>(i?setEnd:setStart)(e.target.value)}><option value="">Choose a node</option>{graph.nodes.map(n=><option key={n.id} value={n.id}>J{n.id+1} · {n.links.join(', ')}</option>)}</select></label>)}<div role="status">{start!==''&&end!==''?(route?<><strong>{number(route.distance/1000,2)} km</strong><p className="fine-print">{route.links.length} road segment(s). Shortest distance on an undirected graph; traffic rules, travel time and safety are not modeled.</p></>:<p>No connected route. Check shared junction vertices or disconnected components.</p>):<p className="fine-print">Select start and end nodes to trace a connected route.</p>}</div></div>
    </section>
    <div className="network-detail-grid"><section className="panel"><PanelTitle title="Segment inspection"/><label className="field">Mapped segment<select aria-label="Mapped segment" value={network.selected} onChange={e=>network.setSelected(e.target.value)}>{network.links.map(l=><option value={l.id} key={l.id}>{l.name} · {l.id}</option>)}</select></label>{link&&<p>{number(link.length)} m · WGS84 geometry · {link.coordinates.length} vertices</p>}
      <button className="button primary" disabled={!captureReady} onClick={()=>network.attach(analysis.selected!.file.name,analysis.result!,analysis.excludedDefects)}>Attach current analysis to this segment</button>
      <p className="fine-print">{captureReady?'Current capture: '+analysis.selected!.file.name:'Upload a capture and wait for its full analysis before assigning it.'} This assigns one local observation; it does not survey the full segment.</p>
      {record?<><h3>{record.name}</h3><p className="fine-print">Attached {new Date(record.capturedAt).toLocaleString()} · {sameCapture?'Current analysis snapshot':'Saved session snapshot'}</p><div className="measurement-grid"><div className="measurement"><span>Visual defect candidates</span><strong>{candidates.length}</strong></div><div className="measurement"><span>Chip candidates</span><strong>{record.result.chip_candidate_count}</strong></div><div className="measurement"><span>Candidate chip coverage</span><strong>{percent(record.result.features.chip_coverage_fraction)}</strong></div><div className="measurement"><span>Health grade</span><strong>{record.result.assessment.validated?record.result.assessment.band:'Unvalidated'}</strong></div></div><button className="button secondary" onClick={()=>downloadJson({segment:link,inspection:record},'segment-inspection')}>Export segment inspection</button>{sameCapture&&<button className="button secondary" onClick={onTwin}>Open this capture in digital twin</button>}</>:<p>No capture assigned. Gray roads have unknown condition.</p>}</section>
      <section className="panel"><PanelTitle title="Connectivity checks"/><p>{graph.components===1?'All road vertices belong to one connected component.':graph.components+' disconnected components. No route is invented across gaps.'}</p><p>{junctions.length} shared vertices connect multiple road records. Junctions are included even when they occur inside a polyline.</p><p className="fine-print">Survey geometry, elevation, overpasses, lane direction and road restrictions require authoritative mapping data. Shared coordinates alone do not verify a legal driving connection. Surface condition is never inferred from map geometry.</p></section></div>
    {sameCapture&&analysis.selected&&<DefectReview url={analysis.selected.url} detection={record.result.defect_detection??null} busy={false} error="" excluded={analysis.excludedDefects} onToggle={analysis.toggleDefect} onRetry={analysis.retryDetection}/>}
    </>}
  </div>;
}
