import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoad } from '../src/simulation/render';
import { scenarioTexture, weatherCanvas } from '../src/simulation/image';
import { defaultPath, initialDrive } from '../src/simulation/model';
import type { Mark } from '../src/simulation/model';
function context(){
  return {save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),
    clip:vi.fn(),transform:vi.fn(),drawImage:vi.fn(),fill:vi.fn(),stroke:vi.fn(),fillRect:vi.fn(),clearRect:vi.fn(),
    ellipse:vi.fn(),arc:vi.fn(),quadraticCurveTo:vi.fn(),fillText:vi.fn(),setLineDash:vi.fn(),translate:vi.fn(),scale:vi.fn(),
    createLinearGradient:vi.fn(()=>({addColorStop:vi.fn()})),createRadialGradient:vi.fn(()=>({addColorStop:vi.fn()})),
    fillStyle:'',strokeStyle:'',lineWidth:1,font:'',filter:'none'};
}
let ctx:ReturnType<typeof context>;
beforeEach(()=>{
  ctx=context();
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((type:string)=>(type==='2d'?ctx:null) as unknown as CanvasRenderingContext2D);
});
const canvas=()=>{const c=document.createElement('canvas');c.width=640;c.height=400;return c};
describe('actual canvas command paths, without a browser rasterizer',()=>{
  it.each(['Wheel','Orbit','Chase','Driver'] as const)('renders textured geometry and car camera %s with finite transforms',camera=>{
    renderRoad(canvas(),{texture:canvas(),marks:[],config:{width:6,length:30,speed:25},path:defaultPath,
      drive:initialDrive(),camera,rotation:-25,zoom:1,mesh:true,guides:true});
    expect(ctx.drawImage.mock.calls.length).toBeGreaterThan(0);
    for(const call of ctx.transform.mock.calls)expect(call.every(Number.isFinite)).toBe(true);
  });
  it('executes all weather drawing paths on a real output canvas object',()=>{
    for(const weather of ['None','Shadow','Low light','Glare','Blur','Perspective','Rain'] as const){
      const output=weatherCanvas(canvas(),weather,70);
      expect(output).toBeInstanceOf(HTMLCanvasElement);expect(output.width).toBe(640);expect(output.height).toBe(400);
    }
    expect(ctx.createRadialGradient).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });
  it('paints only selected repair regions and preserves original pixels in the Original branch',()=>{
    const a:Mark={id:'M1',kind:'Pothole',x:.3,y:.4,width:.2,length:.1,depthMm:60,severity:1,repaired:true,provenance:'manual'};
    const b:Mark={...a,id:'M2',x:.8,repaired:false};
    scenarioTexture(canvas(),[a,b],'Original');expect(ctx.ellipse).not.toHaveBeenCalled();
    scenarioTexture(canvas(),[a,b],'Repaired');expect(ctx.ellipse).toHaveBeenCalledTimes(1);
    expect(ctx.ellipse.mock.calls[0].slice(0,2)).toEqual([192,160]);
  });
});
