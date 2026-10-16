export type DefectKind = 'Pothole' | 'Crack' | 'Depression' | 'Ravelling' | 'Uneven surface';
export type Scenario = 'Original' | 'Deteriorated' | 'Repaired';
export type Weather = 'None' | 'Shadow' | 'Low light' | 'Glare' | 'Blur' | 'Perspective' | 'Rain';
export interface Mark {
  id: string; kind: DefectKind; x: number; y: number;
  width: number; length: number; depthMm: number; severity: number;
  repaired: boolean; provenance: 'manual' | 'sample' | 'detected';
  confidence?:number;visualSeverity?:number;polygon?:Waypoint[];
}
export interface Waypoint { x: number; y: number }
export interface RoadConfig { width: number; length: number; speed: number }
export interface Wheel { body: number; bodyVelocity: number; axle: number; axleVelocity: number }
export interface DriveState {
  z: number; time: number; distance: number; wheels: Wheel[]; acceleration: number;
  heave: number; pitch: number; roll: number; energy: number; peak: number; hits: string[];
}
export interface DriveResult {
  scenario: Scenario; rms: number; peak: number; distance: number; seconds: number;
  speed: number; hits: number; trace: {distance: number; acceleration: number}[];
}
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const defaultPath: Waypoint[] = [{x:.5,y:1},{x:.5,y:0}];
export function effectiveMarks(marks:Mark[],scenario:Scenario,months:number,rates:GrowthRates=defaultGrowth):Mark[]{
  const time=clamp(months,0,24),growth=scenario==='Deteriorated'?time:0;
  return marks.filter(m=>scenario!=='Repaired'||!m.repaired).map(m=>{
    const depthFactor=1+growth*clamp(rates.depth,0,.1),sizeFactor=1+growth*clamp(rates.size,0,.05);
    return editMark(m,{depthMm:m.depthMm*depthFactor,width:Math.min(.99,m.width*sizeFactor),length:Math.min(.99,m.length*sizeFactor),
      ...(m.visualSeverity==null?{}:{visualSeverity:clamp(m.visualSeverity*depthFactor,0,1)})});
  });
}
export function markDistance(mark:Mark,x:number,z:number,config:RoadConfig) {
  if(mark.polygon?.length){
    const px=x/config.width+.5,py=1-z/config.length;
    if(Math.abs(px-mark.x)>mark.width/2+.00001||Math.abs(py-mark.y)>mark.length/2+.00001)return 3;
    let inside=false,distance=Infinity;const points=mark.polygon;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
      if((a.y>py)!==(b.y>py)&&px<(b.x-a.x)*(py-a.y)/(b.y-a.y)+a.x)inside=!inside;
      const t=clamp(((px-a.x)*dx+(py-a.y)*dy)/Math.max(1e-12,dx*dx+dy*dy),0,1);
      distance=Math.min(distance,Math.hypot(px-a.x-t*dx,py-a.y-t*dy));
    }
    return inside?1-clamp(distance/Math.max(.001,Math.min(mark.width,mark.length)*.3),0,1):3;
  }
  const mx=(mark.x-.5)*config.width, mz=(1-mark.y)*config.length;
  return ((x-mx)/(mark.width*config.width/2))**2+((z-mz)/(mark.length*config.length/2))**2;
}
export function groundHeight(x:number,z:number,marks:Mark[],config:RoadConfig):number {
  return marks.reduce((height,m)=>{
    const r=markDistance(m,x,z,config);
    if(r>2.25)return height;
    const sign=m.kind==='Uneven surface'?1:-1;
    const rough=m.kind==='Ravelling'?.5+.5*Math.sin(x*40+z*24):1;
    return height+sign*m.depthMm/1000*m.severity*(m.polygon?.length?Math.max(0,1-r)**2:Math.exp(-4*r))*rough;
  },0);
}
export function orderedPath(path:Waypoint[]):Waypoint[] {
  const ordered=path.map(p=>({x:clamp(p.x,.16,.84),y:clamp(p.y,0,1)})).sort((a,b)=>b.y-a.y);
  if(!ordered.length)return defaultPath.map(p=>({...p}));
  if(ordered[0].y<1)ordered.unshift({x:ordered[0].x,y:1});
  if(ordered.at(-1)!.y>0)ordered.push({x:ordered.at(-1)!.x,y:0});
  return ordered;
}
export function pathX(z:number,path:Waypoint[],config:RoadConfig) {
  const points=orderedPath(path), y=1-clamp(z/config.length,0,1);
  for(let i=1;i<points.length;i++){
    if(y>=points[i].y){
      const a=points[i-1],b=points[i],t=clamp((a.y-y)/Math.max(a.y-b.y,1e-6),0,1);
      // Smoothstep makes steering continuous within each path leg.
      return clamp((a.x+(b.x-a.x)*t*t*(3-2*t)-.5)*config.width,-Math.max(0,config.width/2-.95),Math.max(0,config.width/2-.95));
    }
  }
  return clamp((points.at(-1)!.x-.5)*config.width,-Math.max(0,config.width/2-.95),Math.max(0,config.width/2-.95));
}
export function initialDrive():DriveState {
  return {z:1.6,time:0,distance:0,wheels:Array.from({length:4},()=>({body:0,bodyVelocity:0,axle:0,axleVelocity:0})),
    acceleration:0,heave:0,pitch:0,roll:0,energy:0,peak:0,hits:[]};
}
export const vehicle = {sprungMass:350,unsprungMass:40,spring:22000,damping:1800,tire:180000,wheelbase:2.6,track:1.5};

