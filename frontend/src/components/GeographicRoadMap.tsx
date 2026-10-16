import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {MapBounds,MapConfig,MappedSegment} from '../api/map';
import {scoreColor} from '../network/analytics';
interface Props {config:MapConfig;segments:MappedSegment[];selected:string;onSelect:(id:string,point?:[number,number])=>void;onBounds:(b:MapBounds)=>void;destination?:[number,number];compact?:boolean}
export function GeographicRoadMap({config,segments,selected,onSelect,onBounds,destination,compact=false}:Props){
 const container=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),roads=useRef<L.LayerGroup|null>(null),layers=useRef(new Map<string,L.Polyline>());
 const callbacks=useRef({onSelect,onBounds});const initialSegments=useRef(segments);
 const [tilesFailed,setTilesFailed]=useState(false);
 useEffect(()=>{callbacks.current={onSelect,onBounds}},[onSelect,onBounds]);
 useEffect(()=>{
  if(!container.current)return;
  const initial=initialSegments.current.find(s=>s.inspection)??initialSegments.current[0];
  const xy=initial?.coordinates[Math.floor(initial.coordinates.length/2)];
  const layerIndex=layers.current;
  const m=L.map(container.current,{preferCanvas:true,scrollWheelZoom:false}).setView(xy?[xy[1],xy[0]]:config.center,16);map.current=m;
  // Browser cache is respected; no tile proxy, prefetch, or offline download.
  const tiles=L.tileLayer(config.tile_url,{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:config.max_zoom,keepBuffer:0,updateWhenIdle:true}).addTo(m);
  tiles.on('tileerror',()=>setTilesFailed(true));tiles.on('load',()=>{/* A retry is explicit; never silently swap providers. */});
  roads.current=L.layerGroup().addTo(m);L.control.scale({imperial:false}).addTo(m);
  const moved=()=>{const b=m.getBounds();callbacks.current.onBounds({south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()})};
  m.on('moveend',moved);m.on('click',(event:L.LeafletMouseEvent)=>{
   const text=document.createElement('span');text.textContent=event.latlng.lat.toFixed(6)+', '+event.latlng.lng.toFixed(6);
   L.popup().setLatLng(event.latlng).setContent(text).openOn(m);
  });
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>m.invalidateSize()):null;observer?.observe(container.current);moved();
  return()=>{observer?.disconnect();m.remove();map.current=null;roads.current=null;layerIndex.clear()};
 },[config]);
 useEffect(()=>{
  const group=roads.current,m=map.current;if(!group||!m)return;group.clearLayers();layers.current.clear();
  for(const segment of segments){
   const score=segment.inspection?.score;
   const line=L.polyline(segment.coordinates.map(p=>[p[1],p[0]] as [number,number]),{color:scoreColor(score?.score),weight:5,opacity:.9,dashArray:score?undefined:'6 6'}).addTo(group);
   const content=document.createElement('div');const heading=document.createElement('strong');heading.textContent=segment.name;content.append(heading,document.createElement('br'));
   const description=document.createElement('span');description.textContent=score?score.score.toFixed(1)+' / 100 · '+score.rating+' · Provisional':'Not inspected';content.append(description);
   line.bindTooltip(content,{sticky:true});
   line.on('click',(event:L.LeafletMouseEvent)=>{L.DomEvent.stopPropagation(event);callbacks.current.onSelect(segment.id,[event.latlng.lat,event.latlng.lng]);line.bindPopup(content.cloneNode(true) as HTMLElement).openPopup(event.latlng)});
   layers.current.set(segment.id,line);
  }
 },[segments,config]);
 useEffect(()=>{if(destination)map.current?.setView(destination,16)},[destination]);
 useEffect(()=>{
  for(const [id,line] of layers.current)line.setStyle({weight:id===selected?8:5});
  const m=map.current,line=layers.current.get(selected);if(line)line.bringToFront();if(m&&line&&!m.getBounds().intersects(line.getBounds()))m.fitBounds(line.getBounds(),{padding:[35,35],maxZoom:17});
 },[selected,segments]);
 return <div className={'geo-map-wrap '+(compact?'compact':'')}>
  <div ref={container} className="geo-map" role="region" aria-label="Interactive OpenStreetMap road network"/>
  {tilesFailed&&<div className="map-tile-error" role="status">Base map tiles could not load. Inspection geometry is still shown. Check your connection or map provider. <button className="text-button" onClick={()=>{setTilesFailed(false);map.current?.eachLayer(layer=>{if(layer instanceof L.TileLayer)layer.redraw()})}}>Retry tiles</button></div>}
  <p className="map-provider-credit">{config.tile_attribution} · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a></p>
 </div>;
}
