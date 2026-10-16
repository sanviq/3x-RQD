import type { TwinSettings } from './twin';
import { renderWheel } from './wheel';
import { groundHeight, pathX } from './model';
import type { DriveState, Mark, RoadConfig, Waypoint } from './model';
import { drawTriangle } from './image';
import { renderScene } from './scene';
import type { SceneSource } from './scene';
export type CameraMode='Wheel'|'Scene'|'Orbit'|'Chase'|'Driver';
type V=[number,number,number];
type Screen={x:number;y:number;depth:number};
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit=(v:V):V=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n) as V};
export interface RenderOptions {
  twin?:TwinSettings;
  scene?:SceneSource;
  texture:HTMLCanvasElement;marks:Mark[];config:RoadConfig;path:Waypoint[];
  drive:DriveState;camera:CameraMode;rotation:number;zoom:number;mesh:boolean;guides:boolean;
}
export function renderRoad(canvas:HTMLCanvasElement,options:RenderOptions) {
  if(options.camera==='Wheel'||options.camera==='Orbit'){renderWheel(canvas,options);return}
  if(options.camera==='Scene'&&options.scene){renderScene(canvas,options,options.scene);return}
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const {texture,marks,config,path,drive,camera,mesh,guides}=options;
  const w=canvas.width,h=canvas.height,x=pathX(drive.z,path,config);
  const gradient=(pathX(drive.z+.1,path,config)-pathX(drive.z-.1,path,config))/.2;
  const yaw=Math.atan(gradient),forward:V=[Math.sin(yaw),0,Math.cos(yaw)];
  let eye:V,target:V;
  if(camera==='Chase'){
    eye=[x-forward[0]*7,3.5+drive.heave,drive.z-forward[2]*7];
    target=[x+forward[0]*10,.4+drive.heave,drive.z+forward[2]*10];
  }else{
    eye=[x+forward[0]*.5,1.25+drive.heave,drive.z+forward[2]*.5];
    target=[x+forward[0]*14,1.1+drive.heave+Math.tan(drive.pitch)*14,drive.z+forward[2]*14];
  }
  const look=unit(sub(target,eye)),right=unit(cross([0,1,0],look)),up=cross(look,right),focal=h*.95;
  const project=(point:V):Screen|null=>{
    const delta=sub(point,eye),depth=dot(delta,look);
    return depth>.18?{x:w/2+dot(delta,right)*focal/depth,y:h*.49-dot(delta,up)*focal/depth,depth}:null;
  };
  const polygon=(vertices:V[],fill:string,stroke?:string)=>{
    const projected=vertices.map(project);if(projected.some(v=>!v))return;
    ctx.beginPath();projected.forEach((p,i)=>{if(i===0)ctx.moveTo(p!.x,p!.y);else ctx.lineTo(p!.x,p!.y)});ctx.closePath();
    ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke()}
  };
  const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#c9d5d1');sky.addColorStop(.48,'#ece8d7');sky.addColorStop(1,'#bbbca2');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  polygon([[-config.width*2,-.02,-15],[config.width*2,-.02,-15],[config.width*2,-.02,config.length+30],[-config.width*2,-.02,config.length+30]],'#b9bea2');
  const nx=8,nz=36;
  const cells:{world:V[];uv:[number,number][];depth:number}[]=[];
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const coords=[[ix/nx,iz/nz],[(ix+1)/nx,iz/nz],[(ix+1)/nx,(iz+1)/nz],[ix/nx,(iz+1)/nz]];
    const world=coords.map(([u,v])=>{const px=(u-.5)*config.width,pz=v*config.length;return [px,groundHeight(px,pz,marks,config),pz] as V});
    cells.push({world,uv:coords.map(([u,v])=>[u*texture.width,(1-v)*texture.height]),depth:world.reduce((s,v)=>s+dot(sub(v,eye),look),0)/4});
  }
  cells.sort((a,b)=>b.depth-a.depth);
  for(const cell of cells){
    const vertices=cell.world.map(project);if(vertices.some(v=>!v))continue;
    const points=vertices.map(v=>[v!.x,v!.y] as [number,number]);
    drawTriangle(ctx,texture,[cell.uv[0],cell.uv[1],cell.uv[2]],[points[0],points[1],points[2]]);
    drawTriangle(ctx,texture,[cell.uv[0],cell.uv[2],cell.uv[3]],[points[0],points[2],points[3]]);
    const relief=cell.world.reduce((sum,point)=>sum+point[1],0)/4;
    if(Math.abs(relief)>.0005)polygon(cell.world,relief<0?'rgba(21,29,22,'+Math.min(.4,-relief*3)+')':'rgba(239,231,193,'+Math.min(.25,relief*3)+')');
    if(mesh){ctx.beginPath();points.forEach(([px,py],i)=>i?ctx.lineTo(px,py):ctx.moveTo(px,py));ctx.closePath();ctx.strokeStyle='#e6e3c432';ctx.lineWidth=.6;ctx.stroke()}
  }
  const line=(points:V[],color:string,width=1,dash:number[]=[] )=>{
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();let started=false;
    for(const p of points){const s=project(p);if(!s){started=false;continue}if(!started){ctx.moveTo(s.x,s.y);started=true}else ctx.lineTo(s.x,s.y)}
    ctx.stroke();ctx.setLineDash([]);
  };
  if(guides){
    for(const side of [-1,1])line(Array.from({length:65},(_,i)=>[side*config.width/2,.015,i/64*config.length]),'#e8dfbb',2);
    line(Array.from({length:101},(_,i)=>{const z=i/100*config.length,px=pathX(z,path,config);return [px,groundHeight(px,z,marks,config)+.02,z]}),'#e9c481',2,[7,6]);
  }
  if(mesh)for(const m of marks){
    const s=project([(m.x-.5)*config.width,.1,(1-m.y)*config.length]);if(!s)continue;
    ctx.beginPath();ctx.arc(s.x,s.y,4,0,Math.PI*2);ctx.fillStyle=m.severity>=1.3?'#bd6b51':'#d7b466';ctx.fill();
    ctx.fillStyle='#302e25';ctx.font='12px Segoe UI, sans-serif';ctx.fillText(m.id,s.x+7,s.y-5);
  }
  if(camera!=='Driver'){
    const local=(px:number,py:number,pz:number):V=>{
      const rx=px*Math.cos(drive.roll)-py*Math.sin(drive.roll),ry=px*Math.sin(drive.roll)+py*Math.cos(drive.roll);
      const sy=ry*Math.cos(drive.pitch)+pz*Math.sin(drive.pitch),sz=-ry*Math.sin(drive.pitch)+pz*Math.cos(drive.pitch);
      return [x+rx*Math.cos(yaw)+sz*Math.sin(yaw),.38+drive.heave+sy,drive.z-rx*Math.sin(yaw)+sz*Math.cos(yaw)];
    };
    const box=(cx:number,cy:number,cz:number,bw:number,bh:number,bl:number,colors:string[])=>{
      const points=[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]].map(([a,b,c])=>local(cx+a*bw/2,cy+b*bh/2,cz+c*bl/2));
      const faces=[[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[0,3,2,1]]
        .map((indices,i)=>({v:indices.map(n=>points[n]),color:colors[i%colors.length],depth:indices.reduce((s,n)=>s+dot(sub(points[n],eye),look),0)/4})).sort((a,b)=>b.depth-a.depth);
      for(const face of faces)polygon(face.v,face.color,'#2f393622');
    };
    polygon([local(-1.1,-.32,-2.3),local(1.1,-.32,-2.3),local(1.1,-.32,2.3),local(-1.1,-.32,2.3)],'#202b242b');
    for(const side of [-1,1])for(const end of [-1,1])box(side*.87,-.05,end*1.3,.25,.52,.65,['#333b38','#252e2a','#404944']);
    box(0,.18,0,1.78,.49,4.15,['#bcbda9','#a9afa0','#d9d9c1','#c5cab6','#e5e2cc']);
    box(0,.63,-.1,1.45,.55,2.12,['#657b7e','#637b7b','#809398','#6e8587','#dfddc7']);
    box(-.58,.17,2.085,.34,.12,.045,['#f6ecc5']);
    box(.58,.17,2.085,.34,.12,.045,['#f6ecc5']);
  }else{
    ctx.fillStyle='#303936';ctx.beginPath();ctx.moveTo(0,h);ctx.lineTo(0,h*.88);ctx.quadraticCurveTo(w*.5,h*.76,w,h*.88);ctx.lineTo(w,h);ctx.fill();
    ctx.strokeStyle='#202a27';ctx.lineWidth=19;ctx.beginPath();ctx.arc(w*.29,h*1.05,h*.16,Math.PI*1.1,Math.PI*1.9);ctx.stroke();
  }
  ctx.fillStyle='#27382b';ctx.font='12px Segoe UI, sans-serif';ctx.fillText(camera+' camera · photo-textured schematic',16,24);
}
