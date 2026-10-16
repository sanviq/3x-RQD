import { useMemo, useRef } from 'react';
import type { Mark, Waypoint } from '../simulation/model';
import { clamp, orderedPath, surfaceSeverity } from '../simulation/model';
export function RoadAnnotations({texture,marks,path,selected,onSelect,onAdd,onMove,onPath,mode,heatmap=false}:
  {texture:HTMLCanvasElement|null;marks:Mark[];path:Waypoint[];selected:string;onSelect:(id:string)=>void;
   onAdd:(x:number,y:number)=>void;onMove:(id:string,x:number,y:number)=>void;onPath:(path:Waypoint[])=>void;
   mode:'Defect'|'Path'|'Select';heatmap?:boolean}) {
  const drag=useRef<string|null>(null);
  const imageUrl=useMemo(()=>texture?.toDataURL('image/png'),[texture]);
  const coordinates=(e:React.PointerEvent<HTMLElement>)=>{const rect=e.currentTarget.getBoundingClientRect();return {x:clamp((e.clientX-rect.left)/rect.width,0,1),y:clamp((e.clientY-rect.top)/rect.height,0,1)}};
  return <div className={'annotation-stage '+(mode==='Select'?'select-mode':'')} role="button" tabIndex={0}
    aria-label={mode==='Path'?'Add a driving waypoint on the road image':mode==='Defect'?'Mark a defect on the road image':'Select and move road annotations'}
    onKeyDown={e=>{if(e.key==='Enter'&&e.target===e.currentTarget){if(mode==='Defect')onAdd(.5,.5);else if(mode==='Path')onPath([...path,{x:.5,y:.5}])}}}
    onPointerDown={e=>{if(!texture)return;const p=coordinates(e);if(mode==='Defect')onAdd(p.x,p.y);else if(mode==='Path')onPath([...path,p]);}}
    onPointerMove={e=>{if(!drag.current)return;const p=coordinates(e);onMove(drag.current,p.x,p.y)}}
    onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
    {texture?<img src={imageUrl} alt="Rectified road with API candidates, manual annotations and driving path" draggable={false}/>:<div className="annotation-loading">Loading road texture…</div>}
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="annotation-overlay" aria-label="Defect contours and driving path">
      <polyline points={orderedPath(path).map(p=>p.x*1000+','+p.y*1000).join(' ')} fill="none" stroke="#f2d07b" strokeWidth="5" strokeDasharray="14 11" pointerEvents="none"/>
      {path.map((p,i)=><g key={i} pointerEvents="none"><circle cx={p.x*1000} cy={p.y*1000} r="11" fill="#f3d28b" stroke="#61563d" strokeWidth="3"/><text x={p.x*1000+17} y={p.y*1000+5} fill="#f9edc5" stroke="#3c4432" strokeWidth="1" paintOrder="stroke" fontSize="21">P{i+1}</text></g>)}
      {marks.map(mark=><g key={mark.id} role="button" tabIndex={0} aria-label={'Select '+mark.id+' '+mark.kind+(mark.repaired?', selected for repair':'')}
        onPointerDown={e=>{e.stopPropagation();onSelect(mark.id);drag.current=mark.id;e.currentTarget.parentElement?.parentElement?.setPointerCapture(e.pointerId)}}
        onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSelect(mark.id)}if(e.key.startsWith('Arrow')){e.preventDefault();e.stopPropagation();onMove(mark.id,clamp(mark.x+(e.key==='ArrowLeft'?-.01:e.key==='ArrowRight'?.01:0),0,1),clamp(mark.y+(e.key==='ArrowUp'?-.01:e.key==='ArrowDown'?.01:0),0,1))}}}>
        {mark.polygon?<polygon points={mark.polygon.map(p=>p.x*1000+','+p.y*1000).join(' ')} fill={surfaceSeverity(mark)>=.67?'#cb694b':surfaceSeverity(mark)>=.34?'#d8b45d':'#9db184'} fillOpacity={heatmap?.6:.18} stroke={selected===mark.id?'#fff4cc':'#e9ad75'} strokeWidth={selected===mark.id?6:3}/>:<ellipse cx={mark.x*1000} cy={mark.y*1000} rx={mark.width*500} ry={mark.length*500}
          fill={!heatmap&&mark.repaired?'#81a48c':surfaceSeverity(mark)>=.67?'#cb694b':surfaceSeverity(mark)>=.34?'#d8b45d':'#9db184'}
          fillOpacity={heatmap?.6:.2} stroke={selected===mark.id?'#fff4cc':!heatmap&&mark.repaired?'#bfd3b4':'#e9ad75'} strokeWidth={selected===mark.id?6:3}/>}
        <circle cx={mark.x*1000} cy={mark.y*1000} r="8" fill="#fff4ce"/>
        <text x={mark.x*1000+12} y={mark.y*1000-13} fill="#fff6db" stroke="#343b30" strokeWidth="3" paintOrder="stroke" fontSize="22">{mark.id}{!heatmap&&mark.repaired?' ✓':''}</text>
      </g>)}
    </svg>
  </div>;
}
