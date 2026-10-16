
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const base=process.env.ROAD_HEALTH_API_URL??'http://127.0.0.1:8000';
const photo=await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url));
const quad=[{x:.44,y:.23},{x:.56,y:.23},{x:.99,y:.99},{x:.01,y:.99}];
const post=async(settings={},extra={},bytes=photo)=>{
  const f=new FormData();f.append('image',new Blob([bytes]),'provided-pothole.jpg');
  f.append('road_quad',JSON.stringify(quad));f.append('settings_json',JSON.stringify({engine:'opencv',...settings}));
  for(const [k,v]of Object.entries(extra))f.append(k,JSON.stringify(v));
  const r=await fetch(base+'/repair-views',{method:'POST',body:f});const t=await r.text();
  return {status:r.status,value:JSON.parse(t)};
};
function decode(url){
  const file=Buffer.from(url.split(',')[1],'base64');let at=8,width,height,type;const parts=[];
  while(at<file.length){const n=file.readUInt32BE(at),name=file.toString('ascii',at+4,at+8),d=file.subarray(at+8,at+8+n);if(name==='IHDR'){width=d.readUInt32BE(0);height=d.readUInt32BE(4);type=d[9];assert.equal(d[8],8)}if(name==='IDAT')parts.push(d);at+=12+n}
  const channels=type===0?1:type===2?3:type===6?4:0;assert.ok(channels);
  const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,output=Buffer.alloc(width*height*channels);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const a=x>=channels?output[y*stride+x-channels]:0,b=y?output[(y-1)*stride+x]:0,c=y&&x>=channels?output[(y-1)*stride+x-channels]:0;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);output[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255}}
  return {width,height,channels,pixels:output};
}
let checks=0;
const initial=await post({months:3});assert.equal(initial.status,200);const a=initial.value;
assert.equal(a.simulated,true);assert.equal(a.forecast_validated,false);assert.ok(a.repair_count>0);checks++;
assert.equal(a.images.source===a.images.repaired,false);assert.notEqual(a.images.original,a.images.repaired);assert.notEqual(a.images.repaired,a.images.predicted);checks++;
assert.deepEqual([a.image.width,a.image.height],[640,427]);checks++;
const source=decode(a.images.source),repaired=decode(a.images.repaired),predicted=decode(a.images.predicted),repairMask=decode(a.masks.repair),futureMask=decode(a.masks.prediction);
let changes=0;
for(let i=0;i<source.width*source.height;i++)for(let c=0;c<3;c++){
  const original=source.pixels[i*3+c];
  if(!repairMask.pixels[i])assert.equal(repaired.pixels[i*3+c],original);
  else changes+=Number(repaired.pixels[i*3+c]!==original);
  if(!futureMask.pixels[i])assert.equal(predicted.pixels[i*3+c],original);
}
assert.ok(changes>1000);checks+=2;
const b=(await post({months:6})).value,c=(await post({months:12})).value;
assert.equal(a.images.repaired,b.images.repaired);assert.equal(b.images.repaired,c.images.repaired);checks++;
assert.notEqual(a.images.predicted,b.images.predicted);assert.notEqual(b.images.predicted,c.images.predicted);checks++;
for(const d of a.defects.filter(d=>d.repaired))assert.ok(c.defects.find(x=>x.id===d.id).patch_degradation>d.patch_degradation);checks++;
const zero=(await post({months:0})).value;assert.equal(zero.images.repaired,zero.images.predicted);checks++;
const ns=(await post({months:6,inpaint_method:'ns'})).value;assert.equal(ns.engine_used,'opencv_ns');assert.notEqual(ns.images.source,ns.images.repaired);checks++;
const status=await (await fetch(base+'/repair-views/status')).json();
if(!status.diffusers_configured||!status.diffusers_installed){
  const fallback=(await post({months:6,engine:'diffusers'})).value;
  assert.equal(fallback.engine_used,'opencv_telea');assert.ok(fallback.fallback_reason);assert.notEqual(fallback.images.source,fallback.images.repaired);checks++;
}
const selected=a.defects.filter(d=>d.repaired).map(d=>d.id);
const largest=a.defects.filter(d=>d.repaired).sort((a,b)=>b.original_area_px-a.original_area_px)[0].id;
const selection=selected.filter(id=>id!==largest);
const u3=(await post({months:3},{repair_ids_json:selection})).value;
const u12=(await post({months:12},{repair_ids_json:selection})).value;
assert.equal(u3.repair_count,selection.length);assert.equal(u3.defects.find(d=>d.id===largest).repaired,false);checks++;
assert.ok(u12.defects.find(d=>d.id===largest).predicted_area_px>u3.defects.find(d=>d.id===largest).predicted_area_px);checks++;
const low=(await post({months:12,repair_quality:1,traffic:'light',weather:'dry'})).value;
const high=(await post({months:12,repair_quality:.1,traffic:'heavy',weather:'wet'})).value;
assert.ok(high.defects.find(d=>d.repaired).patch_degradation>low.defects.find(d=>d.repaired).patch_degradation);
assert.notEqual(low.images.predicted,high.images.predicted);checks++;
const noRepair=(await post({months:6},{repair_ids_json:[]})).value;assert.equal(noRepair.repair_count,0);assert.equal(noRepair.images.source,noRepair.images.repaired);assert.ok(noRepair.warnings.some(w=>w.includes('No repairs selected')));checks++;
const smooth=await readFile(new URL('../../tests/fixtures/smooth-road.png',import.meta.url));
const empty=(await post({months:12},{},smooth)).value;assert.equal(empty.repair_count,0);assert.deepEqual(empty.defects,[]);assert.equal(empty.images.source,empty.images.predicted);checks++;
assert.equal((await post({months:25})).status,422);assert.equal((await post({repair_quality:2})).status,422);assert.equal((await post({},{repair_ids_json:['not-detected']})).status,422);checks++;
const bad={id:'bad',kind:'Pothole',severity:.5,polygon:[{x:0,y:0},{x:1.2,y:0},{x:0,y:1}]};
assert.equal((await post({},{defects_json:[bad]})).status,422);checks++;
assert.equal(createHash('sha256').update(photo).digest('hex'),createHash('sha256').update(await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))).digest('hex'));checks++;
console.log(checks+' live repair-photo checks passed on the supplied pothole image; '+a.repair_count+' review-required regions patched. Diffusion availability: '+status.diffusers_configured+'/'+status.diffusers_installed+'. No forecasting accuracy is implied.');
