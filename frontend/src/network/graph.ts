
/** WGS84 road geometry. Connectivity requires shared vertices within 2 m.
 * Crossings without shared vertices are deliberately not joined (bridges). */
export type Position=[number,number];
export interface RoadLink {id:string;name:string;coordinates:Position[];length:number}
export interface RoadNode {id:number;position:Position;links:string[]}
export interface RoadGraph {links:RoadLink[];nodes:RoadNode[];edges:{a:number;b:number;length:number;link:string}[];components:number}
const radians=(n:number)=>n*Math.PI/180;
export function distance(a:Position,b:Position){
  const p=radians(b[1]-a[1]),q=radians(b[0]-a[0]);
  const h=Math.sin(p/2)**2+Math.cos(radians(a[1]))*Math.cos(radians(b[1]))*Math.sin(q/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function parseNetwork(input:unknown):RoadLink[]{
  const data=input as {type?:string;features?:unknown[]};
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Use a WGS84 GeoJSON FeatureCollection of LineString roads.');
  const links:RoadLink[]=[];let points=0;
  for(const [i,item] of data.features.entries()){
    const f=item as {type?:string;id?:unknown;properties?:Record<string,unknown>;geometry?:{type?:string;coordinates?:unknown}};
    if(f.type!=='Feature'||!f.geometry)throw Error('Every road needs a GeoJSON Feature and geometry.');
    const type=f.geometry.type;
    if(type!=='LineString'&&type!=='MultiLineString')throw Error('Only LineString and MultiLineString road geometry is supported.');
    const lines=type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
    if(!Array.isArray(lines))throw Error('Invalid road coordinates.');
    for(const [j,line]of lines.entries()){
      if(!Array.isArray(line)||line.length<2)throw Error('A road requires at least two coordinate pairs.');
      const coordinates=line.map(p=>{
        if(!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>85)throw Error('Coordinates must be WGS84 [longitude, latitude], latitude between −85 and 85.');
        return [p[0],p[1]] as Position;
      });
      points+=coordinates.length;
      if(points>10000||links.length>=2000)throw Error('Limit the import to 2,000 roads and 10,000 vertices.');
      const id=String(f.id??f.properties?.id??('road-'+(i+1)))+(lines.length>1?'-'+(j+1):'');
      if(!id.trim()||Object.getOwnPropertyNames(Object.prototype).includes(id)||id==='prototype')throw Error('Choose a non-reserved road ID.');
      if(links.some(x=>x.id===id))throw Error('Road IDs must be unique.');
      const length=coordinates.slice(1).reduce((sum,p,k)=>sum+distance(coordinates[k],p),0);
      if(length<.1)throw Error('Roads must have nonzero length.');
      links.push({id,name:String(f.properties?.name??id).slice(0,120),coordinates,length});
    }
  }
  if(!links.length)throw Error('No road lines found.');
  return links;
}
export function roadGraph(links:RoadLink[]):RoadGraph{
  const nodes:RoadNode[]=[],edges:RoadGraph['edges']=[],bins=new Map<string,number[]>();
  const lat=links[0]?.coordinates[0][1]??0,origin=links[0]?.coordinates[0]??[0,0];
  const project=(p:Position)=>[(p[0]-origin[0])*111195*Math.cos(radians(lat)),(p[1]-origin[1])*111195];
  for(const link of links){
    let previous=-1;
    for(const position of link.coordinates){
      const [x,y]=project(position),gx=Math.floor(x/2),gy=Math.floor(y/2);
      let id=-1,best=2;
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const n of bins.get((gx+a)+','+(gy+b))??[]){
        const d=distance(nodes[n].position,position);if(d<=best){id=n;best=d}
      }
      if(id<0){id=nodes.length;nodes.push({id,position,links:[]});const key=gx+','+gy;bins.set(key,[...(bins.get(key)??[]),id])}
      if(!nodes[id].links.includes(link.id))nodes[id].links.push(link.id);
      if(previous>=0&&previous!==id)edges.push({a:previous,b:id,length:distance(nodes[previous].position,nodes[id].position),link:link.id});
      previous=id;
    }
  }
  const adjacency=new Map<number,number[]>();for(const e of edges){adjacency.set(e.a,[...(adjacency.get(e.a)??[]),e.b]);adjacency.set(e.b,[...(adjacency.get(e.b)??[]),e.a])}
  const seen=new Set<number>();let components=0;
  for(const n of nodes)if(!seen.has(n.id)){components++;const stack=[n.id];seen.add(n.id);while(stack.length){for(const next of adjacency.get(stack.pop()!)??[])if(!seen.has(next)){seen.add(next);stack.push(next)}}}
  return {links,nodes,edges,components};
}
/** Undirected, distance-only route; no traffic restrictions or safety recommendation. */
export function shortestRoute(graph:RoadGraph,start:number,end:number){
  if(!graph.nodes[start]||!graph.nodes[end])return null;
  const costs=new Map<number,number>([[start,0]]),parent=new Map<number,{node:number;link:string}>(),done=new Set<number>();
  const adj=new Map<number,{node:number;length:number;link:string}[]>();
  for(const e of graph.edges){adj.set(e.a,[...(adj.get(e.a)??[]),{node:e.b,length:e.length,link:e.link}]);adj.set(e.b,[...(adj.get(e.b)??[]),{node:e.a,length:e.length,link:e.link}])}
  while(true){
    let node=-1,cost=Infinity;
    for(const [n,c]of costs)if(!done.has(n)&&c<cost){node=n;cost=c}
    if(node<0)return null;
    if(node===end){
      const path=[end],links:string[]=[];let n=end;
      while(n!==start){const p=parent.get(n)!;links.unshift(p.link);n=p.node;path.unshift(n)}
      return {nodes:path,links:[...new Set(links)],distance:cost};
    }
    done.add(node);
    for(const edge of adj.get(node)??[])if(!done.has(edge.node)&&cost+edge.length<(costs.get(edge.node)??Infinity)){costs.set(edge.node,cost+edge.length);parent.set(edge.node,{node,link:edge.link})}
  }
}
export function projectNetwork(graph:RoadGraph){
  const coordinates=graph.nodes.map(n=>n.position),lat=(Math.min(...coordinates.map(p=>p[1]))+Math.max(...coordinates.map(p=>p[1])))/2;
  const raw=(p:Position)=>[p[0]*Math.cos(radians(lat)),p[1]];
  const xy=coordinates.map(raw),xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]);
  const minX=Math.min(...xs),maxY=Math.max(...ys),dx=Math.max(...xs)-minX,dy=maxY-Math.min(...ys);
  const scale=Math.min(620/Math.max(dx,1e-8),320/Math.max(dy,1e-8));
  return (p:Position)=>{const [x,y]=raw(p);return [360+(x-minX-dx/2)*scale,200-(y-maxY+dy/2)*scale] as Position};
}

/** Filled hit area keeps horizontal/vertical roads keyboard and pointer accessible. */
export function roadHitPath(points:Position[],halfWidth:number){
  return points.slice(1).map((b,i)=>{
    const a=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(!length)return '';
    const nx=-dy/length*halfWidth,ny=dx/length*halfWidth;
    return 'M'+[a[0]+nx,a[1]+ny].join(',')+'L'+[b[0]+nx,b[1]+ny].join(',')+'L'+[b[0]-nx,b[1]-ny].join(',')+'L'+[a[0]-nx,a[1]-ny].join(',')+'Z';
  }).join(' ');
}
