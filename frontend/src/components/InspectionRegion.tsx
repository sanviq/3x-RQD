import {useEffect,useState} from 'react';
import type {AnalysisController} from '../hooks/useAnalysis';
import {RoadFootprint} from './RoadFootprint';
import {Badge,PanelTitle} from './UI';
export function InspectionRegion({analysis}:{analysis:AnalysisController}){
 const [image,setImage]=useState<HTMLCanvasElement|null>(null);const capture=analysis.selected;
 useEffect(()=>{
  let stopped=false;setImage(null);if(!capture)return;
  const source=new Image();source.src=capture.url;
  source.decode().then(()=>{if(stopped)return;const c=document.createElement('canvas');const scale=Math.min(1,1200/Math.max(source.naturalWidth,source.naturalHeight));c.width=Math.round(source.naturalWidth*scale);c.height=Math.round(source.naturalHeight*scale);c.getContext('2d')?.drawImage(source,0,0,c.width,c.height);setImage(c)}).catch(()=>{});
  return()=>{stopped=true};
 },[capture]);
 if(!capture)return null;
 return <section className="panel inspection-road-region" aria-label="Inspection road region"><PanelTitle title="Road region" eyebrow="AUTOMATIC PROPOSAL · REVIEW THE OUTLINE"><Badge>{analysis.regionBusy?'Finding road…':analysis.roadRegion?.status==='needs_outline'?'Outline needed':analysis.roadRegion?'Review proposed outline':'Selected outline'}</Badge></PanelTitle>
  {analysis.regionBusy?<p role="status">Finding the visible road from the uploaded pixels. Detection and measurements wait for the current outline.</p>:<p className="input-help">{analysis.regionError||analysis.roadRegion?.message||'Your selected outline controls all measurements and defect analysis. The original upload stays unchanged.'}</p>}
  {image&&<RoadFootprint image={image} quad={analysis.roadQuad} onChange={analysis.setRoadQuad}/>}
  <button className="text-button" disabled={analysis.regionBusy} onClick={analysis.retryRoadRegion}>Find road region again</button>
  <p className="fine-print">The editor uses a display copy. Coordinates refer to the original image. Automatic road appearance is an estimate, not a measured road boundary or a depth reconstruction.</p>
 </section>;
}
