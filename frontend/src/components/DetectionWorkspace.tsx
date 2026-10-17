import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Note, PanelTitle } from './UI';
import { Icon } from './Icon';
import { InclinationTool } from './InclinationTool';
import { RoadMesh } from './RoadMesh';
import { DrivingPlayback } from './DrivingPlayback';
import { DatasetGallery } from './DatasetGallery';
import { number, percent as formatPercent, downloadJson } from '../utils/formatters';
import { analyzeVideo, baselineFor, calculateScenario, detectionForm, detectorStatus, inspectDefects, inspectReviewed, runDriving, saveRoad, startTracking, stopTracking } from '../api/roadHealth';
import type { DetectionResult, DetectionSettings, DetectorStatus, VideoReport } from '../api/roadHealth';
import './backend.css';
import type {AnalysisController} from '../hooks/useAnalysis';

const percent=(value:number|null|undefined)=>value==null?'Not available':formatPercent(value);
type ResultView='original'|'detections'|'segmentation'|'heatmap';
export function DetectionWorkspace({image:uploadedImage,scale,pitch,shared,onSimulate}:{image?:File;scale:string;pitch:string;shared?:AnalysisController;onSimulate?:()=>void}){
  const [sampleImage,setSampleImage]=useState<File|null>(null);
  const image=sampleImage??uploadedImage;
  const [comparison,setComparison]=useState(false);
  useEffect(()=>setSampleImage(null),[uploadedImage]);
  const [settings,setSettings]=useState<DetectionSettings>({mode:'model',confidence:.35,resolution:640});
  const modeChosen=useRef(false);
  const [roll,setRoll]=useState('');
  const [inclination,setInclination]=useState<Record<string,unknown>|null>(null);
  const [status,setStatus]=useState<DetectorStatus|null>(null);
  const [statusError,setStatusError]=useState('');
  const [source,setSource]=useState<'image'|'video'|'camera'>('image');
  const linked=!!shared&&source==='image'&&!sampleImage&&!comparison;
  const [videoFile,setVideoFile]=useState<File|null>(null);
  const [sampleEvery,setSampleEvery]=useState(10);
  const [maxFrames,setMaxFrames]=useState(12);
  const [data,setData]=useState<DetectionResult|null>(null);
  const [resultRevision,setResultRevision]=useState(0);
  const [frames,setFrames]=useState<DetectionResult[]>([]);
  const [videoReport,setVideoReport]=useState<VideoReport|null>(null);
  const [view,setView]=useState<ResultView>('detections');
  const [active,setActive]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [running,setRunning]=useState(false);
  const [snapshot,setSnapshot]=useState<DetectionSettings>(settings);
  const camera=useRef<HTMLVideoElement>(null);
  const media=useRef<MediaStream|null>(null);
  const session=useRef<string|null>(null);
  const interval=useRef<ReturnType<typeof setInterval>|null>(null);
  const inFlight=useRef(false);
  const request=useRef<AbortController|null>(null);
  const mounted=useRef(true);
  const revision=useRef(0);
  const stop=()=>{
    revision.current++;request.current?.abort();request.current=null;
    if(interval.current)clearInterval(interval.current);interval.current=null;
    media.current?.getTracks().forEach(t=>t.stop());media.current=null;
    const key=session.current;session.current=null;if(key)void stopTracking(key).catch(()=>{});
    if(camera.current)camera.current.srcObject=null;
    setRunning(false);setBusy(false);inFlight.current=false;
  };
  const refreshStatus=useCallback(async(signal?:AbortSignal)=>{
    try{const next=await detectorStatus(signal);if(signal?.aborted||!mounted.current)return;setStatus(next);setStatusError('');if(next.model.configured&&!modeChosen.current)setSettings(previous=>({...previous,mode:'model',confidence:next.model.confidence??.35,resolution:next.model.imgsz??640}))}
    catch(e){if(!signal?.aborted&&mounted.current)setStatusError((e as Error).message)}
  },[]);
  useEffect(()=>{const lifecycleRevision=revision;mounted.current=true;const c=new AbortController();void refreshStatus(c.signal);return()=>{mounted.current=false;lifecycleRevision.current++;c.abort();request.current?.abort();if(interval.current)clearInterval(interval.current);media.current?.getTracks().forEach(t=>t.stop());if(session.current)void stopTracking(session.current).catch(()=>{})}},[refreshStatus]);
  useEffect(()=>{if(linked)return;stop();setData(null);setFrames([]);setError('');setBusy(false)},[image,scale,pitch,roll,settings,inclination,linked]);
  const sharedToken=shared?.detection?.score_token;
  const excludedKey=JSON.stringify(shared?.excludedDefects??[]);
  useEffect(()=>{
    if(!linked)return;
    const c=new AbortController();setData(null);setError('');setFrames([]);setVideoReport(null);
    if(!image||!sharedToken||shared?.detectionBusy)return;
    setBusy(true);
    void inspectReviewed(image,sharedToken,JSON.parse(excludedKey),c.signal).then(result=>{
      if(c.signal.aborted)return;setData(result);setResultRevision(n=>n+1);setActive('');
      setNotice('Using the same selected inspection detections. No separate YOLO pass.');
    }).catch(e=>{if(!c.signal.aborted)setError((e as Error).message)}).finally(()=>{if(!c.signal.aborted)setBusy(false)});
    return()=>c.abort();
  },[linked,image,sharedToken,excludedKey,shared?.detectionBusy]);
  const options:DetectionSettings={...settings,scale:sampleImage?'':scale,pitch:sampleImage?'':pitch,roll:sampleImage?'':roll,inclination:sampleImage?undefined:inclination||undefined};
  const cancel=()=>{stop();setNotice('Stopped. Server-side work already started may finish; late responses are ignored.')};
  const accept=(result:DetectionResult,captured:DetectionSettings)=>{setData(result);setResultRevision(n=>n+1);setSnapshot(captured);setActive('');setView('detections')};
  const run=async()=>{
    if(busy)return;const c=new AbortController();request.current=c;const version=++revision.current;setBusy(true);setError('');setNotice('Processing on the local backend…');
    try{
      if(source==='video'){
        if(!videoFile)throw new Error('Choose a video first.');if(videoFile.size>100*1024*1024)throw new Error('Video uploads are limited to 100 MiB.');
        const report=await analyzeVideo(videoFile,options,sampleEvery,maxFrames,c.signal);
        if(!mounted.current||revision.current!==version)return;setVideoReport(report);setFrames(report.frames);accept(report.frames[0],options);setNotice(report.notice);
      }else{
        if(settings.mode==='model'&&!image)throw new Error('Choose an image in Add a road capture above.');
        const result=await inspectDefects(detectionForm(options,image),c.signal);
        if(!mounted.current||revision.current!==version)return;setFrames([]);setVideoReport(null);accept(result,options);setNotice(settings.mode==='model'?'Trained-model inference complete on the selected image. Review detections and image quality.':'Demo annotations generated. These are illustrations, not detections from the selected image.');
      }
    }catch(e){if(!c.signal.aborted&&mounted.current)setError((e as Error).message)}finally{if(mounted.current&&revision.current===version){setBusy(false);request.current=null}}
  };
  const start=async()=>{
    if(running||busy)return;setBusy(true);setError('');const version=++revision.current;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Live camera needs localhost or HTTPS and camera support.');
      if(settings.mode==='model'&&!status?.model.configured)throw new Error('Configure trusted road-specific YOLO weights before starting model inference.');
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:960}},audio:false});
      if(!mounted.current||version!==revision.current){stream.getTracks().forEach(t=>t.stop());return}
      media.current=stream;if(camera.current){camera.current.srcObject=stream;await camera.current.play()}
      const tracked=await startTracking();if(!mounted.current||version!==revision.current){void stopTracking(tracked.session_id);stream.getTracks().forEach(t=>t.stop());return}
      session.current=tracked.session_id;setRunning(true);setFrames([]);setBusy(false);setNotice('Camera active. One frame is submitted approximately every 1.5 seconds; slower inference reduces this rate.');
      interval.current=setInterval(()=>{void capture(options,version)},1500);
    }catch(e){if(version===revision.current&&mounted.current){setError((e as Error).message);stop()}}
  };
  const capture=async(captured:DetectionSettings,version:number)=>{
    if(inFlight.current||!session.current||!camera.current?.videoWidth||version!==revision.current)return;
    inFlight.current=true;const c=new AbortController();request.current=c;
    try{
      const element=camera.current;const canvas=document.createElement('canvas');canvas.width=element.videoWidth;canvas.height=element.videoHeight;canvas.getContext('2d')?.drawImage(element,0,0);
      const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/jpeg',.85));if(!blob)return;
      const body=detectionForm(captured,blob);body.append('session_id',session.current);
      const result=await inspectDefects(body,c.signal);if(!mounted.current||version!==revision.current)return;
      accept(result,captured);setFrames(previous=>[...previous,result].slice(-12));
    }catch(e){if(!c.signal.aborted&&mounted.current){setError((e as Error).message);stop()}}finally{if(version===revision.current)inFlight.current=false}
  };
  const chooseSource=(next:typeof source)=>{stop();setSource(next);setData(null);setFrames([]);setError('')};
  return <section className="backend-workspace results-stack" aria-label="Connected road defect service">
    <DatasetGallery onSelect={setSampleImage}/>
    {sampleImage&&<Note>Real dataset preview selected: {sampleImage.name}. Existing capture calibration and IMU inputs are not applied to this unrelated image. Detection mode still controls whether results are illustrative fixtures or actual model predictions. <button className="text-button" onClick={()=>setSampleImage(null)}>Return to uploaded capture</button></Note>}
    <section className="panel"><PanelTitle title="Road-defect analysis" eyebrow="CONNECTED BACKEND · ADDITIONAL WORKFLOW"><Badge tone={status?.model.configured?'fair':'lavender'}>{linked?'Shared inspection evidence':status?.model.configured?'Trained detector · experimental':'Trained detector unavailable'}</Badge></PanelTitle>
      <p className="fine-print">{linked?'The count, retained defect IDs, outlines and provisional score below come from the current inspection above. Rejected candidates stay excluded in every shared view.':'Separate detector comparison, video tracking and camera workbench. These comparison results do not replace the selected main inspection.'}</p>
      {statusError&&<p role="alert" className="field-error">Could not check the local detector: {statusError} <button className="text-button" onClick={()=>void refreshStatus()}>Retry detector connection</button></p>}
      {linked&&<Note>Analysis uses the same retained candidates and original image as the main inspection. Change exclusions or the road outline above to update every view.</Note>}
      {!linked&&<Note>{settings.mode==='demo'?'Demo annotations are fixed illustrative fixtures, not detections from an uploaded capture. Confidence values are synthetic. Select the trained model to analyze your actual photo.':status?.model.notice??'Local model mode uses configured road-defect weights. Review predictions; severity and road scores are unvalidated estimates.'}</Note>}
      {!linked&&settings.mode==='model'&&status&&!status.model.configured&&<Note tone="warning">No trained detector is available on this server. Configure a trusted checkpoint; automatic surface analysis above remains available. Illustrative demo controls are available only when explicitly enabled.</Note>}
      <div className="segmented source-tabs" role="group" aria-label="Defect analysis source">{(['image','video','camera'] as const).map(s=><button key={s} className={source===s?'active':''} aria-pressed={source===s} onClick={()=>chooseSource(s)}>{s==='image'?'Image':s==='video'?'Video upload':'Live tracked camera'}</button>)}</div>
      {!linked&&<fieldset disabled={busy||running} className="backend-controls">
        <label className="field">Detection mode<select aria-label="Defect detection mode" value={settings.mode} onChange={e=>{modeChosen.current=true;setSettings({...settings,mode:e.target.value as 'demo'|'model'})}}>{import.meta.env.VITE_ENABLE_DEMOS==='true'&&<option value="demo">Demo · illustrative fixture annotations</option>}<option value="model">Trained YOLO · experimental inference</option></select></label>
        <label className="field">Confidence threshold · {percent(settings.confidence)}<input type="range" aria-label="Detection confidence threshold" min=".1" max=".95" step=".05" value={settings.confidence} onChange={e=>setSettings({...settings,confidence:Number(e.target.value)})}/></label>
        <label className="field">Processing resolution<select aria-label="Detection processing resolution" value={settings.resolution} onChange={e=>setSettings({...settings,resolution:Number(e.target.value)})}>{[320,640,768,960,1280].map(v=><option value={v} key={v}>{v} px{v===320?' · edge starting point':''}</option>)}</select></label>
        <label className="field">Measured IMU roll · optional degrees<input type="number" min="-90" max="90" step="any" value={roll} onChange={e=>setRoll(e.target.value)}/></label>
      </fieldset>}
      <p className="fine-print">Uses the original-image scale and measured pitch entered above. Roll is included only with an IMU pitch reading. Inclination is a configurable policy factor, not evidence that an intentionally sloped road is poorly engineered.</p>
      <InclinationTool onUse={setInclination}/>
      {inclination&&<Note>Approximate inclination input selected. Run analysis to apply it; measured IMU fields are currently overridden.</Note>}
      {source==='image'&&<p className="input-help">{image?'Selected capture: '+image.name:'No image selected. Demo can generate a synthetic road; model mode needs an upload above.'}</p>}
      {source==='video'&&<div className="backend-controls"><label className="field">Road video · up to 100 MiB<input type="file" accept="video/*" disabled={busy} onChange={e=>{setVideoFile(e.target.files?.[0]||null);setData(null);setFrames([])}}/></label><label className="field">Sample every N frames<input type="number" min="1" max="300" value={sampleEvery} disabled={busy} onChange={e=>setSampleEvery(Number(e.target.value))}/></label><label className="field">Maximum sampled frames<input type="number" min="1" max="48" value={maxFrames} disabled={busy} onChange={e=>setMaxFrames(Number(e.target.value))}/></label></div>}
      {source==='camera'&&<><video ref={camera} muted playsInline className="capture-video"/><Note>Start camera requests permission and begins periodic uploads to your local backend. Stop releases the camera and tracking session. No camera frames are saved automatically.</Note></>}
      {linked&&<button className="button secondary" onClick={()=>{setComparison(true);setData(null);setNotice('Separate YOLO comparison; the main inspection remains unchanged.')}}>Compare YOLO separately</button>}
      {comparison&&shared&&<button className="button secondary" onClick={()=>{setComparison(false);setData(null)}}>Return to shared inspection</button>}
      {!linked&&<div className="action-row">{source==='camera'?<button className="button primary" disabled={running||busy||(settings.mode==='model'&&!status?.model.configured)} onClick={()=>void start()}>Start tracked camera<Icon name="camera" size={16}/></button>:<button className="button primary" disabled={busy||(!status)||(settings.mode==='model'&&!status.model.configured)} onClick={()=>void run()}>{busy?'Processing locally…':!status?'Checking detector…':settings.mode==='model'?'Run trained detector':'Generate demo annotations'}<Icon name="scan" size={16}/></button>}{(busy||running)&&<button className="button secondary" onClick={cancel}>Stop analysis</button>}</div>}
      {notice&&<p className="input-help" role="status">{notice}</p>}{error&&<p className="field-error" role="alert">{error}</p>}
    </section>
    {data&&<>
      <Note tone={data.repeat_capture?'warning':undefined}>{data.notice}{data.repeat_capture?' Repeat capture recommended: '+(data.quality.flags.join(', ')||'low or unavailable model confidence')+'.':''}</Note>
      <div className="stats-grid">{[['Defects in frame',String(data.assessment.defect_count)],['Unique track estimate',String(videoReport?.unique_tracks??data.unique_tracks)],[data.provenance==='opencv'?'Mean visual evidence':'Mean object confidence',percent(data.assessment.average_confidence)],['Inference / pipeline FPS',number(data.timing.inference_ms)+' ms / '+number(data.timing.pipeline_fps)]].map(([label,value])=><article className="stat-card" key={label}><span className="stat-label">{label}</span><strong className="backend-stat">{value}</strong><span className="stat-foot">{data.provenance==='demo'?'Synthetic annotations · not an AI benchmark':'Host computation only · excludes transport'}</span></article>)}</div>
      {videoReport&&<Note>Sampled {frames.length} frames; source FPS {number(videoReport.source_fps)}; total processing {number(videoReport.processing_s)} s. Tracking uses class-aware IoU with short occlusion retention. Camera motion or sparse sampling can split tracks or miss defects; unique counts are estimates.</Note>}
      <section className="panel"><PanelTitle title="Defect inspection viewer"><Badge tone={data.provenance==='demo'?'lavender':'good'}>{data.provenance==='demo'?'Illustrative fixtures':data.provenance==='opencv'?'Shared OpenCV candidates':'Model predictions · comparison'}</Badge></PanelTitle>
        <div className="segmented preview-tabs" role="group" aria-label="Defect evidence view">{(['original','detections','segmentation','heatmap'] as ResultView[]).map(v=><button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div>
        <div className="backend-image"><img src={data.images[view]} alt={view+' road defect evidence'}/><div className="backend-hitboxes">{data.assessment.defects.map(d=><button key={d.id} className={active===d.id?'active':''} aria-label={'Inspect detected '+d.class_name+' '+d.id} style={{left:d.bbox[0]*100+'%',top:d.bbox[1]*100+'%',width:(d.bbox[2]-d.bbox[0])*100+'%',height:(d.bbox[3]-d.bbox[1])*100+'%'}} onClick={()=>setActive(d.id)}/>)}</div></div>
        <div className="preview-caption"><span>{data.width} × {data.height} original · {data.processed_width} × {data.processed_height} processed</span><span>Score: {data.assessment.score===null?'Withheld · insufficient evidence or unsuitable image':number(data.assessment.score)+' / 100 · '+data.assessment.band}</span></div>
        {frames.length>0&&<div className="backend-frames">{frames.map((f,i)=><button key={i} onClick={()=>accept(f,snapshot)} aria-label={'Inspect sequence frame '+(f.frame_index??i)}><img src={f.images.detections} alt={'Frame '+(f.frame_index??i)}/><small>F{f.frame_index??i}{f.timestamp_s!=null?' · '+number(f.timestamp_s)+' s':''}</small></button>)}</div>}
        <div className="measurement-grid compact-metrics"><div className="measurement"><span>{linked?'Selected-road damaged area':'Image damaged area'}</span><strong>{number(data.assessment.damaged_area_percent)}%</strong></div><div className="measurement"><span>Defect density</span><strong>{number(data.assessment.density_per_megapixel)}</strong><small>{linked?'per selected-road MP':'per original MP'}</small></div><div className="measurement"><span>Inclination</span><strong>{data.assessment.inclination.pitch==null?'Not measured':number(data.assessment.inclination.pitch)+'°'}</strong><small>{data.assessment.inclination.label}</small></div><div className="measurement"><span>Assessment confidence proxy</span><strong>{percent(data.assessment_confidence)}</strong><small>{data.provenance==='opencv'?'Mean uncalibrated visual evidence':'Mean model confidence'}; not road quality</small></div></div>
        <details><summary>Score explanation, quality checks & spatial distribution</summary><p className="fine-print">{data.assessment.explanation}</p><div className="score-explanation">{Object.entries(data.assessment.penalties).map(([k,v])=><div key={k}><span>{k.replaceAll('_',' ')}</span><strong>−{number(v)}</strong></div>)}</div><pre>{JSON.stringify({quality:data.quality,distribution:data.assessment.distribution_grid,limitations:data.assessment.limitations},null,2)}</pre></details>
        <div className="action-row"><button className="button secondary" onClick={()=>downloadJson(data,'road-defect-analysis')}>Export defect result<Icon name="download" size={15}/></button></div>
      </section>
      <section className="panel"><PanelTitle title="Defect register"><Badge>{data.assessment.defect_count}</Badge></PanelTitle><div className="backend-register">{data.assessment.defects.map(d=><button key={d.id} className={'backend-defect '+(active===d.id?'active':'')} onClick={()=>setActive(d.id)}><img src={data.images.previews[d.id]} alt={d.class_name+' crop'}/><span><strong>{d.detection_label??d.class_name.replaceAll('_',' ')}</strong><small>{d.id} · {percent(d.confidence)} confidence</small></span><Badge tone={d.severity>=.7?'poor':d.severity>=.4?'fair':'good'}>{d.severity>=.7?'High':d.severity>=.4?'Moderate':'Low'} severity</Badge></button>)}</div>{data.assessment.defects.filter(d=>d.id===active).map(d=><div className="defect-detail" key={d.id}><h3>{d.detection_label??d.class_name.replaceAll('_',' ')} · {d.id}</h3><dl><div><dt>Normalized image box</dt><dd>{d.bbox.map(v=>number(v,3)).join(', ')}</dd></div><div><dt>Visible image area</dt><dd>{percent(d.area_fraction??null)}</dd></div><div><dt>Estimated calibrated size</dt><dd>{d.width_mm==null?'Requires uniform scale':number(d.width_mm)+' × '+number(d.height_mm)+' mm'}</dd></div><div><dt>Estimated calibrated area</dt><dd>{d.area_m2==null?'Requires uniform scale':number(d.area_m2,4)+' m²'}</dd></div><div><dt>Area source</dt><dd>{d.area_method?.replaceAll('_',' ')}</dd></div><div><dt>Actual depth</dt><dd>{d.depth_mm==null?'Not measured':number(d.depth_mm)+' mm · '+d.depth_source}</dd></div></dl></div>)}</section>
      <section className="panel"><PanelTitle title="Original · segmentation · severity"/><div className="backend-triptych">{(['original','segmentation','heatmap'] as const).map(k=><figure key={k}><img src={data.images[k]} alt={k+' side-by-side view'}/><figcaption>{k}</figcaption></figure>)}</div><div className="overlay-legend"><span><i className="dot poor"/>High severity</span><span><i className="dot fair"/>Moderate</span><span><i className="dot good"/>Low detected damage</span></div><p className="fine-print">Box-only models use rectangular area estimates. Green does not certify a safe or defect-free road. Depth and physical scale require appropriate measurements.</p></section>
      {linked?<><RoadMesh baseline={baselineFor(data)} repaired={[]}/><button className="button primary" onClick={onSimulate}>Simulate this same inspected road</button></>:<BackendActions key={resultRevision} data={data} captured={snapshot} image={image}/>}
    </>}
  </section>;
}

function BackendActions({data,captured,image}:{data:DetectionResult;captured:DetectionSettings;image?:File}){
  const [baseline]=useState(()=>baselineFor(data,captured.scale,captured.pitch,captured.roll,captured.inclination));
  const [repairs,setRepairs]=useState<string[]>([]);
  const [months,setMonths]=useState(0);
  const [edited,setEdited]=useState(data.assessment.defects[0]?.id||'');
  const [severity,setSeverity]=useState(data.assessment.defects[0]?.severity??.6);
  const [size,setSize]=useState(1);
  const [extra,setExtra]=useState(0);
  const [scenario,setScenario]=useState<Awaited<ReturnType<typeof calculateScenario>>|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [effect,setEffect]=useState('shadow');
  const [strength,setStrength]=useState(.5);
  const [stress,setStress]=useState<{original:DetectionResult;altered:DetectionResult}|null>(null);
  const [drive,setDrive]=useState<Awaited<ReturnType<typeof runDriving>>|null>(null);
  const [speed,setSpeed]=useState(35);
  const [lane,setLane]=useState(.3);
  const [pathCurve,setPathCurve]=useState(0);
  const [driveSnapshot,setDriveSnapshot]=useState({repairs:[] as string[]});
  const [weights,setWeights]=useState({...baseline.config});
  const [saved,setSaved]=useState('');
  const operation=useRef<AbortController|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort()}},[]);
  useEffect(()=>{const c=new AbortController();const added=Array.from({length:extra},(_,i)=>({id:'sim-added-'+i,class_name:'pothole',confidence:1,severity:.6,bbox:[.05+(i%5)*.18,.05+Math.floor(i/5)*.18,.15+(i%5)*.18,.15+Math.floor(i/5)*.18],polygon:[],track_id:null,depth_mm:null,depth_source:null}));void calculateScenario({baseline:{...baseline,config:weights},repaired:repairs,months,edits:edited?[{id:edited,severity,size_multiplier:size}]:[],added},c.signal).then(r=>{if(!c.signal.aborted){setScenario(r);setError('')}}).catch(e=>{if(!c.signal.aborted)setError((e as Error).message)});return()=>c.abort()},[repairs,months,edited,severity,size,extra,weights,baseline]); // Baseline is fixed for the lifetime of this result component.
  const work=async(fn:(signal:AbortSignal)=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');const c=new AbortController();operation.current=c;try{await fn(c.signal)}catch(e){if(!c.signal.aborted&&mounted.current)setError((e as Error).message)}finally{if(mounted.current)setBusy(false)}};
  const runStress=()=>work(async signal=>{if(captured.mode==='model'&&!image)throw new Error('Choose an image for model stress testing. Video/camera stress tests require an exported original frame.');const a=await inspectDefects(detectionForm(captured,image),signal);const form=detectionForm(captured,image);form.append('effect',effect);form.append('strength',String(strength));const b=await inspectDefects(form,signal);if(!signal.aborted)setStress({original:a,altered:b})});
  return <>
    <section className="panel"><PanelTitle title="Calculated repair & deterioration scenario" eyebrow="SIMULATION · NOT A VALIDATED FORECAST"/><Note>Select only the defects to repair. Untreated defects retain their original geometry and severity unless explicitly edited or a deterioration scenario is applied.</Note>
      <div className="backend-controls"><label className="field">Illustrative months · {months}<input type="range" min="0" max="24" value={months} onChange={e=>setMonths(Number(e.target.value))}/></label><label className="field">Additional synthetic potholes<input type="number" min="0" max="20" value={extra} onChange={e=>setExtra(Math.min(20,Math.max(0,Math.round(Number(e.target.value)))))}/></label><label className="field">Defect to edit<select value={edited} onChange={e=>{setEdited(e.target.value);setSeverity(data.assessment.defects.find(d=>d.id===e.target.value)?.severity??.6);setSize(1)}}><option value="">No defect edits</option>{data.assessment.defects.map(d=><option key={d.id} value={d.id}>{d.id} · {d.class_name}</option>)}</select></label><label className="field">Selected severity · {number(severity)}<input type="range" min="0" max="1" step=".05" disabled={!edited} value={severity} onChange={e=>setSeverity(Number(e.target.value))}/></label><label className="field">Selected linear size multiplier · {size}×<input type="range" min=".25" max="2" step=".05" disabled={!edited} value={size} onChange={e=>setSize(Number(e.target.value))}/></label></div>
      <div className="backend-repairs">{data.assessment.defects.map(d=><label className="checkbox-row" key={d.id}><input type="checkbox" checked={repairs.includes(d.id)} onChange={()=>setRepairs(previous=>previous.includes(d.id)?previous.filter(id=>id!==d.id):[...previous,d.id])}/><span>Repair {d.detection_label??d.class_name.replaceAll('_',' ')}<small>{d.id}</small></span></label>)}</div>
      {scenario&&<><div className="driving-comparison"><div><span>Current → scenario score</span><strong>{number(scenario.before.score)} → {number(scenario.after.score)}</strong></div><div><span>Remaining visible defects</span><strong>{scenario.after.defect_count}</strong></div><div><span>Scenario image damage</span><strong>{number(scenario.after.damaged_area_percent)}%</strong></div></div><p className="fine-print">{scenario.assumptions}</p><button className="text-button" onClick={()=>downloadJson(scenario,'road-repair-scenario')}>Export calculated scenario<Icon name="download" size={15}/></button></>}
      <details><summary>Scoring weights, penalty allocation & band thresholds</summary><div className="backend-controls">{Object.entries(weights).map(([key,value])=><label className="field" key={key}>{key.replaceAll('_',' ')}<input type="number" min="0" max="100" step="any" value={value} onChange={e=>setWeights({...weights,[key]:Number(e.target.value)})}/></label>)}</div><p className="fine-print">Defaults: 35% potholes/major cracks, 30% granular deterioration, 25% roughness/loose chips, 10% other visible defects. Group weights and penalty allocations are normalized. Bad &lt; Moderate threshold &lt; Good threshold. This backend policy is separate from the existing network demo's example formula.</p></details>
    </section>
    <RoadMesh baseline={baseline} repaired={repairs}/>
    <section className="panel"><PanelTitle title="Before & after driving simulation" eyebrow="3D ROAD · SYNTHETIC CAR-MOUNTED CAMERA"/>
      <Note>1. Inspect the damaged road and prioritize defects. 2. Select repairs above. 3. Drive both versions along the same path. Every perspective camera frame is submitted to the road-analysis pipeline. Rendered geometry and ride response are assumptions.</Note>
      <div className="backend-controls"><label className="field">Same-route speed · {speed} km/h<input type="range" min="10" max="60" value={speed} disabled={busy} onChange={e=>setSpeed(Number(e.target.value))}/></label><label className="field">Lateral starting position · {number(lane,2)}<input type="range" min="0" max="1" step=".05" value={lane} disabled={busy} onChange={e=>setLane(Number(e.target.value))}/></label><label className="field">Driving path curve · {number(pathCurve,2)}<input type="range" min="-.35" max=".35" step=".05" value={pathCurve} disabled={busy} onChange={e=>setPathCurve(Number(e.target.value))}/></label></div>
      <button className="button secondary" disabled={busy} onClick={()=>void work(async signal=>{const chosen=[...repairs];const r=await runDriving({baseline:{...baseline,config:weights},repaired:chosen,speed_kmh:speed,lateral_position:lane,path_curve:pathCurve,frames:16,mode:captured.mode},signal);if(!signal.aborted){setDriveSnapshot({repairs:chosen});setDrive(r)}})}>Drive before → repair selected → drive again<Icon name="car" size={16}/></button>
      {drive&&<><DrivingPlayback key={JSON.stringify([drive.path,drive.path_curve,drive.before.score,drive.after.score,driveSnapshot.repairs])} report={drive} defects={baseline.defects} repaired={driveSnapshot.repairs}/><p className="fine-print">Results use the repair selection and path captured when this experiment ran. Run again after changing inputs.</p><button className="text-button" onClick={()=>downloadJson(drive,'synthetic-driving-pipeline')}>Export frame sequences & comparison<Icon name="download" size={15}/></button></>}
    </section>
    <section className="panel"><PanelTitle title="Lighting & weather inference test" eyebrow="SYNTHETIC STRESS TEST"/><div className="backend-controls"><label className="field">Synthetic alteration<select value={effect} onChange={e=>setEffect(e.target.value)}>{['shadow','low_light','glare','brightness','blur','perspective','rain'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><label className="field">Strength · {percent(strength)}<input type="range" min="0" max="1" step=".05" value={strength} onChange={e=>setStrength(Number(e.target.value))}/></label></div><button className="button secondary" disabled={busy} onClick={()=>void runStress()}>Compare original & altered inference<Icon name="sun" size={16}/></button>{stress&&<><div className="backend-triptych">{[stress.original,stress.altered].map((r,i)=><figure key={i}><img src={r.images.detections} alt={i?'Synthetically altered result':'Unaltered result'}/><figcaption>{i?'Synthetic '+effect:'Original'} · {r.assessment.defect_count} detections · {percent(r.assessment.average_confidence)} confidence · score {number(r.assessment.score)}</figcaption></figure>)}</div><Note>{captured.mode==='demo'?'Demo count and confidence stay fixed. A score can be withheld when image-quality checks fail. This is not model robustness evidence.':'This single synthetic comparison does not establish real-weather performance. Repeat capture if image-quality or confidence checks fail.'}</Note></>}</section>
    <section className="panel"><PanelTitle title="Save this inspection to a GPS-linked local survey" eyebrow="EXPLICIT LOCAL SAVE"/><Note>Saving persists annotations, sensor inputs, scoring policy and processed evidence previews on this computer. Unassessable evidence can be saved for repeat-capture follow-up; saving does not turn it into a health grade. Original-resolution captures are not archived. You can inspect saved records in Road network → Live workspace.</Note><form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void work(async()=>{await saveRoad({id:'CAP-'+Date.now(),name:String(form.get('name')),latitude:Number(form.get('lat')),longitude:Number(form.get('lon')),distance_start_m:Number(form.get('distance')),length_m:Number(form.get('length')),width_m:7,assessment:baseline,provenance:data.provenance==='opencv'?'manual':data.provenance,evidence:{original:data.images.original,detections:data.images.detections,segmentation:data.images.segmentation,heatmap:data.images.heatmap},capture_notes:data.notice});if(mounted.current)setSaved('Inspection saved locally. Switch to Live workspace and open Road network to review it.')})}}><div className="backend-controls"><label className="field">Segment name<input name="name" required maxLength={120}/></label><label className="field">Latitude<input name="lat" type="number" min="-90" max="90" step="any" required/></label><label className="field">Longitude<input name="lon" type="number" min="-180" max="180" step="any" required/></label><label className="field">Start distance · m<input name="distance" type="number" min="0" max="10000000" defaultValue="0" required/></label><label className="field">Segment length · m<input name="length" type="number" min="1" max="1000000" defaultValue="100" required/></label></div><button className="button secondary" disabled={busy} type="submit">Save GPS-linked inspection locally<Icon name="check" size={16}/></button></form>{saved&&<p role="status" className="input-help">{saved}</p>}</section>
    {busy&&<div className="workspace-note" role="status"><span>Processing backend experiment…</span><button className="text-button" onClick={()=>{operation.current?.abort();setBusy(false)}}>Cancel request</button></div>}{error&&<p className="field-error" role="alert">{error}</p>}
  </>;
}
