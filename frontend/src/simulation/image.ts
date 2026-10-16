import type { Mark, Scenario, Weather } from './model';
import { clamp, effectiveMarks } from './model';
import type { GrowthRates } from './model';
import { fullQuad } from './projection';
import type { RoadQuad } from './projection';
type Source = HTMLImageElement | HTMLCanvasElement;
export function textureCanvas(source:Source,maxSide=1024):HTMLCanvasElement {
  const width=source instanceof HTMLImageElement?source.naturalWidth:source.width;
  const height=source instanceof HTMLImageElement?source.naturalHeight:source.height;
  const scale=Math.min(1,maxSide/Math.max(width,height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(64,Math.round(width*scale));canvas.height=Math.max(64,Math.round(height*scale));
  canvas.getContext('2d')!.drawImage(source,0,0,canvas.width,canvas.height);
  return canvas;
}
export function sampleTexture():HTMLCanvasElement {
  const c=document.createElement('canvas');c.width=768;c.height=1536;
  const ctx=c.getContext('2d')!,pixels=ctx.createImageData(c.width,c.height);
  let seed=87123;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296};
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
    const i=(y*c.width+x)*4,grain=(random()-.5)*25;
    const mottling=Math.sin(x*.027+y*.009)*3+Math.sin(y*.045-x*.013)*2;
    const tone=75+grain+mottling;
    pixels.data[i]=tone;pixels.data[i+1]=tone+2;pixels.data[i+2]=tone+4;pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  for(let i=0;i<18000;i++){
    const x=random()*c.width,y=random()*c.height,r=.3+random()*.9;
    ctx.fillStyle=i%3?'#b8b4a124':'#171e2459';ctx.beginPath();ctx.ellipse(x,y,r,r*.65,random()*Math.PI,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#deddd1';ctx.fillRect(19,0,12,c.height);ctx.fillRect(c.width-31,0,12,c.height);
  for(let y=0;y<c.height;y+=300)ctx.fillRect(c.width/2-5,y,10,145);
  return c;
}

export function drawTriangle(ctx:CanvasRenderingContext2D,image:CanvasImageSource,
  src:[number,number][],dst:[number,number][]) {
  const [[x0,y0],[x1,y1],[x2,y2]]=src,[[u0,v0],[u1,v1],[u2,v2]]=dst;
  const denominator=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);
  if(Math.abs(denominator)<1e-9)return;
  const a=(u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))/denominator;
  const b=(v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))/denominator;
  const c=(u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))/denominator;
  const d=(v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))/denominator;
  const e=u0-a*x0-c*y0,f=v0-b*x0-d*y0;
  ctx.save();ctx.beginPath();ctx.moveTo(u0,v0);ctx.lineTo(u1,v1);ctx.lineTo(u2,v2);ctx.closePath();ctx.clip();
  ctx.transform(a,b,c,d,e,f);ctx.drawImage(image,0,0);ctx.restore();
}
export function drawMarkPath(ctx:CanvasRenderingContext2D,mark:Mark,width:number,height:number) {
  ctx.beginPath();
  if(mark.polygon?.length){mark.polygon.forEach((p,i)=>{if(i)ctx.lineTo(p.x*width,p.y*height);else ctx.moveTo(p.x*width,p.y*height)});ctx.closePath()}
  else ctx.ellipse(mark.x*width,mark.y*height,mark.width*width/2,mark.length*height/2,0,0,Math.PI*2);
}
export function scenarioTexture(source:HTMLCanvasElement,marks:Mark[],scenario:Scenario,months=0,growth?:GrowthRates) {
  const result=textureCanvas(source),ctx=result.getContext('2d')!;
  if(scenario==='Repaired')for(const mark of marks.filter(m=>m.repaired)){
    ctx.save();drawMarkPath(ctx,mark,result.width,result.height);ctx.clip();
    ctx.fillStyle='#53575a';ctx.fillRect(0,0,result.width,result.height);
    const x0=(mark.x-mark.width/2)*result.width,y0=(mark.y-mark.length/2)*result.height;
    for(let i=0;i<240;i++){
      const x=x0+((i*127.37)%241)/241*mark.width*result.width,y=y0+((i*91.13)%239)/239*mark.length*result.height;
      ctx.fillStyle=i%3?'#d3d0bd29':'#101c2555';ctx.fillRect(x,y,1.2,.8);
    }
    ctx.restore();
  }
  if(scenario==='Deteriorated'&&months>0)for(const mark of effectiveMarks(marks,scenario,months,growth)){
    ctx.save();drawMarkPath(ctx,mark,result.width,result.height);ctx.clip();
    const x=mark.x*result.width,y=mark.y*result.height,r=Math.max(mark.width*result.width,mark.length*result.height)/2;
    const gradient=ctx.createRadialGradient(x,y,0,x,y,Math.max(1,r));gradient.addColorStop(0,'rgba(22,29,23,'+Math.min(.65,months*.025)+')');gradient.addColorStop(1,'transparent');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,result.width,result.height);ctx.restore();
  }
  return result;
}
export function weatherFootprint(weather:Weather,intensity:number) {
  const t=clamp(intensity/100,0,1);
  return weather==='Perspective'?[{x:t*.2,y:t*.07},{x:1-t*.2,y:t*.07},{x:1,y:1},{x:0,y:1}] as RoadQuad:fullQuad;
}

