export type Vertex = [number, number, number];
/** Fit projected bounds, preserving the proportions of the supplied geometry. */
export function fitRoadProjection(vertices: Vertex[], width: number, height: number, yaw: number, elevation: number, zoom = 1) {
 const a=yaw*Math.PI/180,p=elevation*Math.PI/180;
 const rotate=(v:Vertex)=>{const x=v[0]*Math.cos(a)-v[2]*Math.sin(a),z=v[0]*Math.sin(a)+v[2]*Math.cos(a);return {x,y:z*Math.sin(p)-v[1]*Math.cos(p),depth:z*Math.cos(p)+v[1]*Math.sin(p)}};
 const points=vertices.map(rotate);
 if(!points.length)throw new Error('The road mesh has no vertices.');
 const minX=Math.min(...points.map(v=>v.x)),maxX=Math.max(...points.map(v=>v.x)),minY=Math.min(...points.map(v=>v.y)),maxY=Math.max(...points.map(v=>v.y));
 const scale=Math.min(width*.84/Math.max(maxX-minX,Number.EPSILON),height*.78/Math.max(maxY-minY,Number.EPSILON))*zoom;
 return(v:Vertex)=>{const q=rotate(v);return {x:width/2+(q.x-(minX+maxX)/2)*scale,y:height/2+(q.y-(minY+maxY)/2)*scale,depth:q.depth}};
}