/** Nominal passenger tire geometry. Static load is included in the tire deflection. */
export const tire = { radius:.345, width:.235, staticDeflection:(vehicle.sprungMass+vehicle.unsprungMass)*9.81/vehicle.tire };
export function wheelPosition(z:number,index:number,path:Waypoint[],config:RoadConfig) {
  const gradient=(pathX(z+.1,path,config)-pathX(z-.1,path,config))/.2;
  const yaw=Math.atan(gradient),side=index%2===0?-1:1,front=index<2?1:-1;
  return {x:pathX(z,path,config)+side*vehicle.track/2*Math.cos(yaw)+front*vehicle.wheelbase/2*Math.sin(yaw),
    z:z+front*vehicle.wheelbase/2*Math.cos(yaw)-side*vehicle.track/2*Math.sin(yaw),yaw};
}
/** Rolling-circle support over the tire footprint. A tire bridges narrow cracks. */
export function tireContactHeight(x:number,z:number,marks:Mark[],config:RoadConfig,yaw=0) {
  if(!marks.length)return 0;
  let support=-Infinity;
  for(let i=-3;i<=3;i++){
    const along=i/3*tire.radius*.8,crown=Math.sqrt(tire.radius**2-along**2)-tire.radius;
    for(const across of [-tire.width*.35,0,tire.width*.35]){
      support=Math.max(support,groundHeight(x+across*Math.cos(yaw)+along*Math.sin(yaw),z+along*Math.cos(yaw)-across*Math.sin(yaw),marks,config)+crown);
    }
  }
  return support;
}

export function stepDrive(state:DriveState,config:RoadConfig,marks:Mark[],path:Waypoint[],dt=1/240):DriveState {
  const gradient=(pathX(state.z+.1,path,config)-pathX(state.z-.1,path,config))/.2;
  const yaw=Math.atan(gradient), speed=config.speed/3.6;
  const z=Math.min(config.length-1.6,state.z+speed*Math.cos(yaw)*dt);
  const hits=new Set(state.hits);
  let sumAcceleration=0;
  const wheels=state.wheels.map((w,i)=>{
    const {x:wx,z:wz,yaw:wheelYaw}=wheelPosition(z,i,path,config);
    const road=tireContactHeight(wx,wz,marks,config,wheelYaw);
    for(const mark of marks)if(markDistance(mark,wx,wz,config)<1)hits.add(mark.id);
    const springForce=vehicle.spring*(w.body-w.axle)+vehicle.damping*(w.bodyVelocity-w.axleVelocity);
    const bodyAcceleration=-springForce/vehicle.sprungMass;
    const tireForce=vehicle.tire*(Math.max(0,tire.staticDeflection+road-w.axle)-tire.staticDeflection);
    const axleAcceleration=(springForce+tireForce)/vehicle.unsprungMass;
    const bodyVelocity=w.bodyVelocity+bodyAcceleration*dt,axleVelocity=w.axleVelocity+axleAcceleration*dt;
    sumAcceleration+=bodyAcceleration;
    return {body:w.body+bodyVelocity*dt,bodyVelocity,axle:w.axle+axleVelocity*dt,axleVelocity};
  });
  const acceleration=sumAcceleration/4;
  return {z,time:state.time+dt,distance:state.distance+speed*dt,wheels,acceleration,
    heave:wheels.reduce((s,w)=>s+w.body,0)/4,
    pitch:Math.atan2((wheels[0].body+wheels[1].body-wheels[2].body-wheels[3].body)/2,vehicle.wheelbase),
    roll:Math.atan2((wheels[0].body+wheels[2].body-wheels[1].body-wheels[3].body)/2,vehicle.track),
    energy:state.energy+acceleration**2*dt,peak:Math.max(state.peak,Math.abs(acceleration)),hits:[...hits]};
}
export function driveResult(state:DriveState,scenario:Scenario,config:RoadConfig,trace:DriveResult['trace']):DriveResult {
  return {scenario,rms:state.time?Math.sqrt(state.energy/state.time):0,peak:state.peak,distance:state.distance,
    seconds:state.time,speed:config.speed,hits:state.hits.length,trace:[...trace]};
}
export function affectedFraction(marks:Mark[],config:RoadConfig) {
  let cells=0;
  const nx=40,nz=100;
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
    if(marks.some(m=>markDistance(m,((i+.5)/nx-.5)*config.width,(j+.5)/nz*config.length,config)<=1))cells++;
  }
  return cells/(nx*nz);
}
export const repairCost=(mark:Mark,config:RoadConfig,rate:number)=>Math.round(1000+markArea(mark,config)*rate);
export function recommendRepairs(marks:Mark[],config:RoadConfig,rate:number,budget:number):string[] {
  let remaining=budget;
  const ranked=[...marks].sort((a,b)=>{
    const benefit=(m:Mark)=>m.depthMm*markArea(m,config)*m.severity/repairCost(m,config,rate);
    return benefit(b)-benefit(a)||a.id.localeCompare(b.id);
  });
  return ranked.filter(m=>{const cost=repairCost(m,config,rate);if(cost>remaining)return false;remaining-=cost;return true}).map(m=>m.id);
}

