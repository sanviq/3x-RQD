
import {useEffect,useRef,useState} from 'react';
import type {WeatherDefect} from '../api/weatherComparison';
const color=(d:WeatherDefect)=>d.severity>=.67?'#f37962':d.severity>=.34?'#edba53':'#75c6ab';
const fitZoom=(view:HTMLDivElement|null,w:number,h:number)=>Math.min(1,Math.max(1,(view?.clientWidth||w)-2)/w,(view?.clientHeight||h)/h);
function labelPositions(defects:WeatherDefect[],reference:boolean,width:number,height:number,zoom:number){
 const placed:{x:number;y:number;width:number;height:number}[]=[],result=new Map<string,{x:number;y:number;text:string}>();
 for(const {d,i} of defects.map((d,i)=>({d,i})).sort((a,b)=>b.d.pixel_area-a.d.pixel_area).slice(0,20)){
   const p=(reference?d.reference_polygon:d.frame_polygon)[0],text=(i+1)+' '+d.kind;
   const tw=text.length*6.5+6,th=17,x=Math.max(2,Math.min(width*zoom-tw,p[0]*zoom)),y=Math.max(th,Math.min(height*zoom-2,p[1]*zoom-5));
   const rect={x,y:y-th,width:tw,height:th};
   if(placed.some(a=>rect.x<a.x+a.width+3&&rect.x+tw+3>a.x&&rect.y<a.y+a.height+3&&rect.y+th+3>a.y))continue;
   placed.push(rect);result.set(d.id,{x:x/zoom,y:y/zoom,text});
 }
 return result;
}
export function NativeEvidenceViewer({url,width,height,defects,title,reference=false,showLabels=true,maskUrl}:{url:string;width:number;height:number;defects:WeatherDefect[];title:string;reference?:boolean;showLabels?:boolean;maskUrl?:string}){
 const viewport=useRef<HTMLDivElement>(null);const [zoom,setZoom]=useState(1),[error,setError]=useState('');
 const labels=labelPositions(defects,reference,width,height,zoom);
 const fit=()=>setZoom(fitZoom(viewport.current,width,height));
 useEffect(()=>{setZoom(fitZoom(viewport.current,width,height));setError('')},[url,width,height]);
 return <figure className="native-evidence"><figcaption><strong>{title}</strong><small>{width} × {height} native pixels</small></figcaption>
 <div className="native-zoom"><button className="text-button" onClick={fit}>Fit</button><button className="text-button" onClick={()=>setZoom(1)}>100%</button><button className="text-button" disabled={zoom<=.05} onClick={()=>setZoom(z=>Math.max(.05,z/1.4))} aria-label={'Zoom out '+title}>−</button><span>{Math.round(zoom*100)}%</span><button className="text-button" disabled={zoom>=4} onClick={()=>setZoom(z=>Math.min(4,z*1.4))} aria-label={'Zoom in '+title}>+</button></div>
 <div className="native-evidence-scroll" ref={viewport}><div style={{width:Math.max(1,width*zoom),height:Math.max(1,height*zoom),position:'relative'}}>
 <img src={url} alt={title+' at original resolution'} width={width} height={height} onError={()=>setError('Evidence expired or unavailable. Run the comparison again.')} draggable={false}/>
 {maskUrl&&<img className="native-effect-mask" src={maskUrl} alt="Synthetic condition footprint, not a defect mask" width={width} height={height}/>}
 <svg viewBox={'0 0 '+width+' '+height} className="native-evidence-outlines" aria-label={title+' defect evidence'}>{defects.map(d=><g key={d.id}>
 <polygon pointerEvents="visiblePainted" points={(reference?d.reference_polygon:d.frame_polygon).map(p=>p.join(',')).join(' ')} fill={color(d)} fillOpacity=".1" stroke={color(d)} strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeDasharray={d.uncertain?'5 3':undefined}><title>{d.id+' · '+d.kind+' · '+d.severity_label+' visual severity · '+Math.round(d.confidence*100)+'% uncalibrated confidence · '+d.geometry}</title></polygon>
 {showLabels&&labels.has(d.id)&&<text x={labels.get(d.id)!.x} y={labels.get(d.id)!.y} fontSize={12/zoom} fill="#fff" stroke="#17232a" strokeWidth={2/zoom} paintOrder="stroke">{labels.get(d.id)!.text}</text>}
 </g>)}</svg></div></div>
 {error&&<p className="field-error" role="alert">{error}</p>}<p className="fine-print">Scroll to pan at 100% or higher. Dashed outlines indicate uncertainty; red / amber / teal show high / moderate / low estimated visual severity. Crowded labels are hidden; hover an outline or inspect its table row. Masks and boxes remain distinct geometry types.</p>
 </figure>;
}
