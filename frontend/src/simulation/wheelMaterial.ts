import type { Mark } from './model';
import { textureCanvas } from './image';

const cache=new WeakMap<HTMLCanvasElement,{key:string;canvas:HTMLCanvasElement}>();
const noise=(n:number)=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};

/** Adds only explicitly annotated geometry. No image contrast is treated as a detected defect. */
export function wheelRoadTexture(source:HTMLCanvasElement,marks:Mark[]) {
  const key=JSON.stringify(marks),old=cache.get(source);
  if(old?.key===key)return old.canvas;
  const c=textureCanvas(source,1536),ctx=c.getContext('2d')!;
  for(const m of marks){
    if(m.provenance==='detected')continue; // retain uploaded pixels; only relief is approximated
    const x=m.x*c.width,y=m.y*c.height,rx=m.width*c.width/2,ry=m.length*c.height/2;
    ctx.save();ctx.translate(x,y);ctx.scale(rx,ry);
    if(m.kind==='Crack'){
      ctx.beginPath();for(let i=0;i<=20;i++){const py=-1+i/10,px=(noise(i+47)-.5)*.35;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py)}
      ctx.strokeStyle='#17191b';ctx.lineWidth=.16;ctx.stroke();
      ctx.strokeStyle='#99958b77';ctx.lineWidth=.035;ctx.stroke();
    }else{
      const edge=Array.from({length:44},(_,i)=>{const a=i/44*Math.PI*2,r=.82+noise(i+rx)*.18;return [Math.cos(a)*r,Math.sin(a)*r]});
      ctx.beginPath();edge.forEach(([px,py],i)=>i?ctx.lineTo(px,py):ctx.moveTo(px,py));ctx.closePath();ctx.clip();
      const g=ctx.createRadialGradient(-.16,-.2,0,0,0,1);
      if(m.kind==='Pothole'){g.addColorStop(0,'#26282a');g.addColorStop(.55,'#363a3b');g.addColorStop(.78,'#69665c');g.addColorStop(1,'#aaa493')}
      else if(m.kind==='Uneven surface'){g.addColorStop(0,'#797c7c99');g.addColorStop(1,'#52565755')}
      else{g.addColorStop(0,'#535653bb');g.addColorStop(1,'#88887944')}
      ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);
      for(let i=0;i<(m.kind==='Ravelling'?230:100);i++){
        const px=noise(i*3+11)*2-1,py=noise(i*3+12)*2-1,r=.014+noise(i*3+13)*.036;
        ctx.fillStyle=['#171b1a99','#b0aa9188','#797c7788','#414649aa'][i%4];
        ctx.beginPath();ctx.ellipse(px,py,r*.8,r,noise(i),0,Math.PI*2);ctx.fill();
      }
    }
    ctx.restore();
  }
  cache.set(source,{key,canvas:c});return c;
}
