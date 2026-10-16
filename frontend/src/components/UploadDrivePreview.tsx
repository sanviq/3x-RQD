import {RoadFootprint} from './RoadFootprint';
import { detectedMarks, inspectionPath } from '../simulation/detections';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisController } from '../hooks/useAnalysis';
import { useReplayVideo, useRoadImage } from '../hooks/useRoadMedia';
import { RoadCanvas } from './RoadCanvas';
import { rectifyRoad } from '../simulation/projection';
import type { RoadConfig } from '../simulation/model';
import { PanelTitle } from './UI';
export function UploadDrivePreview({analysis,onOpen}:{analysis:AnalysisController;onOpen:()=>void}) {
  return <Preview key={analysis.selected?.url} analysis={analysis} onOpen={onOpen}/>;
}
function Preview({analysis,onOpen}:{analysis:AnalysisController;onOpen:()=>void}) {
  const {image,error}=useRoadImage(analysis.selected?.url);
  const texture=useMemo(()=>image?rectifyRoad(image,analysis.roadQuad):null,[image,analysis.roadQuad]);
  const [running,setRunning]=useState(false);
  const [camera,setCamera]=useState<'Wheel'|'Scene'>('Wheel');
  const [reset,setReset]=useState(0),canvas=useRef<HTMLCanvasElement>(null);
  const {video,error:videoError}=useReplayVideo(analysis.videoSource?.url,running&&camera==='Scene',reset,analysis.videoSource?.frameTime??0);
  const config=useMemo<RoadConfig>(()=>({width:6,length:30,speed:15}),[]);
  const marks=useMemo(()=>detectedMarks(analysis.detection,analysis.excludedDefects),[analysis.detection,analysis.excludedDefects]);
  const path=useMemo(()=>inspectionPath(marks,config),[marks,config]);
  useEffect(()=>{setReset(n=>n+1);setRunning(!!analysis.detection&&!analysis.detectionBusy&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)},[analysis.detection,analysis.detectionBusy,analysis.excludedDefects]);
  const onComplete=useCallback(()=>setRunning(false),[]),noop=useCallback(()=>{},[]);
  return <section className="panel upload-drive-preview"><PanelTitle title="Your road · wheel test"/>
    {image&&<details><summary>Adjust the road analysis region</summary><RoadFootprint image={image} quad={analysis.roadQuad} onChange={analysis.setRoadQuad}/><p className="fine-print">Changing this outline automatically reruns both defect detection and texture/chip analysis.</p></details>}
    <div className="segmented" role="group" aria-label="Upload preview camera">{(['Wheel','Scene'] as const).map(c=><button key={c} aria-pressed={camera===c} className={camera===c?'active':''} onClick={()=>setCamera(c)}>{c==='Wheel'?'Wheel test':'Original scene'}</button>)}</div>
    {image&&texture?<RoadCanvas visible canvasRef={canvas} texture={texture} marks={marks} config={config} path={path} scenario="Original" running={running} resetId={reset} camera={camera} rotation={0} zoom={1} mesh={false} guides
    scene={{image,quad:analysis.roadQuad,video}} onTelemetry={noop} onComplete={onComplete} onRotate={noop} onZoom={noop}/>:<p className="input-help">{error||'Preparing your road preview…'}</p>}
    <div className="action-row"><button className="button secondary small" disabled={!texture||analysis.detectionBusy} onClick={()=>{setReset(x=>x+1);setRunning(true)}}>Replay drive</button><button className="text-button" onClick={()=>setRunning(false)}>Pause</button><button className="button primary small" onClick={onOpen}>Align road & open scenario lab</button></div>
    <p className="fine-print">Your image supplies the road texture. The 6 m × 30 m scale and 15 km/h speed are assumptions. API candidate contours provide the road relief. Depth uses a visual-severity prior; no metric depth is inferred. The inspection path intentionally crosses one candidate. Review detections or edit the path in the lab.{analysis.videoSource?' Original scene replays your clip; the wheel test uses the selected reference frame.':''}</p>
    {videoError&&<p className="field-error" role="status">{videoError}</p>}
  </section>;
}
