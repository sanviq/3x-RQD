import { useState } from 'react';
import { segments, score, conditionClass, band } from '../data/demo';
import type { Weights } from '../types/api';
import { Icon } from './Icon';
export function NetworkMap({weights,selected,onSelect,repaired=[],filter='All',compact=false}:{weights:Weights;selected:string;onSelect:(id:string)=>void;repaired?:string[];filter?:string;compact?:boolean}) {
  const [zoom,setZoom]=useState(1);
  const [labels,setLabels]=useState(true);
  const visible=segments.filter(x=>filter==='All'||band(score(x,weights,repaired.includes(x.id)))===filter);
  return <div className={'network-map '+(compact?'compact':'')}>
    <div className="map-watermark"><span className="map-location"><Icon name="pin" size={14}/> East Bengaluru</span><span>Schematic · sample coordinates</span></div>
    <svg viewBox="0 0 720 400" className="map-svg" role="group" aria-label="Interactive schematic of six demonstration road segments">
      <defs><pattern id="map-grid" width="80" height="72" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)"><rect width="65" height="57" x="8" y="8" rx="9" fill="#e4e3d5"/><path d="M80 0H0V72" fill="none" stroke="#f5f3e7" strokeWidth="6"/></pattern><filter id="map-shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity=".08"/></filter></defs>
      <g transform={'translate('+(360-360*zoom)+' '+(200-200*zoom)+') scale('+zoom+')'}>
        <rect width="720" height="400" fill="url(#map-grid)"/>
        <path d="M0 310Q130 286 180 335T350 380M500 0Q470 52 518 79T690 125" stroke="#cfd5b9" strokeWidth="24" fill="none" opacity=".7"/>
        <path d="M0 130 185 125 270 52 396 20M155 400 226 295 188 180 220 0M720 238 613 212 490 238 410 400" fill="none" stroke="#faf8ee" strokeWidth="9"/>
        <path d="M660 0q-60 90 20 158t-18 242" fill="none" stroke="#cad7d4" strokeWidth="13"/>
        {visible.map(segment=>{
          const value=score(segment,weights,repaired.includes(segment.id));
          const isSelected=selected===segment.id;
          return <g key={segment.id}>
            {isSelected&&<polyline points={segment.points} fill="none" stroke="#fffdf4" strokeWidth="19" strokeLinecap="round" strokeLinejoin="round" filter="url(#map-shadow)"/>}
            <polyline points={segment.points} className={'map-route '+conditionClass(value)+(isSelected?' selected':'')} fill="none" strokeWidth={isSelected?9:6} strokeLinecap="round" strokeLinejoin="round" role="button" tabIndex={0} aria-label={segment.name+', '+band(value)+', score '+value+(repaired.includes(segment.id)?', simulated repair':'')} aria-pressed={isSelected} onClick={()=>onSelect(segment.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(segment.id)}}}/>
            {labels&&<text x={segment.label[0]} y={segment.label[1]} textAnchor="middle" className="map-label" pointerEvents="none">{segment.id.replace('RH-','S')}</text>}
          </g>
        })}
        <g transform="translate(82 218)"><circle r="11" fill="#fffdf6"/><circle r="5" fill="#44342b"/></g>
      </g>
    </svg>
    <div className="map-bottom"><div className="map-legend"><span><i className="dot good"/>Good</span><span><i className="dot fair"/>Moderate</span><span><i className="dot poor"/>Bad</span>{repaired.length>0&&<span>Repair scenario</span>}</div><div className="map-controls"><button aria-label="Toggle map labels" aria-pressed={labels} onClick={()=>setLabels(!labels)}><Icon name="layers" size={16}/></button><button aria-label="Zoom out" disabled={zoom<=1} onClick={()=>setZoom(x=>Math.max(1,x-.2))}>−</button><button aria-label="Zoom in" disabled={zoom>=1.8} onClick={()=>setZoom(x=>Math.min(1.8,x+.2))}>+</button></div></div>
  </div>;
}
