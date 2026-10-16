
import {useMemo} from 'react';
import type {Mark,RoadConfig} from '../simulation/model';
import type {RoadQuad} from '../simulation/projection';
import {roadProject} from '../simulation/projection';
export function TwinRegistration({original,rectified,quad,marks,selected,config,onSelect}:{original:HTMLCanvasElement;rectified:HTMLCanvasElement;quad:RoadQuad;marks:Mark[];selected:string;config:RoadConfig;onSelect:(id:string)=>void}){
  const originalUrl=useMemo(()=>original.toDataURL(),[original]);
  const rectifiedUrl=useMemo(()=>rectified.toDataURL(),[rectified]);
  const mark=marks.find(m=>m.id===selected);
  const points=(m:Mark)=>m.polygon??Array.from({length:32},(_,i)=>({x:m.x+Math.cos(i*Math.PI/16)*m.width/2,y:m.y+Math.sin(i*Math.PI/16)*m.length/2}));
  return <details className="twin-registration" open><summary>Verify photo → digital twin registration</summary>
    <div className="twin-registration-pair">{[false,true].map(rect=><figure key={String(rect)}><figcaption>{rect?'Rectified road · baseline contours':'Original capture · same contours'}</figcaption><div style={{position:'relative',maxWidth:rect?'150px':'100%',margin:'0 auto'}}><img src={rect?rectifiedUrl:originalUrl} alt={rect?'Rectified road registration reference':'Original uploaded road registration reference'}/><svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%'}} aria-label={rect?'Select rectified twin candidate':'Select original twin candidate'}>{marks.map(m=><polygon key={m.id} points={points(m).map(p=>rect?p:roadProject(quad,p.x,p.y)).map(p=>p.x*1000+','+p.y*1000).join(' ')} fill={m.id===selected?'#ffcf5b44':'transparent'} stroke={m.id===selected?'#ffe39b':'#f2a78d99'} strokeWidth={m.id===selected?4:1.5} vectorEffect="non-scaling-stroke" role="button" tabIndex={0} aria-label={'Inspect '+m.id+(rect?' in rectified road':' in original photo')} aria-pressed={m.id===selected} onClick={()=>onSelect(m.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(m.id)}}}><title>{m.id+' · '+m.kind}</title></polygon>)}</svg></div></figure>)}</div>
    {mark&&<p className="fine-print"><strong>{mark.id} · {mark.kind}</strong> · {mark.provenance==='detected'?'API-derived candidate':'Manual/demo annotation'} · estimated center {(mark.x*100).toFixed(1)}% across, {(mark.y*100).toFixed(1)}% down the rectified road · assumed world offset {((mark.x-.5)*config.width).toFixed(2)} m across, {((1-mark.y)*config.length).toFixed(2)} m forward · assumed relief {mark.depthMm.toFixed(0)} mm. {mark.confidence!==undefined?'Uncalibrated evidence '+Math.round(mark.confidence*100)+'%.':''}</p>}
    <p className="fine-print">Select an outline to focus the same region in 3D. These baseline contours use the current annotation geometry. Distances depend on the entered road dimensions and planar perspective; depth is a simulation prior, not a measurement.</p>
  </details>;
}
