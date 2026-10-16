import { clamp } from './model';
export type Point={x:number;y:number};
// Corners in image coordinates: far left, far right, near right, near left.
export type RoadQuad=[Point,Point,Point,Point];
export const sceneQuad:RoadQuad=[{x:.44,y:.23},{x:.56,y:.23},{x:.99,y:.99},{x:.01,y:.99}];
export const fullQuad:RoadQuad=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
export function validQuad(q:RoadQuad) {
  return q.every((p,i)=>{
    const a=q[(i+1)%4],b=q[(i+2)%4];
    return Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
      &&(a.x-p.x)*(b.y-a.y)-(a.y-p.y)*(b.x-a.x)>.0005;
  });
}
// Exact planar homography from a unit square to a convex image quadrilateral.
export function roadProject(q:RoadQuad,u:number,v:number):Point {
  const [a,b,c,d]=q;
  const dx1=b.x-c.x,dx2=d.x-c.x,dy1=b.y-c.y,dy2=d.y-c.y;
  const sx=a.x-b.x+c.x-d.x,sy=a.y-b.y+c.y-d.y,det=dx1*dy2-dx2*dy1;
  const g=Math.abs(det)>1e-12?(sx*dy2-dx2*sy)/det:0;
  const h=Math.abs(det)>1e-12?(dx1*sy-sx*dy1)/det:0;
  const denominator=g*u+h*v+1;
  return {x:((b.x-a.x+g*b.x)*u+(d.x-a.x+h*d.x)*v+a.x)/denominator,
    y:((b.y-a.y+g*b.y)*u+(d.y-a.y+h*d.y)*v+a.y)/denominator};
}
export function rectifyRoad(source:HTMLCanvasElement,q:RoadQuad):HTMLCanvasElement {
  if(!validQuad(q))throw new Error('Select four convex road corners in clockwise order.');
  // Preserve already rectified full-frame crops without stretching their chip geometry.
  if(q.every((p,i)=>Math.abs(p.x-fullQuad[i].x)<1e-9&&Math.abs(p.y-fullQuad[i].y)<1e-9))return source;
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=768;
  const ctx=canvas.getContext('2d')!,input=source.getContext('2d')!.getImageData(0,0,source.width,source.height);
  const output=ctx.createImageData(canvas.width,canvas.height),sw=source.width,sh=source.height;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const p=roadProject(q,x/(canvas.width-1),y/(canvas.height-1));
    const sx=clamp(p.x*(sw-1),0,sw-1),sy=clamp(p.y*(sh-1),0,sh-1);
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);
    const fx=sx-x0,fy=sy-y0,at=(y*canvas.width+x)*4;
    for(let ch=0;ch<3;ch++)output.data[at+ch]=
      input.data[(y0*sw+x0)*4+ch]*(1-fx)*(1-fy)+input.data[(y0*sw+x1)*4+ch]*fx*(1-fy)+
      input.data[(y1*sw+x0)*4+ch]*(1-fx)*fy+input.data[(y1*sw+x1)*4+ch]*fx*fy;
    output.data[at+3]=255;
  }
  ctx.putImageData(output,0,0);return canvas;
}
