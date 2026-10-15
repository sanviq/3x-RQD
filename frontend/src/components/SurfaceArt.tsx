import { useId } from 'react';
import type { Defect } from '../data/demo';
export function SurfaceArt({mode='original',defects=[],active,onSelect,stress='none',intensity=40}:{mode?:string;defects?:Defect[];active?:string;onSelect?:(id:string)=>void;stress?:string;intensity?:number}) {
  const uid=useId().replace(/:/g,'');
  const chips=Array.from({length:150},(_,i)=>({x:(i*137+23)%800,y:(i*83+41)%500,r:3+(i*7)%11}));
  const filter=stress==='Low light'?'brightness('+(1-intensity/140)+')':stress==='Glare'?'brightness('+(1+intensity/90)+') contrast(.8)':stress==='Blur'?'blur('+(intensity/16)+'px)':undefined;
  return <div className={'surface-art mode-'+mode} style={{filter,transform:stress==='Perspective'?'perspective(650px) rotateX('+(intensity/5)+'deg)':undefined}}>
    <svg viewBox="0 0 800 500" role="img" aria-label="Synthetic road surface illustration, not a photograph">
      <defs><pattern id={'texture-'+uid} width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="#69665b"/><path d="m4 10 12-5 7 8-8 9-14-4m32 15 17-7 9 11-3 14-16-3M31 2l5 14-8 6-5-12" fill="#8a887b" stroke="#4d4c43" strokeWidth="2"/><path d="m3 48 8-11 13 4-4 14-12 3M45 5l10 2-1 12-12 1" fill="#a5a18f" stroke="#57574c" strokeWidth="2"/></pattern><linearGradient id={'light-'+uid}><stop stopColor="#151a15" stopOpacity=".4"/><stop offset=".6" stopColor="#f5edcd" stopOpacity=".07"/><stop offset="1" stopColor="#22261f" stopOpacity=".25"/></linearGradient></defs>
      <rect width="800" height="500" fill={'url(#texture-'+uid+')'}/>
      {chips.map((c,i)=><ellipse key={i} cx={c.x} cy={c.y} rx={c.r*1.6} ry={c.r} transform={'rotate('+(i*29)+' '+c.x+' '+c.y+')'} fill={i%3===0?'#c2bfa9':'#7e7c6c'} stroke={mode==='segmentation'?'#a0c797':'#525448'} strokeWidth={mode==='segmentation'?2:1}/>)}
      <path d="m422 0-28 70 16 45-40 60 10 40-50 65 20 50-22 50 10 42-25 78" fill="none" stroke={mode==='segmentation'?'#c96c59':'#30372e'} strokeWidth="6"/>
      <path d="m375 175 62 24 14 38 60 32m-174 135-49-31-28-49" fill="none" stroke={mode==='segmentation'?'#c96c59':'#30372e'} strokeWidth="3"/>
      <rect width="800" height="500" fill={'url(#light-'+uid+')'}/>
      {(mode==='detections'||mode==='heatmap'||mode==='severity')&&defects.map(d=><g key={d.id} role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} aria-label={d.id+' '+d.kind+', '+d.severity+' severity, synthetic'} onClick={()=>onSelect?.(d.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(d.id)}}}>
        {mode==='heatmap'||mode==='severity'?<ellipse cx={d.x*8} cy={d.y*5} rx={65} ry={45} fill={d.severity==='High'?'#c75e48':d.severity==='Moderate'?'#c4a845':'#839c78'} opacity=".65"/>:<><rect x={d.x*8-55} y={d.y*5-40} width="110" height="80" rx="3" fill="#c76c4c" fillOpacity=".14" stroke={active===d.id?'#fff6d6':'#e6b382'} strokeWidth={active===d.id?4:2}/><rect x={d.x*8-55} y={d.y*5-62} width="140" height="22" rx="3" fill="#38291f"/><text x={d.x*8-48} y={d.y*5-47} fill="#fff8ea" fontSize="12">{d.kind+' '+Math.round(d.confidence*100)+'%'}</text></>}
      </g>)}
      {stress==='Shadow'&&<path d="M-50 0h350l300 500H260z" fill="#141916" opacity={intensity/130}/>}
      {stress==='Rain'&&Array.from({length:45},(_,i)=><path key={i} d={'m'+(i*127%800)+' '+(i*91%500)+'-20 42'} stroke="#d9e6e0" opacity={intensity/110} strokeWidth="2"/>)}
    </svg>
    <span className="synthetic-tag">Synthetic surface illustration</span>
  </div>;
}
