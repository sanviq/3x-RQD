import {NativeWeatherLab} from './NativeWeatherLab';
import {defaultPhotoSettings} from '../api/repairPhotos';
import type {PhotoAssumptions} from '../api/repairPhotos';
import {TwinRegistration} from './TwinRegistration';
import {VehicleParameters} from './VehicleParameters';
import {DrivingSummary} from './DrivingSummary';
import { RepairTools } from './RepairTools';
import { SurfaceProfile } from './SurfaceProfile';
import { twinDefaults } from '../simulation/twin';
import type { TwinSettings } from '../simulation/twin';
import { DefectReview } from './DefectReview';
import { detectedMarks, inspectionPath } from '../simulation/detections';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisController } from '../hooks/useAnalysis';
import type { AnalysisResponse, Page } from '../types/api';
import { Badge, Note, PanelTitle } from './UI';
import { Icon } from './Icon';
import { number, money, percent, downloadJson } from '../utils/formatters';
import { RoadCanvas } from './RoadCanvas';
import { RoadFootprint } from './RoadFootprint';
import { useReplayVideo } from '../hooks/useRoadMedia';
import { fullQuad, rectifyRoad } from '../simulation/projection';
import { RoadAnnotations } from './RoadAnnotations';
import { analyzeRoad } from '../api/roadQuality';
import { affectedFraction, clamp, defaultGrowth, editMark, markArea, effectiveMarks, initialDrive, recommendRepairs, repairCost, wheelDemoMarks } from '../simulation/model';
import type { DefectKind, DriveResult, DriveState, GrowthRates, Mark, RoadConfig, Scenario, Waypoint, Weather } from '../simulation/model';
import { canvasFile, contrastHeatmap, downloadCanvas, sampleTexture, scenarioTexture, textureCanvas, weatherCanvas, weatherFootprint } from '../simulation/image';
import type { CameraMode } from '../simulation/render';

