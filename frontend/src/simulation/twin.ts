import { clamp } from './model';
import type { Mark, RoadConfig } from './model';
export interface TwinSettings {tilt:number;relief:number;focus?:string;anchor?:{x:number;y:number;width:number;length:number}}
export type Vec3=[number,number,number];
export const twinDefaults:TwinSettings={tilt:42,relief:1};
export function twinCamera(config:RoadConfig,marks:Mark[],rotation:number,zoom:number,settings:TwinSettings=twinDefaults) {
  const selected=marks.find(m=>m.id===settings.focus)??settings.anchor,relief=clamp(settings.relief,1,8);
  const x=selected?(selected.x-.5)*config.width:0,z=selected?(1-selected.y)*config.length:config.length*.5;
  const base=selected?Math.max(1.6,selected.width*config.width*1.8,selected.length*config.length*1.8):Math.max(config.width*1.4,config.length*.70);
  const radius=base/clamp(zoom,.6,2.2),yaw=rotation*Math.PI/180,pitch=clamp(settings.tilt,18,78)*Math.PI/180;
  const target:Vec3=[x,0,z];
  const eye:Vec3=[x+Math.sin(yaw)*radius*Math.cos(pitch),target[1]+radius*Math.sin(pitch),z-Math.cos(yaw)*radius*Math.cos(pitch)];
  return {eye,target,relief};
}
export function projectTwin(point:Vec3,camera:ReturnType<typeof twinCamera>,width:number,height:number) {
  const unit=(a:number[])=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n)};
  const f=unit(camera.target.map((v,i)=>v-camera.eye[i])),r=unit([f[2],0,-f[0]]);
  const u=[f[1]*r[2]-f[2]*r[1],f[2]*r[0]-f[0]*r[2],f[0]*r[1]-f[1]*r[0]],d=point.map((v,i)=>v-camera.eye[i]);
  const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0),depth=dot(d,f);
  return depth>.01?{x:width/2+dot(d,r)*height/(1.26*depth),y:height/2-dot(d,u)*height/(1.26*depth),depth}:null;
}

export function renderOrigin(camera:string,pose:{x:number;z:number;yaw:number;axleHeight:number;bodyHeight:number}) {
  return camera==='Orbit'?{wheel:[0,0,0,0] as [number,number,number,number],yaw:0}:{wheel:[pose.x,pose.z,pose.axleHeight,pose.bodyHeight] as [number,number,number,number],yaw:pose.yaw};
}
