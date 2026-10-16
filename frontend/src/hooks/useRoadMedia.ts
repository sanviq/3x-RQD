import { useCallback, useEffect, useRef, useState } from 'react';
import { textureCanvas } from '../simulation/image';
export function useRoadImage(url?:string) {
  const [image,setImage]=useState<HTMLCanvasElement|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let disposed=false;setImage(null);setError('');
    if(!url)return;
    const element=new Image();element.src=url;
    element.decode().then(()=>{if(!disposed)setImage(textureCanvas(element))}).catch(()=>{if(!disposed)setError('This road image could not be decoded.')});
    return()=>{disposed=true};
  },[url]);
  return {image,error};
}
export function useReplayVideo(url:string|undefined,playing:boolean,resetId:number,startTime=0) {
  const mediaRef=useRef<HTMLVideoElement|null>(null);
  const [video,setVideo]=useState<HTMLVideoElement|null>(null);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0);
  const seek=useCallback((target:number)=>{const element=mediaRef.current;if(element){element.currentTime=Math.max(0,Math.min(target,Number.isFinite(element.duration)?element.duration:target));setTime(element.currentTime)}},[]);
  const [error,setError]=useState('');
  useEffect(()=>{
    setVideo(null);setTime(0);setDuration(0);
    if(!url)return;
    const element=document.createElement('video');mediaRef.current=element;element.muted=true;element.playsInline=true;element.loop=true;element.preload='auto';
    const tick=()=>setTime(element.currentTime),ready=()=>{setVideo(element);setDuration(Number.isFinite(element.duration)?element.duration:0)},fail=()=>setError('Video playback failed. The extracted frame is still available.');
    setError('');element.addEventListener('timeupdate',tick);element.addEventListener('loadeddata',ready);element.addEventListener('error',fail);element.src=url;element.load();
    return()=>{if(mediaRef.current===element)mediaRef.current=null;element.pause();element.removeEventListener('timeupdate',tick);element.removeEventListener('loadeddata',ready);element.removeEventListener('error',fail);element.removeAttribute('src');element.load()};
  },[url]);
  useEffect(()=>{
    if(!video)return;
    let disposed=false;
    if(playing)void video.play().catch(error=>{if(!disposed&&error?.name!=='AbortError')setError('Video autoplay was blocked. Use the play button to retry.')});
    else video.pause();
    return()=>{disposed=true};
  },[video,playing]);
  useEffect(()=>{if(video)seek(startTime)},[video,resetId,startTime,seek]);
  return {video,error,time,duration,seek};
}
