import {useEffect,useRef,useState} from 'react';
import type {MappedRoadsController} from '../hooks/useMappedRoads';
import type {MapBounds,SearchPlace} from '../api/map';
import {searchMapLocation} from '../api/map';
import {initialRoadBounds} from '../network/analytics';
import {GeographicRoadMap} from './GeographicRoadMap';
import {Badge,PanelTitle} from './UI';
import {Icon} from './Icon';
export function RoadMapPanel({roads,compact=false,onLocation}:{roads:MappedRoadsController;compact?:boolean;onLocation?:(id:string,point:[number,number])=>void}){
 const [query,setQuery]=useState(''),[places,setPlaces]=useState<SearchPlace[]>([]),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState('');
 const [bounds,setBounds]=useState<MapBounds|null>(null),[destination,setDestination]=useState<[number,number]>();
 const request=useRef<AbortController|null>(null),loaded=useRef(false);
 const {config,network,load}=roads;
 useEffect(()=>{if(config&&network&&!loaded.current){loaded.current=true;if(!network.segments.length)void load(initialRoadBounds(config.center))}},[config,network,load]);
 useEffect(()=>()=>request.current?.abort(),[]);
 const search=async(e:React.FormEvent)=>{
  e.preventDefault();request.current?.abort();const c=new AbortController();request.current=c;setSearching(true);setSearchError('');setPlaces([]);
  try{const next=await searchMapLocation(query.trim(),c.signal);if(!c.signal.aborted){setPlaces(next);if(!next.length)setSearchError('No matching locations. Try a nearby street or city.')}}catch(e){if(!c.signal.aborted)setSearchError((e as Error).message)}finally{if(!c.signal.aborted)setSearching(false)}
 };
 const choose=(place:SearchPlace)=>{const center:[number,number]=[place.latitude,place.longitude];setDestination(center);setPlaces([]);setQuery(place.label);void roads.load(initialRoadBounds(center))};
 const loadView=()=>{if(bounds)void roads.load(bounds)};
 return <section className="panel real-map-panel"><PanelTitle title="Your road network" eyebrow="OPENSTREETMAP · ACTUAL GEOMETRY"><Badge>{network?.segments.length??0} mapped segments</Badge></PanelTitle>
  <form className="map-search" onSubmit={e=>void search(e)}><label className="sr-only" htmlFor={compact?'map-search-overview':'map-search-network'}>Search map location</label><input id={compact?'map-search-overview':'map-search-network'} placeholder="Search a street, locality, or city" value={query} maxLength={160} onChange={e=>setQuery(e.target.value)}/><button className="button secondary small" disabled={searching||query.trim().length<2}>{searching?'Searching…':'Search'}<Icon name="search" size={14}/></button></form>
  {places.length>0&&<ul className="map-search-results">{places.map((p,i)=><li key={i}><button onClick={()=>choose(p)}>{p.label}<small>{p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</small></button></li>)}</ul>}
  {searchError&&<p role="alert" className="field-error">{searchError}</p>}
  {config?<GeographicRoadMap config={config} segments={network?.segments??[]} selected={roads.selected} onSelect={(id,point)=>{roads.setSelected(id);if(point)onLocation?.(id,point)}} onBounds={setBounds} destination={destination} compact={compact}/>:<div className="map-unavailable">{roads.busy?<><span className="spinner"/> Connecting to map service…</>:'The map service is unavailable. Start FastAPI and retry.'}</div>}
  <div className="map-toolbar"><button className="button secondary small" disabled={!bounds||roads.busy||roads.saving} onClick={loadView}>{roads.busy?'Loading roads…':'Load roads in view'}<Icon name="refresh" size={14}/></button><button className="text-button" disabled={roads.busy||roads.saving} onClick={()=>void roads.refresh()}>Reload saved inspections</button></div>
  {roads.error&&<p role="alert" className="field-error">{roads.error}</p>}
  {!roads.error&&network?.provider_notice&&<p role="status" className="fine-print">{network.provider_notice}</p>}
  {!roads.busy&&!roads.error&&network?.segments.length===0&&<p role="status" className="fine-print">No driveable road lines found in this area. Pan to a nearby street and press “Load roads in view”.</p>}
  <div className="map-legend"><span><i style={{background:'#4d7665'}}/>Excellent / Good</span><span><i style={{background:'#bf9344'}}/>Fair</span><span><i style={{background:'#bb6954'}}/>Poor / Critical</span><span><i style={{background:'#858b88'}}/>Not inspected</span></div>
  <p className="fine-print">{config?.location_label}. Search is submitted only when you press Search. Pan and zoom freely; use “Load roads in view” to request a small area. Colors represent photo-based estimates on assigned segments, not a complete pavement survey.</p>
 </section>;
}
