import { useMemo, useRef } from 'react';
import { clamp } from '../simulation/model';
import { fullQuad, sceneQuad, validQuad } from '../simulation/projection';
import type { RoadQuad } from '../simulation/projection';
export function RoadFootprint({image,quad,onChange,coverage}:{image:HTMLCanvasElement;quad:RoadQuad;coverage?:{x:number;y:number}[];onChange:(q:RoadQuad)=>void}) {
  const url=useMemo(()=>image.toDataURL(),[image]),drag=useRef<number|null>(null);
  const update=(i:number,x:number,y:number)=>{
    const next=quad.map((p,n)=>n===i?{x:clamp(x,0,1),y:clamp(y,0,1)}:p) as RoadQuad;
    if(validQuad(next))onChange(next);
  };
  return <div className="road-footprint">
    <div className="footprint-stage" style={{aspectRatio:image.width+' / '+image.height,maxWidth:Math.round(500*image.width/image.height)+'px',margin:'0 auto'}}><img src={url} alt="Uploaded reference frame with editable road footprint"/>
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Road footprint editor"
        onPointerMove={e=>{if(drag.current===null)return;const r=e.currentTarget.getBoundingClientRect();update(drag.current,(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height)}}
        onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
        <path d={'M0 0H1000V1000H0Z M'+(coverage??quad).map(p=>p.x*1000+' '+p.y*1000).join('L')+'Z'} fill="#17231f88" fillRule="evenodd"/>
        <polygon points={(coverage??quad).map(p=>p.x*1000+','+p.y*1000).join(' ')} fill="#d4c18318" stroke="#f2d998" strokeWidth="3"/>
        {quad.map((p,i)=><g key={i} role="slider" tabIndex={0} aria-label={['Far left road corner','Far right road corner','Near right road corner','Near left road corner'][i]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.x*100)} aria-valuetext={Math.round(p.x*100)+' percent across, '+Math.round(p.y*100)+' percent down'}
          onPointerDown={e=>{e.preventDefault();drag.current=i;e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId)}}
          onKeyDown={e=>{const step=e.shiftKey?.02:.005;const keys:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};if(keys[e.key]){e.preventDefault();update(i,p.x+keys[e.key][0],p.y+keys[e.key][1])}}}>
          <circle cx={p.x*1000} cy={p.y*1000} r="24" fill="#fff1c5" stroke="#334c43" strokeWidth="3"/><text x={p.x*1000} y={p.y*1000+6} textAnchor="middle" fontSize="19" fill="#263e34">{i+1}</text>
        </g>)}
      </svg>
    </div>
    <div className="sim-path-tools"><button className="text-button" onClick={()=>onChange(sceneQuad)}>Perspective road preset</button><button className="text-button" onClick={()=>onChange(fullQuad)}>Entire surface crop</button></div>
    <p className="input-help">Drag the four corners around the visible road. The preset is an assumption; align it to your capture. Arrow keys move a focused corner. Sky and roadside objects outside this outline are excluded from the 3D road.</p>
  </div>;
}
