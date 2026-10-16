import { drawTriangle } from './image';
import { projectTwin, renderOrigin, twinCamera } from './twin';
import fragment from './wheel.frag?raw';
import type { RenderOptions } from './render';
import { clamp, groundHeight, pathX } from './model';
import { wheelPose } from './vehicle';
import { wheelRoadTexture } from './wheelMaterial';

type Graphics={surface:HTMLCanvasElement;gl:WebGL2RenderingContext;program:WebGLProgram;photo:WebGLTexture;height:WebGLTexture;uniforms:Record<string,WebGLUniformLocation|null>;key:string;texture:HTMLCanvasElement|null;bounds:[number,number]};
const renderers=new WeakMap<HTMLCanvasElement,Graphics|null>();
const vertex='#version 300 es\nin vec2 position;\nvoid main(){gl_Position=vec4(position,0.,1.);}';
function createGraphics():Graphics|null {
  const surface=document.createElement('canvas'),gl=surface.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
  if(!gl)return null;
  const compile=(type:number,source:string)=>{
    const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(message??'Wheel shader could not compile')}
    return shader;
  };
  try{
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)??'Wheel program could not link');
    gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
    const uniforms:Graphics['uniforms']={};
    for(const name of ['uResolution','uPhoto','uHeight','uRoadSize','uBounds','uWheel','uYaw','uRotation','uShake','uBody','uMode','uEye','uTarget','uRelief','uGrid','uHeightRange'])uniforms[name]=gl.getUniformLocation(program,name);
    const makeTexture=(unit:number)=>{
      const texture=gl.createTexture()!;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return texture;
    };
    const photo=makeTexture(0),height=makeTexture(1);
    gl.uniform1i(uniforms.uPhoto,0);gl.uniform1i(uniforms.uHeight,1);
    return {surface,gl,program,photo,height,uniforms,key:'',texture:null,bounds:[-.001,.001]};
  }catch(error){console.warn('Wheel camera uses Canvas fallback:',error);gl.getExtension('WEBGL_lose_context')?.loseContext();return null}
}
function uploadRoad(g:Graphics,o:RenderOptions) {
  const {gl}=g,key=JSON.stringify([o.config.width,o.config.length,o.marks]);
  if(g.texture===o.texture&&g.key===key)return;
  if(g.key!==key){
    const w=256,h=1024,values=new Uint8Array(w*h*4),heights=new Float32Array(w*h);let low=0,high=0;
    // Adaptive bounds prevent clipping deep overlapping or deteriorated geometry.
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const height=groundHeight((x/(w-1)-.5)*o.config.width,y/(h-1)*o.config.length,o.marks,o.config);
      low=Math.min(low,height);high=Math.max(high,height);
      heights[y*w+x]=height;
    }
    g.bounds=[low-.002,high+.002];
    for(let i=0;i<heights.length;i++){const n=Math.round(clamp((heights[i]-g.bounds[0])/(g.bounds[1]-g.bounds[0]),0,1)*65535),j=i*4;values[j]=n>>8;values[j+1]=n&255;values[j+3]=255;}
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,g.height);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,values);
  }
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,g.photo);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,wheelRoadTexture(o.texture,o.marks));
  gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  g.texture=o.texture;g.key=key;
}
function hud(canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D,o:RenderOptions,fallback=false) {
  const scale=canvas.width/Math.max(1,canvas.clientWidth||canvas.width);
  ctx.save();ctx.scale(scale,scale);
  const w=canvas.width/scale,h=canvas.height/scale,pose=wheelPose(o.drive,o.marks,o.path,o.config);
  const scrim=ctx.createLinearGradient(0,0,0,100);scrim.addColorStop(0,'#101a22b3');scrim.addColorStop(1,'#101a2200');
  ctx.fillStyle=scrim;ctx.fillRect(0,0,w,100);
  ctx.font='600 13px Segoe UI, sans-serif';ctx.fillStyle='#edf1ee';ctx.fillText('WHEEL CAM  /  SUSPENSION INSPECTION',24,30);
  ctx.font='12px Segoe UI, sans-serif';ctx.fillStyle='#d1d9d6';
  const provenance=o.marks.length?(o.marks.every(m=>m.provenance==='sample')?'DEMO DEFECTS · ASSUMED DIMENSIONS':o.marks.some(m=>m.provenance==='detected')?'API CANDIDATES · ESTIMATED PROFILE · REVIEW REQUIRED':'MANUAL DEFECTS · ASSUMED DEPTH'):'NO DEFECT GEOMETRY · SMOOTH ASSUMED PROFILE';
  ctx.fillText(w<500?(o.marks.length?(o.marks.every(m=>m.provenance==='sample')?'DEMO · ASSUMED GEOMETRY':o.marks.some(m=>m.provenance==='detected')?'API CANDIDATES · ASSUMED DEPTH':'MANUAL · ASSUMED DEPTH'):'SMOOTH ASSUMED PROFILE'):provenance,24,51);
  if(fallback)ctx.fillText('Canvas fallback · GPU rendering unavailable',24,72);
  ctx.fillStyle='#0c1822c9';ctx.fillRect(18,h-63,Math.min(w-36,470),45);
  ctx.font='12px Segoe UI, sans-serif';ctx.fillStyle='#e1e7e4';
  ctx.fillText(o.config.speed+' km/h  ·  Spring travel '+(pose.travel*1000).toFixed(0)+' mm'+(w>=500?'  ·  Tire load '+(pose.compression/pose.staticDeflection).toFixed(2)+'×':''),30,h-36);
  ctx.fillStyle='#aabbb9';ctx.font='11px Segoe UI, sans-serif';ctx.fillText('Simulated vehicle response · not measured telemetry',30,h-20);
  if(!o.guides){ctx.restore();return}
  // Labels project through the same camera as the shader and stay fixed to road coordinates.
  const eye=[.86,.61+o.drive.wheels[1].body+pose.vibration,-.98],target=[-.32,.18+o.drive.wheels[1].body*.45,4.7];
  const unit=(a:number[])=>{const n=Math.hypot(...a);return a.map(v=>v/n)};
  const f=unit(target.map((v,i)=>v-eye[i])),r=unit([f[2],0,-f[0]]),u=[f[1]*r[2]-f[2]*r[1],f[2]*r[0]-f[0]*r[2],f[0]*r[1]-f[1]*r[0]];
  const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
  let count=0;
  for(const m of [...o.marks].sort((a,b)=>b.y-a.y)){
    const dx=(m.x-.5)*o.config.width-pose.x,dz=(1-m.y)*o.config.length-pose.z;
    if(dz<.6||dz>18||count>=1)continue;
    const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw),p=[dx*c-dz*s,.05,dz*c+dx*s],d=p.map((v,i)=>v-eye[i]),z=dot(d,f);
    if(z<=0)continue;
    const x=w/2+dot(d,r)*h/(1.26*z),y=h/2-dot(d,u)*h/(1.26*z);
    if(x<30||x>w-185||y<90||y>h-100)continue;
    count++;ctx.strokeStyle=m.severity>=1.3?'#e4a082':'#e9d6aa';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-22);ctx.lineTo(x+14,y-31);ctx.stroke();
    ctx.fillStyle='#16212bd9';ctx.fillRect(x+12,y-46,170,34);ctx.font='11px Segoe UI, sans-serif';ctx.fillStyle='#ecede7';
    ctx.fillText(m.id+' · '+m.kind,x+20,y-31);ctx.fillStyle='#c6c5b7';ctx.fillText((m.depthMm*m.severity).toFixed(0)+' mm assumed · '+(m.provenance==='sample'?'demo':m.provenance==='detected'?'API candidate':'manual'),x+20,y-17);
  }
  ctx.restore();
}