/** Explicit demonstration geometry, placed in the right wheel track. Never inferred from uploads. */
export function wheelDemoMarks(config:RoadConfig):Mark[] {
  const x=clamp(.5+vehicle.track/2/config.width,.1,.9);
  return [
    {id:'D1',kind:'Pothole',x,y:.70,width:.95/config.width,length:1.35/config.length,depthMm:75,severity:1.3,repaired:false,provenance:'sample'},
    {id:'D2',kind:'Uneven surface',x,y:.46,width:1.5/config.width,length:1.1/config.length,depthMm:48,severity:1,repaired:false,provenance:'sample'},
    {id:'D3',kind:'Ravelling',x,y:.22,width:1.2/config.width,length:1.8/config.length,depthMm:24,severity:.8,repaired:false,provenance:'sample'},
  ];
}

export interface GrowthRates {depth:number;size:number}
export const defaultGrowth:GrowthRates={depth:.03,size:.015};
/** Keep contour geometry and its bounding fields synchronized when edited or grown. */
export function editMark(mark:Mark,update:Partial<Mark>):Mark {
  const next={...mark,...update};
  if(!mark.polygon?.length||update.polygon)return next;
  const geometryChanged=(['x','y','width','length'] as const).some(k=>update[k]!==undefined&&next[k]!==mark[k]);
  if(!geometryChanged)return next;
  const sx=next.width/Math.max(mark.width,1e-8),sy=next.length/Math.max(mark.length,1e-8);
  const polygon=mark.polygon.map(p=>({x:clamp(next.x+(p.x-mark.x)*sx,0,1),y:clamp(next.y+(p.y-mark.y)*sy,0,1)}));
  const xs=polygon.map(p=>p.x),ys=polygon.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  return {...next,polygon,x:(x0+x1)/2,y:(y0+y1)/2,width:Math.max(.0001,x1-x0),length:Math.max(.0001,y1-y0)};
}
export function markArea(mark:Mark,config:RoadConfig) {
  if(!mark.polygon?.length)return Math.PI*mark.width*config.width*mark.length*config.length/4;
  const p=mark.polygon;
  return Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a.x*b.y-b.x*a.y},0))/2*config.width*config.length;
}
export function surfaceSeverity(mark:Mark) {
  return mark.visualSeverity??clamp((mark.severity-.5)/1.3,0,1);
}
export function surfaceProfile(marks:Mark[],config:RoadConfig,path:Waypoint[],samples=240) {
  return Array.from({length:samples+1},(_,i)=>{
    const z=1.6+i/samples*(config.length-3.2),left=wheelPosition(z,0,path,config),right=wheelPosition(z,1,path,config);
    return {z,leftMm:groundHeight(left.x,left.z,marks,config)*1000,rightMm:groundHeight(right.x,right.z,marks,config)*1000};
  });
}
