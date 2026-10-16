import { useMemo } from 'react';
import { surfaceProfile } from '../simulation/model';
import type { Mark, RoadConfig, Waypoint } from '../simulation/model';
export function SurfaceProfile({marks,config,path,position}:{marks:Mark[];config:RoadConfig;path:Waypoint[];position:number}) {
  const samples=useMemo(()=>surfaceProfile(marks,config,path,360),[marks,config,path]);
  const extent=Math.max(20,...samples.flatMap(p=>[Math.abs(p.leftMm),Math.abs(p.rightMm)]));
  const x=(z:number)=>55+(z-1.6)/(config.length-3.2)*650,y=(mm:number)=>95-mm/extent*63;
  return <div className="surface-profile"><h3>Wheel-track surface profile</h3><p className="fine-print">Sampled height field in assumed millimetres. Display exaggeration never changes these values or the suspension physics.</p>
    <svg viewBox="0 0 760 205" role="img" aria-label="Left and right wheel-track road height, in assumed millimetres">
      <rect x="0" y="0" width="760" height="205" rx="12" fill="#182832"/>
      {[-1,0,1].map(t=><g key={t}><path d={'M55 '+y(t*extent)+'H705'} stroke="#8ca2a133" strokeDasharray="4 5"/><text x="48" textAnchor="end" y={y(t*extent)+4} fill="#b5c5c4" fontSize="11">{Math.round(t*extent)}</text></g>)}
      {(['leftMm','rightMm'] as const).map((key,i)=><polyline key={key} points={samples.map(p=>x(p.z)+','+y(p[key])).join(' ')} fill="none" stroke={i?'#8ac4d1':'#efbe89'} strokeWidth="2"/>)}
      <path d={'M'+x(position)+' 25V165'} stroke="#f3e7c299" strokeDasharray="3 4"/>
      <text x="55" y="187" fill="#c0ceca" fontSize="11">0</text><text x="705" textAnchor="end" y="187" fill="#c0ceca" fontSize="11">{(config.length-3.2).toFixed(1)} m</text>

    </svg><div className="profile-legend"><span>Left wheel · amber</span><span>Right wheel · blue</span></div>
  </div>;
}
