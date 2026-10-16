
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
const base=process.env.ROAD_HEALTH_API_URL??'http://127.0.0.1:8000';
const conditions=['rain','puddles','shadow','low_light','glare','blur','perspective'];
const photo=await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url));
let checks=0;const reports=[];
async function post(bytes,settings={}){
 const f=new FormData();f.append('image',new Blob([bytes]),settings.filename??'pothole-road.jpg');
 f.append('conditions_json',JSON.stringify(settings.conditions??conditions));f.append('intensity',String(settings.intensity??.6));
 f.append('preprocessing',String(settings.preprocessing??true));
 for(const key of ['road_quad','annotations_json'])if(settings[key]!==undefined)f.append(key,JSON.stringify(settings[key]));
 const r=await fetch(base+'/weather-compare',{method:'POST',body:f});return {status:r.status,value:await r.json()};
}
const hash=b=>createHash('sha256').update(b).digest('hex');
function decodePng(file){let at=8,width,height,type;const parts=[];
  while(at<file.length){const n=file.readUInt32BE(at),name=file.toString('ascii',at+4,at+8),d=file.subarray(at+8,at+8+n);if(name==='IHDR'){width=d.readUInt32BE(0);height=d.readUInt32BE(4);type=d[9];assert.equal(d[8],8)}if(name==='IDAT')parts.push(d);at+=12+n}
  const channels=type===0?1:type===2?3:type===6?4:0;assert.ok(channels);
  const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,output=Buffer.alloc(width*height*channels);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const a=x>=channels?output[y*stride+x-channels]:0,b=y?output[(y-1)*stride+x]:0,c=y&&x>=channels?output[(y-1)*stride+x-channels]:0;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);output[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255}}
  return {width,height,channels,pixels:output};
}
const dimensions=b=>[b.readUInt32BE(16),b.readUInt32BE(20)];
async function verify(bytes,settings={},expected){
 const r=await post(bytes,settings);assert.equal(r.status,200,JSON.stringify(r.value));const a=r.value;
 assert.equal(a.metadata.sha256,hash(bytes));assert.equal(a.metadata.source_file_unchanged,true);checks++;
 if(expected){assert.deepEqual([a.metadata.width,a.metadata.height],expected);checks++}
 for(const f of a.frames){
   assert.deepEqual([f.width,f.height],[a.metadata.width,a.metadata.height]);
   const response=await fetch(base+f.image_path);assert.equal(response.status,200);const png=Buffer.from(await response.arrayBuffer());
   assert.deepEqual(dimensions(png),[a.metadata.width,a.metadata.height]);
   assert.ok(f.summary.affected_pixel_area<=f.summary.visible_road_pixel_area);
   for(const d of f.defects){
     assert.equal(d.physical_dimensions,null);assert.equal(d.confidence_calibrated,false);
     for(const p of [...d.frame_polygon,...d.reference_polygon])assert.ok(p[0]>=0&&p[0]<=f.width-1&&p[1]>=0&&p[1]<=f.height-1);
   }
   if(f.preprocessing.enabled){assert.ok(f.preprocessing.raw_only.every(id=>id.startsWith(f.condition+'-raw-')));for(const d of f.defects)if(d.raw_support)assert.ok(d.raw_support.startsWith(f.condition+'-raw-'))}
   const m=f.to_condition,n=f.to_reference;
   for(const p of [[0,0],[a.metadata.width*.5,a.metadata.height*.7],[a.metadata.width-1,a.metadata.height-1]]){
     const project=(p,H)=>{const z=H[2][0]*p[0]+H[2][1]*p[1]+H[2][2];return [(H[0][0]*p[0]+H[0][1]*p[1]+H[0][2])/z,(H[1][0]*p[0]+H[1][1]*p[1]+H[1][2])/z]};
     const q=project(project(p,m),n);assert.ok(Math.hypot(q[0]-p[0],q[1]-p[1])<.001);
   }
   if(!a.ground_truth_supplied){assert.equal(f.metrics.available,false);assert.equal(f.metrics.f1,null)}
   else {const t=f.metrics;assert.equal(t.available,true);assert.equal(t.f1,2*t.tp+t.fp+t.fn?2*t.tp/(2*t.tp+t.fp+t.fn):null)}
   checks++;
 }
 reports.push({filename:settings.filename??'pothole-road.jpg',metadata:a.metadata,ground_truth_source:a.ground_truth_source,
 frames:a.frames.map(f=>({condition:f.condition,engine:f.engine,count:f.summary.count,metrics:f.metrics,pipeline_ms:f.pipeline_ms}))});
 return a;
}
const supplied=await verify(photo,{},[640,427]);assert.ok(supplied.frames[0].defects.length>0);checks++;
for(const filename of ['India_India_000114.jpg','China_Drone_China_Drone_000008.jpg']){
 const bytes=await readFile(new URL('../../data/examples/rdd2022/'+filename,import.meta.url));const a=await verify(bytes,{filename});
 assert.equal(a.ground_truth_source,'Bundled RDD2022 exact SHA-256 match');assert.ok(a.frames.every(f=>f.metrics.annotation_count>0));checks++;
}
// Odd-sized >1024 px native fixture: generated test geometry is not evaluation ground truth.
const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1}return (c^0xffffffff)>>>0};
const chunk=(name,bytes)=>{const type=Buffer.from(name),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,bytes])),bytes.length+8);return out};
const width=1739,height=1081,raw=Buffer.alloc(height*(width*3+1));
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dark=((x-900)/120)**2+((y-740)/65)**2<1;const v=dark?35:95+((x*13+y*17)%12);for(let c=0;c<3;c++)raw[y*(width*3+1)+1+x*3+c]=v}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
const native=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const nativeResult=await verify(native,{filename:'native-1739x1081.png',conditions:['shadow','blur','perspective']},[width,height]);
const unchanged=Buffer.from(await (await fetch(base+nativeResult.frames[0].image_path)).arrayBuffer());
assert.deepEqual(decodePng(unchanged).pixels,decodePng(native).pixels);checks++;
// Insert EXIF Orientation=6 without touching compressed JPEG pixels.
const exif=Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000','hex');const app1=Buffer.alloc(4);app1[0]=255;app1[1]=225;app1.writeUInt16BE(exif.length+2,2);
const rotated=Buffer.concat([photo.subarray(0,2),app1,exif,photo.subarray(2)]);
const portrait=await verify(rotated,{conditions:['perspective'],filename:'portrait-exif6.jpg'},[427,640]);assert.equal(portrait.metadata.exif_orientation,6);assert.deepEqual([portrait.metadata.raw_width,portrait.metadata.raw_height],[640,427]);checks++;
const impostor=await verify(photo,{filename:'India_India_000114.jpg',conditions:['rain'],preprocessing:false},[640,427]);assert.equal(impostor.ground_truth_supplied,false);checks++;
const zero=await verify(photo,{conditions:['shadow'],intensity:0,preprocessing:false});
assert.deepEqual(zero.frames[0].defects.map(d=>d.reference_polygon),zero.frames[1].defects.map(d=>d.reference_polygon));checks++;
assert.equal((await post(photo,{conditions:['bad']})).status,422);
assert.equal((await post(photo,{conditions:['rain','rain']})).status,422);
assert.equal((await post(photo,{annotations_json:[{id:'bad',kind:'Pothole',polygon:[[0,0],[2,0],[0,1]]}]})).status,422);checks++;
assert.equal(hash(photo),hash(await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))));checks++;
await mkdir(new URL('../.verification/',import.meta.url),{recursive:true});
await writeFile(new URL('../.verification/weather-live-report.json',import.meta.url),JSON.stringify({checks,reports,note:'Small synthetic-condition smoke validation, not a representative accuracy benchmark. Supplied pothole photo has no ground truth. No active model means unvalidated CV candidates.'},null,2));
console.log(checks+' live native-weather checks passed. Per-condition real annotation metrics saved to .verification/weather-live-report.json.');
