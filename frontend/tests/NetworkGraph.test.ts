
import {describe,it,expect} from 'vitest';
import {parseNetwork,roadGraph,shortestRoute,distance,projectNetwork} from '../src/network/graph';
const collection=(lines:number[][][])=>({type:'FeatureCollection',features:lines.map((coordinates,i)=>({type:'Feature',id:'r'+i,properties:{name:'Road '+i},geometry:{type:'LineString',coordinates}}))});
describe('connected road geometry',()=>{
  it('joins a branch at an internal vertex and routes through it',()=>{
    const graph=roadGraph(parseNetwork(collection([[[77,13],[77.001,13],[77.002,13]],[[77.001,13],[77.001,13.001]]])));
    expect(graph.components).toBe(1);expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes[1].links).toEqual(['r0','r1']);
    const route=shortestRoute(graph,0,3)!;
    expect(route.links).toEqual(['r0','r1']);expect(route.nodes).toEqual([0,1,3]);
    expect(route.distance).toBeCloseTo(distance([77,13],[77.001,13])+distance([77.001,13],[77.001,13.001]),5);
  });
  it('snaps shared junctions within two metres',()=>{
    const graph=roadGraph(parseNetwork(collection([[[77,13],[77.001,13]],[[77.001005,13],[77.002,13]]])));
    expect(graph.components).toBe(1);expect(graph.nodes).toHaveLength(3);
  });
  it('does not join an overpass-style crossing without a shared vertex',()=>{
    const graph=roadGraph(parseNetwork(collection([[[77,13],[77.002,13]],[[77.001,12.999],[77.001,13.001]]])));
    expect(graph.components).toBe(2);expect(shortestRoute(graph,0,3)).toBeNull();
  });
  it('returns an empty zero-distance route at the same node',()=>{
    const graph=roadGraph(parseNetwork(collection([[[77,13],[77.001,13]]])));
    expect(shortestRoute(graph,0,0)).toEqual({nodes:[0],links:[],distance:0});
  });
  it('preserves real geometry proportions and north orientation',()=>{
    const graph=roadGraph(parseNetwork(collection([[[77,13],[77.001,13],[77.001,13.001]]])));
    const p=projectNetwork(graph),a=p([77,13]),b=p([77.001,13]),c=p([77.001,13.001]);
    expect(b[0]).toBeGreaterThan(a[0]);expect(c[1]).toBeLessThan(b[1]);
    expect((b[0]-a[0])/(b[1]-c[1])).toBeCloseTo(Math.cos(13.0005*Math.PI/180),4);
  });
  it('supports multipart lines with stable unique IDs',()=>{
    const links=parseNetwork({type:'FeatureCollection',features:[{type:'Feature',id:'main',geometry:{type:'MultiLineString',coordinates:[[[77,13],[77.001,13]],[[77.001,13],[77.002,13]]]}}]});
    expect(links.map(x=>x.id)).toEqual(['main-1','main-2']);
  });
  it('rejects bad coordinates, duplicate IDs and non-road geometry',()=>{
    expect(()=>parseNetwork(collection([[[181,13],[77,13]]]))).toThrow('WGS84');
    const data=collection([[[77,13],[77.001,13]],[[77,13],[77.002,13]]]);data.features[1].id='r0';
    expect(()=>parseNetwork(data)).toThrow('unique');
    expect(()=>parseNetwork({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[77,13]}}]})).toThrow('Only LineString');
    data.features[1].id='__proto__';expect(()=>parseNetwork(data)).toThrow('non-reserved');
  });
});