/** CPU fallback retains close framing and deterministic wheel motion, without a full-car model. */
function fallback(canvas:HTMLCanvasElement,o:RenderOptions) {
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const w=canvas.width,h=canvas.height,p=wheelPose(o.drive,o.marks,o.path,o.config);
  ctx.fillStyle='#a8b7bf';ctx.fillRect(0,0,w,h);
  ctx.drawImage(wheelRoadTexture(o.texture,o.marks),0,0,w,h);
  const shade=ctx.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#13212bd9');shade.addColorStop(1,'#13212b11');
  ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
  const x=w*.28,y=h*.60-p.axleHeight*h*.23,r=h*.25;
  ctx.save();ctx.translate(x,y);ctx.scale(.75,1);
  ctx.fillStyle='#101519';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#3a4143';ctx.lineWidth=r*.055;
  for(const t of [.91,.95]){ctx.beginPath();ctx.arc(0,0,r*t,0,Math.PI*2);ctx.stroke()}
  ctx.fillStyle='#707a80';ctx.beginPath();ctx.arc(0,0,r*.62,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#1f292e';ctx.beginPath();ctx.arc(0,0,r*.53,0,Math.PI*2);ctx.fill();
  for(let i=0;i<10;i++){
    const a=i*Math.PI/5+p.rotation;ctx.strokeStyle='#bdc5c8';ctx.lineWidth=r*.06;ctx.beginPath();
    ctx.moveTo(Math.cos(a)*r*.13,Math.sin(a)*r*.13);ctx.lineTo(Math.cos(a+.08)*r*.58,Math.sin(a+.08)*r*.58);ctx.stroke();
  }
  ctx.fillStyle='#a8b3b9';ctx.beginPath();ctx.arc(0,0,r*.13,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.strokeStyle='#172b34';ctx.lineWidth=h*.035;ctx.beginPath();ctx.arc(x,y+(p.axleHeight-p.bodyHeight+.53)*h*.5,r*1.15,Math.PI,Math.PI*2);ctx.stroke();
  hud(canvas,ctx,o,true);
}
export function renderWheel(canvas:HTMLCanvasElement,o:RenderOptions) {
  let g=renderers.get(canvas);
  if(g===undefined){g=createGraphics();renderers.set(canvas,g)}
  if(!g||g.gl.isContextLost()){canvas.dataset.renderer=o.camera==='Orbit'?'canvas-twin':'canvas-wheel';if(o.camera==='Orbit')twinFallback(canvas,o);else fallback(canvas,o);return}
  const isTwin=o.camera==='Orbit';
  const camera=twinCamera(o.config,o.marks,o.rotation,o.zoom,o.twin);
  const {surface,gl,uniforms:u}=g,pose=wheelPose(o.drive,o.marks,o.path,o.config);
  if(surface.width!==canvas.width||surface.height!==canvas.height){surface.width=canvas.width;surface.height=canvas.height}
  uploadRoad(g,o);gl.viewport(0,0,surface.width,surface.height);gl.useProgram(g.program);
  gl.uniform2f(u.uResolution,surface.width,surface.height);gl.uniform2f(u.uRoadSize,o.config.width,o.config.length);gl.uniform2f(u.uBounds,g.bounds[0]*(isTwin?camera.relief:1),g.bounds[1]*(isTwin?camera.relief:1));
  gl.uniform2f(u.uHeightRange,...g.bounds);
  gl.uniform1f(u.uMode,isTwin?1:0);gl.uniform1f(u.uRelief,isTwin?camera.relief:1);gl.uniform1f(u.uGrid,o.mesh?1:0);gl.uniform3f(u.uEye,...camera.eye);gl.uniform3f(u.uTarget,...camera.target);
  const origin=renderOrigin(o.camera,pose);gl.uniform4f(u.uWheel,...origin.wheel);gl.uniform1f(u.uYaw,origin.yaw);gl.uniform1f(u.uRotation,pose.rotation);
  gl.uniform1f(u.uShake,pose.vibration);gl.uniform1f(u.uBody,o.drive.wheels[1].body);
  gl.drawArrays(gl.TRIANGLES,0,6);
  const ctx=canvas.getContext('2d');if(!ctx)return;ctx.drawImage(surface,0,0,canvas.width,canvas.height);if(isTwin)twinHud(canvas,ctx,o);else hud(canvas,ctx,o);
  canvas.dataset.renderer=isTwin?'webgl-twin':'webgl-wheel';
}

export function disposeWheel(canvas:HTMLCanvasElement|null){
  if(!canvas)return;
  const g=renderers.get(canvas);if(g)g.gl.getExtension('WEBGL_lose_context')?.loseContext();renderers.delete(canvas);
}

function twinHud(canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D,o:RenderOptions,fallback=false) {
  const scale=canvas.width/Math.max(1,canvas.clientWidth||canvas.width),w=canvas.width/scale,h=canvas.height/scale;
  const camera=twinCamera(o.config,o.marks,o.rotation,o.zoom,o.twin);
  ctx.save();ctx.scale(scale,scale);
  const project=(x:number,z:number)=>projectTwin([x,groundHeight(x,z,o.marks,o.config)*camera.relief+.006,z],camera,w,h);
  const line=(points:{x:number;y:number}[],color:string,width=1.2)=>{
    ctx.beginPath();points.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)});
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
  };
  if(o.guides){
    for(const mark of o.marks){
      const points=(mark.polygon??Array.from({length:49},(_,i)=>({x:mark.x+Math.cos(i/48*Math.PI*2)*mark.width/2,y:mark.y+Math.sin(i/48*Math.PI*2)*mark.length/2})))
        .map(p=>project((p.x-.5)*o.config.width,(1-p.y)*o.config.length));
      if(points.every(p=>p!==null)){
        const closed=[...points,points[0]] as {x:number;y:number}[];
        line(closed,mark.id===o.twin?.focus?'#ffe0a0':'#f0b59499',mark.id===o.twin?.focus?2.2:1);
      }
    }
    const track=Array.from({length:180},(_,i)=>{const z=i/179*o.config.length;return project(pathX(z,o.path,o.config),z)}).filter(p=>p!==null);
    line(track,'#e8c982b0',1.3);
    const position=project(pathX(o.drive.z,o.path,o.config),o.drive.z);
    if(position){ctx.fillStyle='#fce9b5';ctx.beginPath();ctx.arc(position.x,position.y,4,0,Math.PI*2);ctx.fill()}
    const selected=o.marks.find(m=>m.id===o.twin?.focus);
    if(selected){
      const p=project((selected.x-.5)*o.config.width,(1-selected.y)*o.config.length);
      if(p){ctx.fillStyle='#14232ce6';ctx.fillRect(clamp(p.x+12,10,w-185),clamp(p.y-47,80,h-110),175,38);ctx.font='11px Segoe UI,sans-serif';ctx.fillStyle='#f6e7c4';ctx.fillText(selected.id+' · '+selected.kind,clamp(p.x+20,18,w-177),clamp(p.y-30,97,h-93))}
    }
  }
  const shade=ctx.createLinearGradient(0,0,0,85);shade.addColorStop(0,'#112029d9');shade.addColorStop(1,'#11202900');
  ctx.fillStyle=shade;ctx.fillRect(0,0,w,85);ctx.fillStyle='#edf1ee';ctx.font='600 13px Segoe UI,sans-serif';ctx.fillText('DIGITAL TWIN / SURFACE INSPECTION',20,27);
  ctx.fillStyle='#c8d5d0';ctx.font='11px Segoe UI,sans-serif';ctx.fillText(fallback?'Canvas fallback · assumed geometry':'Photo texture · GPU lighting · assumed geometry',20,47);
  ctx.fillStyle='#13222bd9';ctx.fillRect(14,h-53,Math.min(w-28,430),39);ctx.fillStyle='#e4e8df';ctx.font='11px Segoe UI,sans-serif';
  ctx.fillText(o.config.width+' × '+o.config.length+' m assumed · '+camera.relief.toFixed(1)+'× vertical display',25,h-35);
  ctx.fillStyle='#b9c7c3';ctx.fillText(w<500?'Estimated geometry · display gain only':'Depth is estimated. Display gain does not change physics.',25,h-21);
  ctx.restore();
}
function twinFallback(canvas:HTMLCanvasElement,o:RenderOptions) {
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const camera=twinCamera(o.config,o.marks,o.rotation,o.zoom,o.twin);
  ctx.fillStyle='#bac5c6';ctx.fillRect(0,0,canvas.width,canvas.height);
  const cells:{p:{x:number;y:number;depth:number}[];uv:[number,number][];depth:number}[]=[];
  for(let y=0;y<72;y++)for(let x=0;x<12;x++){
    const uv=[[x/12,y/72],[(x+1)/12,y/72],[(x+1)/12,(y+1)/72],[x/12,(y+1)/72]];
    const points=uv.map(([u,v])=>{const px=(u-.5)*o.config.width,z=v*o.config.length;return projectTwin([px,groundHeight(px,z,o.marks,o.config)*camera.relief,z],camera,canvas.width,canvas.height)});
    if(points.some(p=>!p))continue;
    const p=points as {x:number;y:number;depth:number}[];
    cells.push({p,uv:uv.map(([u,v])=>[u*o.texture.width,(1-v)*o.texture.height]),depth:p.reduce((s,p)=>s+p.depth,0)/4});
  }
  cells.sort((a,b)=>b.depth-a.depth);
  for(const {p,uv} of cells){const dst=p.map(v=>[v.x,v.y] as [number,number]);drawTriangle(ctx,o.texture,[uv[0],uv[1],uv[2]],[dst[0],dst[1],dst[2]]);drawTriangle(ctx,o.texture,[uv[0],uv[2],uv[3]],[dst[0],dst[2],dst[3]])}
  twinHud(canvas,ctx,o,true);
}
