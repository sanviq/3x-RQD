import { pathX } from './model';
import { roadProject } from './projection';
import type { RoadQuad } from './projection';
import { drawTriangle } from './image';
import type { RenderOptions } from './render';
export interface SceneSource {image:HTMLCanvasElement;quad:RoadQuad;video?:HTMLVideoElement|null;showAltered?:boolean}
export function renderScene(canvas:HTMLCanvasElement,o:RenderOptions,scene:SceneSource) {
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const {config,drive,path,guides,marks}=o,w=canvas.width,h=canvas.height;
  ctx.fillStyle='#202a25';ctx.fillRect(0,0,w,h);
  const source=scene.video&&scene.video.readyState>=2?scene.video:scene.image;
  const iw=source instanceof HTMLVideoElement?source.videoWidth:source.width;
  const ih=source instanceof HTMLVideoElement?source.videoHeight:source.height;
  const s=Math.min(w/iw,h/ih),dw=iw*s,dh=ih*s,ox=(w-dw)/2,oy=(h-dh)/2;
  ctx.drawImage(source,ox,oy,dw,dh);
  const point=(u:number,v:number):[number,number]=>{const p=roadProject(scene.quad,u,v);return [ox+p.x*dw,oy+p.y*dh]};
  const poly=(coords:[number,number][],fill:string,stroke?:string)=>{
    ctx.beginPath();coords.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
    ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke()}
  };
  if(scene.showAltered){
    for(let y=0;y<20;y++)for(let x=0;x<12;x++){
      const uv:[[number,number],[number,number],[number,number],[number,number]]=[[x/12,y/20],[(x+1)/12,y/20],[(x+1)/12,(y+1)/20],[x/12,(y+1)/20]];
      const src=uv.map(([u,v])=>[u*o.texture.width,v*o.texture.height] as [number,number]),dst=uv.map(([u,v])=>point(u,v));
      drawTriangle(ctx,o.texture,[src[0],src[1],src[2]],[dst[0],dst[1],dst[2]]);
      drawTriangle(ctx,o.texture,[src[0],src[2],src[3]],[dst[0],dst[2],dst[3]]);
    }
  }
  if(guides){
    ctx.strokeStyle='#f1d699bb';ctx.lineWidth=1.5;ctx.setLineDash([7,6]);ctx.beginPath();
    for(let i=0;i<=80;i++){const z=i/80*config.length,p=point(pathX(z,path,config)/config.width+.5,1-z/config.length);if(!i)ctx.moveTo(...p);else ctx.lineTo(...p)}ctx.stroke();ctx.setLineDash([]);
    for(const m of marks){const p=point(m.x,m.y);ctx.fillStyle='#e39b6b';ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.fill()}
  }
  const cx=pathX(drive.z,path,config);
  const yaw=Math.atan((pathX(drive.z+.1,path,config)-pathX(drive.z-.1,path,config))/.2);
  const local=(x:number,z:number,height=0):[number,number]=>{
    const wx=cx+x*Math.cos(yaw)+z*Math.sin(yaw),wz=drive.z-x*Math.sin(yaw)+z*Math.cos(yaw);
    const p=point(wx/config.width+.5,1-wz/config.length);
    // Apparent height scales with the projected road width at this depth.
    const left=point(0,1-wz/config.length),right=point(1,1-wz/config.length);
    return [p[0],p[1]-height*Math.hypot(right[0]-left[0],right[1]-left[1])/config.width];
  };
  poly([local(-1.05,-2.2),local(1.05,-2.2),local(1.05,2.2),local(-1.05,2.2)],'#10211955');
  for(const side of [-1,1])for(const end of [-1,1])poly([local(side*.9-.12,end*1.3-.35),local(side*.9+.12,end*1.3-.35),local(side*.9+.12,end*1.3+.35),local(side*.9-.12,end*1.3+.35)],'#202823');
  poly([local(-.85,-2,.25),local(.85,-2,.25),local(.85,2,.25),local(-.85,2,.25)],'#c9d0bb','#516356');
  poly([local(-.67,-1,.65),local(.67,-1,.65),local(.65,1,.65),local(-.65,1,.65)],'#566f72','#c9d3c0');
  poly([local(-.65,-.7,.85),local(.65,-.7,.85),local(.65,.5,.85),local(-.65,.5,.85)],'#e3dfc5');
  ctx.fillStyle='#172b23d9';ctx.fillRect(12,12,Math.min(w-24,430),29);
  ctx.fillStyle='#f3efd8';ctx.font='12px Segoe UI, sans-serif';ctx.fillText(scene.video?'Uploaded video · schematic car overlay':'Uploaded scene · car projected onto selected road',22,31);
}