type Props={active:boolean;demo:boolean;selected:string;onNavigate:(p:Page)=>void;analysis:AnalysisController};
type Comparison={original:AnalysisResponse;scenario:AnalysisResponse};
export function ScenarioLab(props:Props) {
  return <SimulationWorkspace key={props.analysis.selected?.url??props.selected} {...props}/>;
}
function SimulationWorkspace({active:visible,onNavigate,analysis}:Props) {
  const source=analysis.selected;
  const [tab,setTab]=useState('Driving comparison');
  const initialPhotoRepairs=useRef(false);
  const [photoAssumptions,setPhotoAssumptions]=useState<PhotoAssumptions>({...defaultPhotoSettings});
  const [reference,setReference]=useState<HTMLCanvasElement|null>(null);
  const quad=source?analysis.roadQuad:fullQuad;
  const texture=useMemo(()=>reference?(source?rectifyRoad(reference,quad):reference):null,[reference,source,quad]);
  const [frameTime,setFrameTime]=useState(analysis.videoSource?.frameTime??0);
  const [referenceRevision,setReferenceRevision]=useState(0);
  const [videoReplay,setVideoReplay]=useState(true);
  const [heatLayer,setHeatLayer]=useState<'Image contrast'|'Defect severity'>('Defect severity');
  const contrastUrl=useMemo(()=>texture?contrastHeatmap(texture).toDataURL():undefined,[texture]);
  const [imageError,setImageError]=useState('');
  const [marks,setMarks]=useState<Mark[]>(()=>source||analysis.validating?[]:wheelDemoMarks({width:6,length:30,speed:25}));
  const [active,setActive]=useState(marks[0]?.id??'');
  const [mode,setMode]=useState<'Defect'|'Path'|'Select'>('Defect');
  const [kind,setKind]=useState<DefectKind>('Pothole');
  const [path,setPath]=useState<Waypoint[]>([{x:.5,y:1},{x:.5,y:0}]);
  const [config,setConfig]=useState<RoadConfig>({width:6,length:30,speed:25});

  const [scenario,setScenario]=useState<Scenario>('Original');
  const [months,setMonths]=useState(6);
  const [growth,setGrowth]=useState<GrowthRates>(defaultGrowth);
  const [twin,setTwin]=useState<TwinSettings>(twinDefaults);
  const [weather,setWeather]=useState<Weather>('None');
  const [intensity,setIntensity]=useState(45);
  const [camera,setCamera]=useState<CameraMode>('Wheel');
  const [rotation,setRotation]=useState(-25);
  const [zoom,setZoom]=useState(1);
  const [mesh,setMesh]=useState(false);
  const [guides,setGuides]=useState(true);
  const [running,setRunning]=useState(false);
  const [playbackRate,setPlaybackRate]=useState(1);
  const [resetId,setResetId]=useState(0);
  const [completed,setCompleted]=useState(false);
  const autoStarted=useRef(false);
  const {video,error:videoError,time:videoTime,duration:videoDuration,seek:seekVideo}=useReplayVideo(analysis.videoSource?.url,visible&&running&&videoReplay&&camera==='Scene'&&scenario==='Original',resetId,frameTime);
  const scene=useMemo(()=>reference?{image:reference,quad,video:videoReplay&&scenario==='Original'?video:null,showAltered:scenario!=='Original'}:undefined,[reference,quad,video,videoReplay,scenario]);
  const [telemetry,setTelemetry]=useState<DriveState>(initialDrive);
  const [runs,setRuns]=useState<Partial<Record<Scenario,DriveResult>>>({});
  const [budget,setBudget]=useState(50000);
  const [rate,setRate]=useState(5000);
  const [comparison,setComparison]=useState<Comparison|null>(null);
  const [frameResult,setFrameResult]=useState<AnalysisResponse|null>(null);
  const [apiBusy,setApiBusy]=useState(false);
  const [apiError,setApiError]=useState('');
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const request=useRef<AbortController|null>(null);
  const requestVersion=useRef(0);
  const counter=useRef(marks.length);
  const mark=marks.find(m=>m.id===active);
  const baseKey=JSON.stringify({quad,referenceFrame:frameTime,referenceRevision,marks:marks.map(m=>({...m,repaired:false})),path,config});
  const repairKey=marks.filter(m=>m.repaired).map(m=>m.id).join(',');
  useEffect(()=>{
    if(tab!=='Repair & deterioration'||!source||initialPhotoRepairs.current||!marks.length||analysis.detectionBusy)return;
    initialPhotoRepairs.current=true;
    if(!marks.some(m=>m.repaired))setMarks(ms=>ms.map(m=>({...m,repaired:m.kind==='Pothole'||m.kind==='Depression'})));
  },[tab,source,marks,analysis.detectionBusy]);
  const current=useMemo(()=>effectiveMarks(marks,scenario,months,growth),[marks,scenario,months,growth]);
  const twinForRender=useMemo(()=>{const m=marks.find(m=>m.id===twin.focus);return {...twin,anchor:m?{x:m.x,y:m.y,width:m.width,length:m.length}:undefined}},[marks,twin]);
  const surface=useMemo(()=>texture?scenarioTexture(texture,marks,scenario,months,growth):null,[texture,marks,scenario,months,growth]);
  const altered=useMemo(()=>surface?weatherCanvas(surface,weather,intensity):null,[surface,weather,intensity]);
  const scenarioUrl=useMemo(()=>surface?.toDataURL(),[surface]);
  const originalUrl=useMemo(()=>texture?.toDataURL(),[texture]);
  const alteredUrl=useMemo(()=>altered?.toDataURL(),[altered]);
  const imageKey=JSON.stringify({baseKey,repairKey,scenario,months,growth,weather,intensity});
  const chosenCost=marks.filter(m=>m.repaired).reduce((sum,m)=>sum+repairCost(m,config,rate),0);

  const comparisonWorker=useRef<Worker|null>(null);
  const [batchBusy,setBatchBusy]=useState(false),[batchProgress,setBatchProgress]=useState(0),[batchError,setBatchError]=useState('');
  useEffect(()=>{
    comparisonWorker.current?.terminate();comparisonWorker.current=null;setBatchBusy(false);setBatchProgress(0);setBatchError('');
    return()=>{comparisonWorker.current?.terminate();comparisonWorker.current=null};
  },[baseKey,repairKey,months,growth]);
  const cancelComparison=()=>{comparisonWorker.current?.terminate();comparisonWorker.current=null;setBatchBusy(false)};
  const compareDrives=()=>{
    resetDrive();cancelComparison();setBatchError('');setBatchProgress(0);setBatchBusy(true);
    try{
      const worker=new Worker(new URL('../simulation/compare.worker.ts',import.meta.url),{type:'module'});comparisonWorker.current=worker;
      worker.onmessage=(event)=>{
        if(comparisonWorker.current!==worker)return;
        if(event.data.type==='progress')setBatchProgress(clamp(event.data.value,0,1));
        else if(event.data.type==='complete'){setRuns(event.data.results);setBatchProgress(1);setBatchBusy(false);worker.terminate();comparisonWorker.current=null}
        else{setBatchError(event.data.message??'Drive comparison failed.');setBatchBusy(false);worker.terminate();comparisonWorker.current=null}
      };
      worker.onerror=()=>{if(comparisonWorker.current===worker){setBatchError('The comparison worker could not finish. Retry with a shorter path.');cancelComparison()}};
      worker.postMessage({marks,config,path,months,growth});
    }catch(error){setBatchError((error as Error).message);setBatchBusy(false)}
  };

  const coverage=useMemo(()=>affectedFraction(current,config),[current,config]);
  useEffect(()=>{
    let cancelled=false;
    if(!source){setReference(analysis.validating?null:sampleTexture());return}
    const image=new Image();image.src=source.url;
    image.decode().then(()=>{if(!cancelled)setReference(textureCanvas(image))}).catch(()=>{if(!cancelled)setImageError('The selected road image could not be loaded.')});
    return()=>{cancelled=true};
  },[source,analysis.validating]);
  useEffect(()=>{setRuns({})},[baseKey]);
  const footprintKey=JSON.stringify(quad);
  useEffect(()=>{if(source){setMarks([]);setActive('');setPath([{x:.5,y:1},{x:.5,y:0}])}},[footprintKey,source]);
  const routedDetection=useRef<typeof analysis.detection>(null);
  useEffect(()=>{
    if(!source)return;
    const automatic=detectedMarks(analysis.detection,analysis.excludedDefects);
    const fresh=analysis.detection!==routedDetection.current;
    setMarks(old=>{const byId=new Map(old.map(m=>[m.id,m]));return [...old.filter(m=>m.provenance!=='detected'),...automatic.map(m=>fresh?m:byId.get(m.id)??m)]});
    if(analysis.detection&&routedDetection.current!==analysis.detection){
      setPath(inspectionPath(automatic,config));routedDetection.current=analysis.detection;
    }
  },[source,analysis.detection,analysis.excludedDefects,config]);


  useEffect(()=>{if(!visible||!['Driving comparison','Digital twin','Repair & deterioration'].includes(tab))setRunning(false)},[visible,tab]);
  useEffect(()=>{setRuns(old=>({Original:old.Original,Repaired:old.Repaired}))},[months,growth]);
  useEffect(()=>{setRuns(old=>({Original:old.Original,Deteriorated:old.Deteriorated}))},[repairKey]);
  useEffect(()=>{
    setRunning(false);setCompleted(false);setTelemetry(initialDrive());setResetId(id=>id+1);
  },[baseKey,repairKey,scenario,months,growth]);
  useEffect(()=>{
    requestVersion.current++;request.current?.abort();request.current=null;
    setApiBusy(false);setComparison(null);setFrameResult(null);setApiError('');
  },[imageKey]);
  useEffect(()=>()=>{requestVersion.current++;request.current?.abort()},[]);
  useEffect(()=>{
    if(!texture||!source||!visible||!analysis.detection||analysis.detectionBusy||autoStarted.current)return;
    const timer=window.setTimeout(()=>{autoStarted.current=true;if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)setRunning(true)},100);
    return()=>window.clearTimeout(timer);
  },[texture,source,visible,analysis.detection,analysis.detectionBusy,baseKey]);
  const onTelemetry=useCallback((state:DriveState)=>setTelemetry(state),[]);
  const onComplete=useCallback((result:DriveResult)=>{setRunning(false);setCompleted(true);setRuns(old=>({...old,[result.scenario]:result}))},[]);
  const updateMark=(id:string,update:Partial<Mark>)=>{setMarks(items=>items.map(m=>m.id===id?editMark(m,update):m));if(update.repaired!==undefined&&tab==='Repair & deterioration')setScenario('Repaired')};
  const addMark=(x:number,y:number)=>{
    const id='M'+(++counter.current);
    setMarks(items=>[...items,{id,kind,x,y,width:kind==='Crack'?.025:.14,length:.06,depthMm:kind==='Pothole'?60:kind==='Uneven surface'?35:15,severity:1,repaired:false,provenance:'manual'}]);
    setActive(id);
  };
  const resetDrive=()=>{setRunning(false);setCompleted(false);setTelemetry(initialDrive());setResetId(id=>id+1)};
  const startDrive=()=>{
    if(completed){setResetId(id=>id+1);setTelemetry(initialDrive());setCompleted(false)}
    setRunning(value=>!value);
  };
  const compareImages=async()=>{
    if(!texture||!altered||request.current)return;
    const controller=new AbortController();request.current=controller;
    const version=++requestVersion.current;setApiBusy(true);setApiError('');setComparison(null);setFrameResult(null);
    try{
      const files=await Promise.all([canvasFile(surface??texture,'simulation-reference.png'),canvasFile(altered,'simulation-scenario.png')]);
      if(controller.signal.aborted)return;
      const [original,result]=await Promise.all(files.map((image,index)=>analyzeRoad({image,captureType:index===1&&weather==='Perspective'?'road_scene':analysis.captureType,roadQuad:index===0?fullQuad:weatherFootprint(weather,intensity),includeOverlay:true},controller.signal)));
      if(version===requestVersion.current&&!controller.signal.aborted)setComparison({original,scenario:result});
    }catch(error){controller.abort();if(version===requestVersion.current)setApiError((error as Error).message)}
    finally{if(version===requestVersion.current){request.current=null;setApiBusy(false)}}
  };
  const analyzeFrame=async()=>{
    if(!canvasRef.current||request.current)return;
    const controller=new AbortController();request.current=controller;const version=++requestVersion.current;
    setApiBusy(true);setApiError('');setComparison(null);setFrameResult(null);
    try{
      const image=await canvasFile(canvasRef.current,'synthetic-car-camera.png');
      if(controller.signal.aborted)return;
      const result=await analyzeRoad({image,captureType:'road_scene',includeOverlay:true},controller.signal);
      if(version===requestVersion.current&&!controller.signal.aborted)setFrameResult(result);
    }catch(error){if(!controller.signal.aborted&&version===requestVersion.current)setApiError((error as Error).message)}
    finally{if(version===requestVersion.current){request.current=null;setApiBusy(false)}}
  };
  const cancelRequest=()=>{requestVersion.current++;request.current?.abort();request.current=null;setApiBusy(false)};
  const exportScenario=()=>downloadJson({
    schema:'road-health-simulation-v2',source:source?{name:source.file.name,width:source.width,height:source.height}:'Synthetic sample',
    provenance:'Photo texture plus user-defined geometry. Depth, dimensions, deterioration, costs and vehicle parameters are assumptions. This is not a reconstructed or validated road.',
    detection:analysis.detection,excludedCandidates:analysis.excludedDefects,config,roadFootprint:quad,referenceFrameSeconds:frameTime,videoName:analysis.videoSource?.file.name,marks,path,scenario,months,growth,photoAssumptions,twinDisplay:twin,weather,intensity,repairRatePerSquareMetre:rate,budget,runs,
    imageAnalysis:comparison,renderedFrameAnalysis:frameResult,
  },'road-simulation');
  const freezeVideo=()=>{
    if(!video?.videoWidth)return;
    const c=document.createElement('canvas'),scale=Math.min(1,1024/Math.max(video.videoWidth,video.videoHeight));
    c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);c.getContext('2d')!.drawImage(video,0,0,c.width,c.height);
    const time=video.currentTime;setRunning(false);setVideoReplay(false);video.pause();setFrameTime(time);setReference(c);setReferenceRevision(v=>v+1);setMarks([]);setPath([{x:.5,y:1},{x:.5,y:0}]);setActive('');setRuns({});setResetId(id=>id+1);
    void canvasFile(c,'video-reference-'+time.toFixed(2)+'.png').then(file=>analysis.select(file,analysis.videoSource?.file,time));
  };
  const annotations=(heatmap=false)=><RoadAnnotations texture={texture} marks={heatmap?current:marks} path={path} selected={active} onSelect={setActive} onAdd={addMark}
    onMove={(id,x,y)=>updateMark(id,{x,y})} onPath={setPath} mode={mode} heatmap={heatmap}/>;
  const apiSummary=(result:AnalysisResponse,label:string)=>{
    const grade=result.assessment.validated?result.assessment.road_quality_index:null;
    return <div className="sim-api-result"><span>{label}</span><strong>{grade===null?'Unable to assess':number(grade,1)+' / 100'}</strong><Badge tone={grade===null?'neutral':result.assessment.band}>{grade===null?'Unvalidated descriptors':result.assessment.band}</Badge><small>{result.assessment.method} · {result.assessment.validated?'API flag: validated':'Unvalidated'}</small><p>{result.assessment.interpretation}</p><p>Brightness {percent(result.features.brightness_mean)} · detail {number(result.features.laplacian_variance)} · {result.defect_detection?.defects.length??'—'} visual candidates</p>{result.warnings.length>0&&<ul>{result.warnings.map((warning,i)=><li key={i}>{warning}</li>)}</ul>}</div>;
  };
  return <div className="page-enter simulation-workspace">
    <div className="page-heading"><div><p className="eyebrow">INTERACTIVE ROAD SIMULATIONS</p><h1>Scenario lab<span className="heading-dot">.</span></h1><p>{source?source.file.name:'Synthetic sample road'} · aligned road area with explicit simulation assumptions.</p></div><div className="action-row"><label className="button secondary file-button"><Icon name="upload" size={16}/>Upload road image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void analysis.select(file)}}/></label><button className="button secondary" onClick={exportScenario}><Icon name="download" size={16}/>Export scenario</button></div></div>
    <Note>{source?'The Wheel and Digital twin views use your rectified road texture and reviewed API contours. Align the outline below and review assumed depth. Scene mode preserves the original capture and optional video replay.':'This is a synthetic sample. Upload a road image to use your own road texture.'} A single photo does not establish road depth, scale, friction, or safe driving speed. Simulation geometry and vehicle response are assumptions; API surface scores are shown separately.</Note>
    {videoError&&<p className="field-error" role="status">{videoError}</p>}
    {(imageError||analysis.errors.image)&&<p className="field-error" role="alert">{imageError||analysis.errors.image}</p>}
    <div className="segmented lab-tabs" role="group" aria-label="Road simulation tools">{['Driving comparison','Digital twin','Repair & deterioration','Severity heatmap','Weather lab','Repair budget'].map(t=><button key={t} className={tab===t?'active':''} aria-pressed={tab===t} onClick={()=>{setTab(t);if(t==='Digital twin'){setCamera('Orbit');setRotation(-62)}}}><Icon name={t==='Driving comparison'?'car':t==='Digital twin'?'cube':t==='Weather lab'?'sun':t==='Repair budget'?'tool':'layers'} size={16}/>{t}</button>)}</div>
    <div className="sim-layout">
      <div className="results-stack">
        <section className="panel sim-viewer"><PanelTitle title={tab} eyebrow={source?'UPLOADED PHOTO · ASSUMED GEOMETRY':'SYNTHETIC EXAMPLE'}><Badge tone="lavender">{scenario} scenario</Badge></PanelTitle>
          {tab==='Repair & deterioration'&&<RepairTools photo={source?{file:source.file,quad,boxGeometry:analysis.detection?.method==='yolo_rdd_detection',assumptions:photoAssumptions,onAssumptions:setPhotoAssumptions}:undefined} texture={texture} marks={marks} config={config} scenario={scenario} months={months} growth={growth} onScenario={setScenario} onMonths={setMonths} onGrowth={setGrowth} onAll={value=>{setMarks(ms=>ms.map(m=>({...m,repaired:value})));setScenario('Repaired')}} busy={batchBusy} progress={batchProgress} error={batchError} onCompare={compareDrives} onCancel={cancelComparison}/>}
          <div hidden={!['Driving comparison','Digital twin','Repair & deterioration'].includes(tab)}>
            <RoadCanvas visible={visible&&['Driving comparison','Digital twin','Repair & deterioration'].includes(tab)} canvasRef={canvasRef} texture={surface} twin={twinForRender} marks={current} config={config} path={path} scenario={scenario} running={running} resetId={resetId} scene={scene} camera={camera} rotation={rotation} zoom={zoom} mesh={mesh} guides={guides} playbackRate={playbackRate}
              onTelemetry={onTelemetry} onComplete={onComplete} onRotate={setRotation} onZoom={setZoom}/>
            <div className="sim-camera-row"><div className="segmented" role="group" aria-label="Simulation camera">{((source?['Wheel','Scene','Orbit','Chase','Driver']:['Wheel','Orbit','Chase','Driver']) as CameraMode[]).map(c=><button key={c} className={camera===c?'active':''} aria-pressed={camera===c} onClick={()=>setCamera(c)}>{c}</button>)}</div>{camera==='Orbit'&&<label className="checkbox-row"><input type="checkbox" checked={mesh} onChange={e=>setMesh(e.target.checked)}/>Surface grid</label>}<label className="checkbox-row"><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>{camera==='Wheel'?'Defect labels':'Path & edges'}</label></div>
            {camera==='Orbit'&&<div className="twin-controls">
              <div className="action-row"><button className="button secondary small" onClick={()=>{setTwin(twinDefaults);setRotation(-62);setZoom(1)}}>Fit whole road</button><button className="button secondary small" disabled={!mark} onClick={()=>{if(mark){setTwin(t=>({...t,focus:mark.id}));setZoom(1)}}}>Inspect selected defect</button></div>
              <label>Orbit<input aria-label="Rotate road model" type="range" min="-180" max="180" value={rotation} onChange={e=>setRotation(Number(e.target.value))}/></label>
              <label>Elevation<input aria-label="Twin camera elevation" type="range" min="18" max="78" value={twin.tilt} onChange={e=>setTwin(t=>({...t,tilt:Number(e.target.value)}))}/></label>
              <label>Zoom<input aria-label="Zoom road model" type="range" min=".6" max="2.2" step=".05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
              <label>Vertical display gain · {twin.relief.toFixed(1)}×<input aria-label="Twin vertical display gain" type="range" min="1" max="8" step=".5" value={twin.relief} onChange={e=>setTwin(t=>({...t,relief:Number(e.target.value)}))}/></label>
              <label>Inspect candidate<select className="sim-select" aria-label="Twin focus defect" value={twin.focus??''} onChange={e=>{setTwin(t=>({...t,focus:e.target.value||undefined}));if(e.target.value)setActive(e.target.value);setZoom(1)}}><option value="">Whole road</option>{marks.map(m=><option key={m.id} value={m.id}>{m.id} · {m.kind}</option>)}</select></label>
              <p className="fine-print">Drag to orbit. This is a photo-grounded surface model with assumed depth, not a surveyed reconstruction. Display gain exaggerates relief visually; it never changes the tire physics.</p>
            </div>}
            {tab==='Digital twin'&&source&&reference&&texture&&<TwinRegistration original={reference} rectified={texture} quad={quad} marks={marks} selected={twin.focus??active} config={config} onSelect={id=>{setActive(id);setTwin(t=>({...t,focus:id}));setZoom(1);setCamera('Orbit')}}/>}
            {(tab==='Digital twin'||tab==='Repair & deterioration')&&<SurfaceProfile marks={current} config={config} path={path} position={telemetry.z}/>}

            <div className="sim-telemetry"><div><span>Route progress</span><strong>{number(clamp((telemetry.z-1.6)/(config.length-3.2),0,1)*100,0)}%</strong></div><div><span>Assumed speed</span><strong>{config.speed}<small> km/h</small></strong></div><div><span>Body acceleration</span><strong>{number(telemetry.acceleration)}<small> m/s²</small></strong></div><div><span>Simulated elapsed time</span><strong>{number(telemetry.time,1)}<small> s</small></strong></div></div>
            <div className="action-row"><button className="button primary" disabled={!texture} onClick={startDrive}><Icon name="car" size={17}/>{running?'Pause drive':completed?'Drive again':telemetry.time>0?'Resume drive':'Start drive'}</button><button className="button secondary" onClick={resetDrive}>Reset drive</button><button className="text-button" disabled={!texture} onClick={()=>{if(canvasRef.current)downloadCanvas(canvasRef.current,'synthetic-road-camera.png')}}>Save camera frame<Icon name="download" size={15}/></button></div>
            <label className="field">Playback rate · physics unchanged<select aria-label="Simulation playback rate" value={playbackRate} onChange={e=>setPlaybackRate(Number(e.target.value))}><option value="1">1× · normal</option><option value="0.5">0.5× · slow motion</option><option value="0.25">0.25× · inspect wheel contact</option></select></label><p className="fine-print">Slow motion changes viewing time only. Assumed vehicle speed, the 240 Hz physics, simulation timestamps and comparison metrics stay the same. Original video replay uses its own playback clock.</p>
            {analysis.videoSource&&<div className="sim-video-controls"><label className="field">Video position · {number(videoTime,1)} / {number(videoDuration,1)} s<input aria-label="Simulation video position" type="range" min="0" max={videoDuration||1} step=".1" value={Math.min(videoTime,videoDuration||1)} onChange={e=>{setRunning(false);seekVideo(Number(e.target.value));setVideoReplay(true)}}/></label><div className="action-row"><button className="button secondary small" disabled={!video} onClick={freezeVideo}>Use current video frame for 3D & annotations</button><button className="text-button" disabled={!video} onClick={()=>{setCamera('Scene');setVideoReplay(true);setRunning(true)}}>Replay video in scene</button></div><p className="fine-print">Scene mode replays the video; other cameras use the reference frame at {number(frameTime,1)} s. Changing the reference clears annotations and recorded drives. Video playback and assumed car speed are independent; this is not motion or defect tracking.</p></div>}
            <p className="fine-print">API contour coordinates drive the rendered relief and rolling tire contact. The initial inspection path deliberately aligns the right wheel with a visible candidate; it is not a safe route recommendation. Edit the path to avoid defects. The 345 mm tire, spring, damper and wheel arch respond to a four-wheel quarter-car model with assumed mass and stiffness. Narrow cracks are bridged by the tire footprint; larger defects produce stronger compression and rebound. Acceleration is simulated, not measured, and is not an engineering comfort grade.</p>
          </div>{tab==='Weather lab'?(source?<NativeWeatherLab capture={source} quad={quad}/>:<>
            <div className="sim-image-pair"><figure><figcaption>Current scenario · reference pixels</figcaption>{texture&&<img src={scenarioUrl} alt="Current scenario road texture before weather stress"/>}</figure><figure><figcaption>{weather==='None'?'Scenario image':weather+' · synthetic effect'}</figcaption>{altered&&<img src={alteredUrl} alt={'Road image with synthetic '+weather+' effect'}/>}</figure></div>
            <div className="weather-options">{(['None','Shadow','Low light','Glare','Blur','Perspective','Rain'] as Weather[]).map(w=><button key={w} className={'button small '+(weather===w?'primary':'secondary')} aria-pressed={weather===w} onClick={()=>setWeather(w)}>{w}</button>)}</div>
            <label className="field">Effect intensity · {intensity}%<input type="range" min="0" max="100" value={intensity} onChange={e=>setIntensity(Number(e.target.value))}/></label>
            <div className="action-row"><button className="button primary" disabled={!altered||apiBusy} onClick={()=>void compareImages()}>{apiBusy?<><span className="spinner"/>Analyzing image pair…</>:'Analyze original & altered images'}</button><button className="button secondary" disabled={!altered} onClick={()=>{if(altered)downloadCanvas(altered,'synthetic-weather-road.png')}}>Download altered image</button></div><p className="fine-print">Effects change actual canvas pixels. Backend comparison sends both rendered images with calibration omitted. No confidence or accuracy is invented; synthetic stress tests do not establish real-weather performance.</p>
          </>):tab==='Severity heatmap'?<>
            <div className="sim-image-pair"><figure><figcaption>Original image</figcaption>{texture&&<img src={originalUrl} alt="Original road image"/>}</figure><figure><figcaption>{heatLayer==='Image contrast'?'Local dark contrast · not defect probability':'API / manual visual severity'}</figcaption>{heatLayer==='Image contrast'?<img src={contrastUrl} alt="Relative dark contrast of the selected road; not inferred defect severity"/>:annotations(true)}</figure></div><div className="segmented" role="group" aria-label="Surface heat layer">{(['Image contrast','Defect severity'] as const).map(layer=><button key={layer} className={heatLayer===layer?'active':''} aria-pressed={heatLayer===layer} onClick={()=>setHeatLayer(layer)}>{layer}</button>)}</div><p className="fine-print">Local dark contrast is calculated from the selected road pixels immediately. It highlights local changes in brightness, which can include shadows, markings, aggregate and damage. It does not classify defects or infer severity, probability, or depth.</p>{heatLayer==='Defect severity'?<><div className="overlay-legend"><span><i className="dot poor"/>High assumed severity</span><span><i className="dot fair"/>Moderate</span><span><i className="dot good"/>Low</span><span>Unmarked areas: unassessed</span></div><Note>Regions use reviewed API visual severity or manual assumptions; they are not calibrated engineering severity. Repaired regions are omitted from the Repaired scenario.</Note></>:<div className="overlay-legend"><span><i className="dot fair"/>Amber/red: stronger local dark contrast</span><span>No defect severity inferred</span></div>}
          </>:tab==='Repair budget'?<>
            <label className="field">Repair budget · {money(budget)}<input type="range" min="0" max="500000" step="1000" value={budget} onChange={e=>setBudget(Number(e.target.value))}/></label>
            <label className="field" htmlFor="repair-rate">Assumed repair rate (₹ / m²)</label><input id="repair-rate" type="number" min="1" max="100000" value={rate} onChange={e=>setRate(clamp(Number(e.target.value)||1,1,100000))}/>
            <div className="sim-budget-summary"><span>Selected repairs<strong>{money(chosenCost)}</strong></span><span>{chosenCost>budget?'Over budget':'Remaining'}<strong>{money(Math.abs(budget-chosenCost))}</strong></span></div>
            {chosenCost>budget&&<p className="field-error" role="alert">Selected repair cost exceeds this scenario’s budget.</p>}
            <button className="button primary" disabled={!marks.length} onClick={()=>{const ids=recommendRepairs(marks,config,rate,budget);setMarks(ms=>ms.map(m=>({...m,repaired:ids.includes(m.id)})));setScenario('Repaired')}}>Recommend affordable repairs<Icon name="tool" size={16}/></button>
            <div className="table-scroll"><table><thead><tr><th>Repair</th><th>Annotation</th><th>Assumed area</th><th>Assumed cost</th></tr></thead><tbody>{marks.map(m=><tr key={m.id}><td><input type="checkbox" aria-label={'Repair '+m.id} checked={m.repaired} onChange={e=>updateMark(m.id,{repaired:e.target.checked})}/></td><td>{m.id} · {m.kind}</td><td>{number(markArea(m,config))} m²</td><td>{money(repairCost(m,config,rate))}</td></tr>)}</tbody></table></div>
            <p className="fine-print">Costs use mapped polygon area (ellipse for manual marks) × rate plus ₹1,000 per defect. Greedy ranking prioritizes severity-weighted assumed displacement volume per rupee. This is a planning scenario, not a quote or validated maintenance recommendation.</p>
          </>:null}
        </section>
        {source&&<DefectReview url={source.url} detection={analysis.detection} busy={analysis.detectionBusy} error={analysis.detectionError} excluded={analysis.excludedDefects} onToggle={analysis.toggleDefect} onRetry={analysis.retryDetection} onSelect={setActive}/>}
        {source&&reference&&<section className="panel"><PanelTitle title="Align the road in your capture"/><RoadFootprint image={reference} quad={quad} onChange={analysis.setRoadQuad}/><p className="fine-print">Changing the outline clears annotations and drive recordings so they cannot remain attached to the wrong pixels. This planar perspective correction does not infer real depth or establish metric scale.</p></section>}
        <section className="panel"><PanelTitle title="Rectified road & driving path"><div className="segmented" role="group" aria-label="Annotation tool">{(['Defect','Path','Select'] as const).map(m=><button key={m} className={mode===m?'active':''} aria-pressed={mode===m} onClick={()=>setMode(m)}>{m==='Defect'?'Mark defect':m==='Path'?'Place waypoint':'Move / select'}</button>)}</div></PanelTitle>
          <p className="input-help">Click the photo to mark a visible defect or place a driving waypoint. Drag markers to move them; focused markers also respond to arrow keys. Enter places a marker at the image center. The yellow line is the vehicle center path, from image bottom to top.</p>
          {annotations()}
          <div className="sim-path-tools"><button className="text-button" onClick={()=>setPath([{x:.5,y:1},{x:.5,y:0}])}>Reset to straight path</button>{path.slice(2).length>0&&<button className="text-button" onClick={()=>setPath(ps=>ps.slice(0,-1))}>Remove last waypoint</button>}<span>{marks.length} annotations · {path.length} waypoints</span></div>
        </section>
        <section className="panel"><PanelTitle title="Before & after driving"/><p className="input-help">Complete an Original drive, choose defects to repair, switch to Repaired, then drive again. Use Compare all three drives in Repair & deterioration for a consistent batch. Changing the path, speed, dimensions or defect geometry clears incompatible recordings.</p>
          <DrivingSummary runs={runs} marks={marks}/>
          <div className="table-scroll"><table className="drive-results"><thead><tr><th>Simulated metric</th><th>Original</th><th>Repaired</th><th>Deteriorated</th></tr></thead><tbody>{([
            ['Vertical acceleration RMS','rms','m/s²'],['Peak body acceleration','peak','m/s²'],['Distance traveled','distance','m'],['Elapsed time','seconds','s'],['Assumed speed','speed','km/h'],['Wheel-contacted annotations','hits',''],
          ] as const).map(([label,key,unit])=><tr key={key}><td>{label}</td>{(['Original','Repaired','Deteriorated'] as Scenario[]).map(s=><td key={s}>{runs[s]?number(runs[s]![key],key==='hits'?0:2)+(unit?' '+unit:''):'No recorded drive'}</td>)}</tr>)}</tbody></table></div>
          {(runs.Original||runs.Repaired||runs.Deteriorated)&&<svg viewBox="0 0 650 180" className="drive-trace" role="img" aria-label="Recorded simulated vertical acceleration against traveled distance"><path d="M35 85H630" stroke="#b8af98" strokeDasharray="4 4"/>{(['Original','Repaired','Deteriorated'] as Scenario[]).map(s=>{
            const trace=runs[s]?.trace;if(!trace?.length)return null;
            const max=Math.max(1,...Object.values(runs).flatMap(r=>r?.trace.map(v=>Math.abs(v.acceleration))??[]));
            return <polyline key={s} points={trace.map(p=>(35+p.distance/Math.max(1,...Object.values(runs).map(r=>r?.distance??0))*585)+','+(85-p.acceleration/max*65)).join(' ')} fill="none" stroke={s==='Original'?'#b0785e':s==='Repaired'?'#829677':'#9c7ca4'} strokeWidth="1.7"/>;
          })}<text x="35" y="170" fontSize="10" fill="#766b55">Distance along simulated path (m)</text><text x="325" y="170" fontSize="10" fill="#a26c54">Original</text><text x="425" y="170" fontSize="10" fill="#677f5c">Repaired</text><text x="520" y="170" fontSize="10" fill="#91729b">Deteriorated</text></svg>}
          <button className="text-button" onClick={()=>setRuns({})}>Clear recorded drives</button>
        </section>
        <section className="panel"><PanelTitle title="Backend analysis of simulation captures"/><Note>These are diagnostic descriptors of generated pixels. No road-health verdict or confidence is available without a validated condition model. Camera frames are submitted as scenes. Original uploaded-image assessments are preserved separately in Surface inspection.</Note>
          <div className="action-row"><button className="button secondary" disabled={apiBusy||!texture||!['Driving comparison','Digital twin','Repair & deterioration'].includes(tab)} onClick={()=>void analyzeFrame()}>Analyze current camera frame</button><button className="text-button" onClick={()=>onNavigate('inspection')}>Open surface inspection<Icon name="arrow" size={15}/></button>{apiBusy&&<button className="text-button" onClick={cancelRequest}>Cancel analysis</button>}</div>
          <div role="status" aria-live="polite" className="input-help">{apiBusy?'Analyzing generated capture…':comparison||frameResult?'Simulation analysis complete.':''}</div>
          {apiError&&<p className="field-error" role="alert">{apiError}</p>}
          {comparison&&<><div className="sim-image-pair">{apiSummary(comparison.original,'Reference image')}{apiSummary(comparison.scenario,'Scenario image')}</div><button className="text-button" onClick={()=>downloadJson({provenance:'Analysis of generated simulation images; uncalibrated',...comparison},'simulation-api-comparison')}>Download exact API results<Icon name="download" size={15}/></button></>}
          {frameResult&&<>{apiSummary(frameResult,'Rendered camera frame')}<button className="text-button" onClick={()=>downloadJson({provenance:'Rendered synthetic camera frame; uncalibrated',result:frameResult},'simulation-frame-analysis')}>Download frame result<Icon name="download" size={15}/></button></>}
        </section>
      </div>
      <aside className="results-stack sim-settings">
        <section className="panel"><PanelTitle title="Road & vehicle assumptions"/><div className="segmented scenario-tabs" role="group" aria-label="Road scenario">{(['Original','Deteriorated','Repaired'] as Scenario[]).map(s=><button key={s} className={scenario===s?'active':''} aria-pressed={scenario===s} onClick={()=>setScenario(s)}>{s}</button>)}</div>
          <label className="field" htmlFor="road-width">Assumed road width (m)</label><input id="road-width" type="number" min="3.5" max="20" step=".5" value={config.width} onChange={e=>setConfig(c=>({...c,width:clamp(Number(e.target.value)||3.5,3.5,20)}))}/>
          <label className="field" htmlFor="road-length">Assumed image length along road (m)</label><input id="road-length" type="number" min="10" max="200" value={config.length} onChange={e=>setConfig(c=>({...c,length:clamp(Number(e.target.value)||10,10,200)}))}/>
          <label className="field">Assumed driving speed · {config.speed} km/h<input aria-label="Assumed driving speed" type="range" min="5" max="80" value={config.speed} onChange={e=>setConfig(c=>({...c,speed:Number(e.target.value)}))}/></label>
          {scenario==='Deteriorated'&&<p className="input-help">Assumed horizon: {months} months · depth +{growth.depth*100}% / month · footprint +{growth.size*100}% / month. <button className="text-button" onClick={()=>setTab('Repair & deterioration')}>Edit deterioration assumptions</button></p>}
          <div className="measurement-grid sim-assumptions"><div className="measurement"><span>Active annotations</span><strong>{current.length}</strong></div><div className="measurement"><span>Assumed affected area</span><strong>{percent(coverage)}</strong></div></div>
          <VehicleParameters config={config} onChange={setConfig}/>
          <p className="fine-print">The selected road footprint is rectified with a planar perspective transform for spatial alignment. Enter known dimensions if available; defaults are assumed. Simulation dimensions do not calibrate the backend or reconstruct depth.</p>
        </section>
        <section className="panel"><PanelTitle title="Defect annotations"><Badge>{marks.length}</Badge></PanelTitle><label className="field" htmlFor="new-defect-kind">New annotation type</label><select id="new-defect-kind" className="sim-select" value={kind} onChange={e=>setKind(e.target.value as DefectKind)}>{(['Pothole','Crack','Depression','Ravelling','Uneven surface'] as DefectKind[]).map(k=><option key={k}>{k}</option>)}</select>
          {!marks.length&&<p className="input-help">No API candidates are available for this footprint. Retry detection or mark a visible defect manually. No demo defects are inserted automatically.</p>}
          <button className="button secondary small sim-demo-button" onClick={()=>{const demo=wheelDemoMarks(config).map(m=>({...m,id:'D'+(++counter.current)}));setMarks(ms=>[...ms,...demo]);setActive(demo[0].id);setCamera('Wheel');setRunning(false)}}>Add labelled demo pothole & bumps</button><p className="fine-print">Demo geometry is placed in the default right-wheel track. It is synthetic and is not detected from the image. Adjust the path to encounter or avoid it.</p>
          <div className="sim-mark-list">{marks.map(m=><button key={m.id} className={active===m.id?'active':''} aria-pressed={active===m.id} onClick={()=>setActive(m.id)}><span>{m.id} · {m.kind}<small>{m.provenance==='detected'?'API candidate · '+Math.round((m.confidence??0)*100)+'% uncalibrated evidence':m.provenance==='manual'?'Manual annotation':'Demo annotation'} · {number(m.depthMm,1)} mm assumed</small></span><Badge tone={m.repaired?'good':'neutral'}>{m.repaired?'Repair selected':'Untreated'}</Badge></button>)}</div>
          {mark&&<div className="sim-mark-editor"><h3>{mark.id} / {mark.kind}</h3>{mark.provenance==='detected'&&<p className="fine-print">API visual severity: {Math.round((mark.visualSeverity??0)*100)} / 100. Editing simulation geometry overrides this candidate without changing the original API result. Depth below is a simulation prior, not measured. <button className="text-button" onClick={()=>{setPath(inspectionPath([mark],config));setCamera('Wheel')}}>Align right wheel with this candidate</button></p>}
            <label className="field">Width across image · {number(mark.width*config.width)} m assumed<input aria-label="Defect width" type="range" min=".01" max=".6" step=".005" value={mark.width} onChange={e=>updateMark(mark.id,{width:Number(e.target.value)})}/></label>
            <label className="field">Length along image · {number(mark.length*config.length)} m assumed<input aria-label="Defect length" type="range" min=".01" max=".4" step=".005" value={mark.length} onChange={e=>updateMark(mark.id,{length:Number(e.target.value)})}/></label>
            <label className="field" htmlFor="assumed-depth">Assumed {mark.kind==='Uneven surface'?'height':'depth'} (mm)</label><input id="assumed-depth" type="number" min="0" max="250" value={mark.depthMm} onChange={e=>updateMark(mark.id,{depthMm:clamp(Number(e.target.value)||0,0,250)})}/>
            <label className="field">Severity multiplier · {mark.severity.toFixed(1)}×<input aria-label="Defect severity multiplier" type="range" min=".5" max="1.8" step=".1" value={mark.severity} onChange={e=>updateMark(mark.id,{severity:Number(e.target.value)})}/></label>
            <label className="checkbox-row"><input type="checkbox" checked={mark.repaired} onChange={e=>updateMark(mark.id,{repaired:e.target.checked})}/><span>Repair this defect<small>Removes its height-field effect only in Repaired. Untreated geometry stays the same.</small></span></label>
            <button className="text-button" onClick={()=>{if(mark.provenance==='detected')analysis.toggleDefect(mark.id);else setMarks(ms=>ms.filter(m=>m.id!==mark.id));setActive('')}}><Icon name="close" size={14}/>Remove annotation</button>
          </div>}
        </section>
      </aside>
    </div>
  </div>;
}
