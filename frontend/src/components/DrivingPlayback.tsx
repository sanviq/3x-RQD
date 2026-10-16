import { useEffect, useRef, useState } from 'react';
import type { Defect, DrivingReport } from '../api/roadHealth';
import { number } from '../utils/formatters';
import { Badge, Note } from './UI';
import { Icon } from './Icon';

/** The overview is an actual projected 3D scene; the two camera feeds come from
 * the server renderer and have already passed through the inspection pipeline. */
export function DrivingPlayback({report,defects,repaired}:{report:DrivingReport;defects:Defect[];repaired:string[]}) {
 const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[yaw,setYaw]=useState(-24);
 const [overlay,setOverlay]=useState(true);
 const canvas=useRef<HTMLCanvasElement>(null);
 const count=Math.min(report.before.frames.length,report.after.frames.length);
 useEffect(()=>{setFrame(0);setPlaying(false)},[report]);
 const before=report.before.frames[frame],after=report.after.frames[frame];
 useEffect(()=>{if(!playing)return;const id=setInterval(()=>setFrame(value=>value>=count-1?value:value+1),350);return()=>clearInterval(id)},[playing,count]);
 useEffect(()=>{if(frame===count-1)setPlaying(false)},[frame,count]);
 useEffect(()=>{
  const c=canvas.current,ctx=c?.getContext('2d');if(!c||!ctx)return;
  c.width=1000;c.height=460;
  ctx.fillStyle='#e6e8dd';ctx.fillRect(0,0,c.width,c.height);
  const angle=yaw*Math.PI/180;
  const project=(x:number,y:number,z:number)=>{const rx=x*Math.cos(angle)-z*Math.sin(angle),rz=x*Math.sin(angle)+z*Math.cos(angle);return [500+rx*24,225+rz*6.6-y*24]};
  const shape=(points:number[][],color:string,stroke='#61735b33')=>{ctx.beginPath();points.forEach(([x,y,z],i)=>{const [px,py]=project(x,y,z);if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py)});ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=.8;ctx.stroke()};
  for(let z=-20;z<20;z+=1)for(let x=-3.5;x<3.5;x+=.5)shape([[x,0,z],[x+.5,0,z],[x+.5,0,z+1],[x,0,z+1]],'#788974');
  for(let z=-20;z<20;z+=3)shape([[-.035,.01,z],[.035,.01,z],[.035,.01,z+1.5],[-.035,.01,z+1.5]],'#f4edc6');
  for(const d of defects){
    const polygon=d.polygon.length?d.polygon:[[d.bbox[0],d.bbox[1]],[d.bbox[2],d.bbox[1]],[d.bbox[2],d.bbox[3]],[d.bbox[0],d.bbox[3]]];
    const repairedHere=repaired.includes(d.id);
    shape(polygon.map(([x,y])=>[(x-.5)*7,repairedHere?.01:-d.severity*.35,(y-.5)*40]),repairedHere?'#74ad8c':d.severity>=.7?'#bc6753':d.severity>=.4?'#ccac56':'#a3ba7c');
  }
  // The path and camera pose use the same function as the backend.
  const at=(progress:number)=>{const lane=Math.max(.04,Math.min(.96,report.path+report.path_curve*Math.sin(Math.PI*progress)));return [(lane-.5)*7,.12,24-progress*36]};
  ctx.beginPath();for(let i=0;i<=100;i++){const [x,y,z]=at(i/100),[px,py]=project(x,y,z);if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py)}ctx.strokeStyle='#f6d779';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
  const progress=count>1?frame/(count-1):0;const [cx,,cz]=at(progress);
  // Four side walls and a roof define the car, with a windshield facing forward.
  shape([[cx-.35,.1,cz-.7],[cx+.35,.1,cz-.7],[cx+.35,.7,cz-.7],[cx-.35,.7,cz-.7]],'#846b3f');
  shape([[cx+.35,.1,cz-.7],[cx+.35,.1,cz+.7],[cx+.35,.7,cz+.7],[cx+.35,.7,cz-.7]],'#ae9153');
  shape([[cx-.35,.7,cz-.7],[cx+.35,.7,cz-.7],[cx+.35,.7,cz+.7],[cx-.35,.7,cz+.7]],'#dfbd68');
  shape([[cx-.28,.72,cz-.54],[cx+.28,.72,cz-.54],[cx+.28,.72,cz-.18],[cx-.28,.72,cz-.18]],'#44616a');
  const [cameraX,cameraY]=project(cx,1,cz-.5);ctx.fillStyle='#e9f0e2';ctx.beginPath();ctx.arc(cameraX,cameraY,3,0,2*Math.PI);ctx.fill();
  ctx.font='12px sans-serif';ctx.fillStyle='#59654e';ctx.fillText('3D ROUTE OVERVIEW · ASSUMED GEOMETRY',24,29);ctx.fillText('Yellow path: same trajectory in both runs · green regions: selected repairs',24,436);
 },[report,defects,repaired,frame,count,yaw]);
 if(!before||!after)return null;
 return <div className="driving-playback">
  <Note>{report.notice}</Note>
  <canvas ref={canvas} className="driving-overview" aria-label="3D road and car following the chosen route; cavities are schematic and green regions indicate selected repairs"/>
  <div className="backend-controls"><label className="field">Rotate 3D route overview<input type="range" aria-label="Rotate driving overview" min="-65" max="65" value={yaw} onChange={e=>setYaw(Number(e.target.value))}/></label><label className="checkbox-row"><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)}/>Show pipeline detection overlays</label></div>
  <div className="driving-camera-pair">{[before,after].map((result,index)=><figure key={index}><div className="driving-feed-heading"><strong>{index?'After selected repairs':'Before repair'}</strong><Badge tone={index?'good':'fair'}>Synthetic camera</Badge></div><img src={result.images[overlay?'detections':'original']} alt={(index?'After selected repairs':'Before repairs')+' perspective car-mounted camera frame '+(frame+1)}/><figcaption>{result.assessment.defect_count} visible annotations · {number(result.timing.inference_ms)} ms pipeline prediction · frame {frame+1}/{count}</figcaption></figure>)}</div>
  <div className="action-row"><button className="button primary" onClick={()=>{if(frame===count-1)setFrame(0);setPlaying(v=>!v)}}><Icon name="car" size={16}/>{playing?'Pause playback':frame===count-1?'Replay same route':'Play same route'}</button><button className="button secondary" onClick={()=>{setPlaying(false);setFrame(0)}}>Reset</button><span className="fine-print">Distance: {number(before.camera_pose?.distance_m??0)} m · assumed {report.camera_height_m} m camera height</span></div>
  <label className="field driving-timeline">Compare the same position · frame {frame+1}<input type="range" aria-label="Same-route comparison frame" min="0" max={count-1} value={frame} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value))}}/></label>
  <div className="table-scroll"><table><thead><tr><th>Simulated metric</th><th>Before</th><th>After selected repairs</th></tr></thead><tbody>{[['Scenario index / 100 · unvalidated',report.before.score,report.after.score],['Unitless vibration RMS',report.before.vibration_rms_proxy,report.after.vibration_rms_proxy],['Speed · km/h',report.before.speed_kmh,report.after.speed_kmh],['Remaining route defects',report.before.remaining_defects,report.after.remaining_defects]].map(([label,a,b])=><tr key={String(label)}><th>{label}</th><td>{number(Number(a),3)}</td><td>{number(Number(b),3)}</td></tr>)}</tbody></table></div>
  <p className="fine-print">Playback is a sampled synthetic sequence, not a live FPS benchmark. Frame detections describe the visible view; route scores use the complete scenario. Camera motion can split IoU tracks. Vibration is a severity/path/speed proxy, not measured acceleration or vehicle physics.</p>
 </div>;
}
