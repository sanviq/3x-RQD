import type { TwinSettings } from '../simulation/twin';
import { disposeWheel } from '../simulation/wheel';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { driveResult, initialDrive, stepDrive } from '../simulation/model';
import type { DriveResult, DriveState, Mark, RoadConfig, Scenario, Waypoint } from '../simulation/model';
import { renderRoad } from '../simulation/render';
import type { SceneSource } from '../simulation/scene';
import type { CameraMode } from '../simulation/render';
interface Props {
  twin?:TwinSettings;
  scene?:SceneSource;
  visible:boolean;
  canvasRef:RefObject<HTMLCanvasElement|null>;texture:HTMLCanvasElement|null;marks:Mark[];
  config:RoadConfig;path:Waypoint[];scenario:Scenario;running:boolean;resetId:number;
  camera:CameraMode;rotation:number;zoom:number;mesh:boolean;guides:boolean;
  onTelemetry:(state:DriveState)=>void;onComplete:(result:DriveResult)=>void;
  onRotate:(rotation:number)=>void;onZoom:(zoom:number)=>void;
}
export function RoadCanvas(props:Props) {
  const latest=useRef(props),drive=useRef(initialDrive()),trace=useRef<DriveResult['trace']>([]);
  const done=useRef(false),drag=useRef<{x:number;rotation:number}|null>(null);
  useEffect(()=>{latest.current=props});
  useEffect(()=>{const canvas=props.canvasRef.current;return()=>disposeWheel(canvas)},[props.canvasRef]);
  useEffect(()=>{drive.current=initialDrive();trace.current=[];done.current=false},[props.resetId]);
  useEffect(()=>{
    let frame=0,last=0,accumulator=0,lastTelemetry=0,lastSample=0,lastPaint=0;
    let painted:Props|null=null,paintedZ=-1;
    const draw=(time:number)=>{
      const p=latest.current;
      if(!p.visible){last=time;accumulator=0;frame=requestAnimationFrame(draw);return}
      const delta=last?Math.min((time-last)/1000,.08):0;last=time;
      if(p.running&&!done.current){
        accumulator+=delta;
        while(accumulator>=1/240){
          drive.current=stepDrive(drive.current,p.config,p.marks,p.path);accumulator-=1/240;
          if(drive.current.time-lastSample>=.05){trace.current.push({distance:drive.current.distance,acceleration:drive.current.acceleration});lastSample=drive.current.time}
          if(drive.current.z>=p.config.length-1.6){done.current=true;p.onComplete(driveResult(drive.current,p.scenario,p.config,trace.current));break}
        }
      }else accumulator=0;
      if(drive.current.time<lastSample){lastSample=0;lastTelemetry=0}
      if(time-lastTelemetry>90){p.onTelemetry({...drive.current});lastTelemetry=time}
      const changed=!!(p.scene?.video&&!p.scene.video.paused)||painted?.twin!==p.twin||painted?.scene!==p.scene||paintedZ!==drive.current.z||!painted||painted.texture!==p.texture||painted.camera!==p.camera||painted.rotation!==p.rotation||painted.zoom!==p.zoom||painted.mesh!==p.mesh||painted.guides!==p.guides||painted.resetId!==p.resetId;
      if(p.texture&&p.canvasRef.current&&(p.running||changed)&&time-lastPaint>32){renderRoad(p.canvasRef.current,{twin:p.twin,scene:p.scene,texture:p.texture,marks:p.marks,config:p.config,path:p.path,drive:drive.current,camera:p.camera,rotation:p.rotation,zoom:p.zoom,mesh:p.mesh,guides:p.guides});lastPaint=time;painted=p;paintedZ=drive.current.z;}
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[]);
  return <canvas ref={props.canvasRef} width={960} height={600} className="road-renderer" aria-label="Wheel-level road test with tire, suspension and annotated road relief. Road dimensions and defect depth are simulation assumptions."
    onPointerDown={e=>{drag.current={x:e.clientX,rotation:props.rotation};e.currentTarget.setPointerCapture(e.pointerId)}}
    onPointerMove={e=>{if(drag.current&&props.camera==='Orbit')props.onRotate(drag.current.rotation+(e.clientX-drag.current.x)*.35)}}
    onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}/>;
}