export function weatherCanvas(source:HTMLCanvasElement,weather:Weather,intensity:number) {
  const output=textureCanvas(source),ctx=output.getContext('2d')!,w=output.width,h=output.height,t=intensity/100;
  if(weather==='None'||!intensity)return output;
  if(weather==='Low light'||weather==='Blur'){
    ctx.clearRect(0,0,w,h);ctx.filter=weather==='Low light'?'brightness('+(1-.85*t)+')':'blur('+(t*7)+'px)';
    ctx.drawImage(source,0,0,w,h);ctx.filter='none';
  }else if(weather==='Shadow'){
    const gradient=ctx.createLinearGradient(0,0,w,h);gradient.addColorStop(0,'rgba(4,12,15,'+(t*.85)+')');gradient.addColorStop(.65,'rgba(4,12,15,'+(t*.65)+')');gradient.addColorStop(1,'transparent');
    ctx.fillStyle=gradient;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(w*.5,0);ctx.lineTo(w,h);ctx.lineTo(w*.2,h);ctx.closePath();ctx.fill();
  }else if(weather==='Glare'){
    const gradient=ctx.createRadialGradient(w*.62,h*.25,0,w*.62,h*.25,w*.65);
    gradient.addColorStop(0,'rgba(255,253,226,'+t+')');gradient.addColorStop(1,'transparent');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  }else if(weather==='Rain'){
    ctx.fillStyle='rgba(30,45,50,'+(t*.28)+')';ctx.fillRect(0,0,w,h);ctx.strokeStyle='rgba(215,231,233,'+(t*.65)+')';ctx.lineWidth=Math.max(1,w/650);
    for(let i=0;i<Math.round(280*t);i++){const x=(i*197+19)%w,y=(i*109+47)%h;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-w*.017,y+h*.035);ctx.stroke()}
  }else if(weather==='Perspective'){
    ctx.fillStyle='#d5d2c4';ctx.fillRect(0,0,w,h);
    const p=weatherFootprint(weather,intensity).map(p=>[p.x*w,p.y*h] as [number,number]);
    drawTriangle(ctx,source,[[0,0],[w,0],[w,h]],[p[0],p[1],p[2]]);
    drawTriangle(ctx,source,[[0,0],[w,h],[0,h]],[p[0],p[2],p[3]]);
  }
  return output;
}
export function canvasFile(canvas:HTMLCanvasElement,name:string):Promise<File> {
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(new File([blob],name,{type:'image/png'})):reject(new Error('Could not capture the simulation frame.')),'image/png'));
}
export function downloadCanvas(canvas:HTMLCanvasElement,name:string) {
  canvas.toBlob(blob=>{
    if(!blob)return;
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png');
}

/** Relative local darkness overlay. This is image contrast, never defect probability or depth. */
export function contrastHeatmap(source:HTMLCanvasElement) {
  const small=textureCanvas(source,384),ctx=small.getContext('2d')!,w=small.width,h=small.height;
  const pixels=ctx.getImageData(0,0,w,h),gray=new Float32Array(w*h),integral=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){
    let sum=0;
    for(let x=0;x<w;x++){
      const i=(y*w+x)*4,luma=pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722;
      gray[y*w+x]=luma;sum+=luma;integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;
    }
  }
  const radius=Math.max(4,Math.round(Math.min(w,h)*.045));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const x0=Math.max(0,x-radius),x1=Math.min(w,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(h,y+radius+1);
    const mean=(integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0])/((x1-x0)*(y1-y0));
    const signal=Math.max(0,Math.min(1,(mean-gray[y*w+x]-8)/Math.max(24,mean*.35))),alpha=signal*.72,i=(y*w+x)*4;
    const color=signal>.65?[206,91,51]:[235,173,75];
    for(let c=0;c<3;c++)pixels.data[i+c]=pixels.data[i+c]*(1-alpha)+color[c]*alpha;
  }
  ctx.putImageData(pixels,0,0);return small;
}
