import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Note } from './UI';
export function MediaCapture({kind,onCapture}:{kind:'video'|'camera';onCapture:(file:File,videoFile?:File,frameTime?:number)=>void}) {
  const video=useRef<HTMLVideoElement>(null);
  const stream=useRef<MediaStream|null>(null);
  const videoUrl=useRef<string|null>(null);
  const videoFile=useRef<File|undefined>(undefined),generation=useRef(0),captured=useRef(false);
  const [source,setSource]=useState('');
  const [error,setError]=useState('');
  const [running,setRunning]=useState(false);
  const [starting,setStarting]=useState(false);
  const requesting=useRef(false);
  const [ready,setReady]=useState(false);
  const [time,setTime]=useState(0);
  const [duration,setDuration]=useState(0);
  const stop=()=>{stream.current?.getTracks().forEach(x=>x.stop());stream.current=null;if(video.current)video.current.srcObject=null;setRunning(false);setReady(false)};
  useEffect(()=>()=>{generation.current++;stream.current?.getTracks().forEach(x=>x.stop());if(videoUrl.current)URL.revokeObjectURL(videoUrl.current)},[]);
  const start=async()=>{
    if(requesting.current||stream.current)return;requesting.current=true;setStarting(true);
    setError('');
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs HTTPS or localhost and a browser that supports getUserMedia.');
      const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(!video.current){media.getTracks().forEach(x=>x.stop());return}
      stream.current=media;video.current.srcObject=media;await video.current.play();setRunning(true);
    }catch(e){stream.current?.getTracks().forEach(x=>x.stop());stream.current=null;setError((e as Error).message)}finally{requesting.current=false;setStarting(false)}
  };
  const capture=()=>{
    const version=generation.current,selectedVideo=videoFile.current;
    const element=video.current;
    if(!element?.videoWidth)return;
    const frameTime=element.currentTime,scale=Math.min(1,2560/Math.max(element.videoWidth,element.videoHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(element.videoWidth*scale);canvas.height=Math.round(element.videoHeight*scale);
    canvas.getContext('2d')?.drawImage(element,0,0,canvas.width,canvas.height);
    canvas.toBlob(blob=>{
      if(blob&&version===generation.current)onCapture(new File([blob],kind+'-frame-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg',{type:'image/jpeg'}),selectedVideo,frameTime);
    },'image/jpeg',.96);
  };
  return <div className="media-capture">
    <Note>A video opens the driving preview automatically from its first frame and remains available for scene replay. Use this frame to choose another reference. Camera captures use the same simulation flow.</Note>
    {kind==='video'&&<label className="button secondary video-picker"><Icon name="video" size={17}/>Choose a video<input type="file" accept="video/*" className="sr-only" onChange={e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(file.size>250*1024*1024){setError('Choose a local video below 250 MiB.');return}
      if(videoUrl.current)URL.revokeObjectURL(videoUrl.current);
      generation.current++;videoFile.current=file;captured.current=false;
      const url=URL.createObjectURL(file);videoUrl.current=url;setSource(url);setReady(false);setError('');
    }}/></label>}
    <video ref={video} preload="auto" src={source||undefined} muted playsInline controls={kind==='video'} className={'capture-video '+(!source&&!running?'hidden-video':'')} onLoadedData={()=>{setReady(true);if(kind==='video'&&!captured.current){captured.current=true;capture()}}} onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)} onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onError={()=>setError('This video could not be played. Try an MP4 or WebM supported by your browser.')}/>
    {kind==='video'&&source&&<label className="field">Frame position · {time.toFixed(1)} s<input aria-label="Video frame position" type="range" min="0" max={duration||1} step=".1" value={time} onChange={e=>{if(video.current)video.current.currentTime=Number(e.target.value)}}/></label>}
    <div className="action-row">{kind==='camera'&&<button className="button secondary" disabled={starting} onClick={running?stop:start}><Icon name="camera" size={16}/>{starting?'Requesting camera…':running?'Stop camera':'Start camera'}</button>}<button className="button primary" disabled={!ready} onClick={capture}>Use this frame<Icon name="arrow" size={16}/></button></div>
    {error&&<p role="alert" className="field-error">{error}</p>}
  </div>;
}
