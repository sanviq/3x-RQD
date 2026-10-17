import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=process.env.ROAD_HEALTH_API_URL??'http://127.0.0.1:8000';
const photo=await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url));
const smooth=await readFile(new URL('../../tests/fixtures/smooth-road.png',import.meta.url));
const quad=[{x:.44,y:.23},{x:.56,y:.23},{x:.99,y:.99},{x:.01,y:.99}];
const post=async(route,bytes=photo,roadQuad=quad,extra={})=>{
  const body=new FormData();body.append('image',new Blob([bytes]),'road.jpg');
  body.append('road_quad',typeof roadQuad==='string'?roadQuad:JSON.stringify(roadQuad));
  for(const [key,value]of Object.entries(extra))body.append(key,value);
  const response=await fetch(base+route,{method:'POST',body});
  return {status:response.status,value:await response.json()};
};
let checks=0;
// Score sessions intentionally have fresh IDs and timestamps on every request.
// Determinism concerns the image evidence and calculation, not those identifiers.
const stableEvidence=value=>{
  const copy=structuredClone(value);delete copy.score_token;
  if(copy.road_quality_score){delete copy.road_quality_score.snapshot_id;delete copy.road_quality_score.generated_at}
  return copy;
};
const health=await (await fetch(base+'/health')).json();
assert.equal(health.defect_version,'opencv-candidates-v2');checks++;
const first=await post('/detect-defects');assert.equal(first.status,200);
const d=first.value;assert.ok(d.defects.length>0);assert.equal(d.requires_review,true);checks++;
assert.ok(d.defects.some(v=>v.kind==='Pothole'&&v.bbox.x<=375&&v.bbox.x+v.bbox.width>=375&&v.bbox.y<=336&&v.bbox.y+v.bbox.height>=336));checks++;
assert.equal(d.confidence_calibrated,false);assert.ok(d.defects.every(v=>v.depth_mm===null&&v.physical_dimensions===null));checks++;
assert.ok(d.defects.every(v=>v.polygon.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)&&v.confidence>=0&&v.confidence<=1));checks++;
const second=await post('/detect-defects');assert.deepEqual(stableEvidence(second.value),stableEvidence(d));checks++;
const empty=await post('/detect-defects',smooth);assert.equal(empty.status,200);assert.deepEqual(empty.value.defects,[]);checks++;
assert.equal((await post('/detect-defects',photo,'[]')).status,422);checks++;
assert.equal((await post('/detect-defects',Buffer.from('not an image'))).status,422);checks++;
const analysis=await post('/analyze');assert.equal(analysis.status,200);assert.equal(analysis.value.assessment.road_quality_index,null);assert.deepEqual(stableEvidence(analysis.value.defect_detection),stableEvidence(d));checks++;
assert.equal(createHash('sha256').update(photo).digest('hex'),createHash('sha256').update(await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))).digest('hex'));checks++;

const region=analysis.value.analysis_region;
assert.equal(region.scope,'selected_road');assert.ok(region.image_fraction>0&&region.image_fraction<1);
assert.ok(region.processed_pixel_count<analysis.value.image.processed_width*analysis.value.image.processed_height);checks++;
const overlayAnalysis=await post('/analyze',photo,quad,{include_overlay:'true'});
assert.equal(overlayAnalysis.status,200);assert.ok(overlayAnalysis.value.overlay_png_base64.length>1000);
assert.ok(overlayAnalysis.value.chip_candidate_count>0);checks++;
// Synthetic evidence isolation check: changing scenery outside a fixed road ROI
// must not change any of the 17 road descriptors.
const {deflateSync}=await import('node:zlib');
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0};
const chunk=(name,bytes)=>{const tag=Buffer.from(name),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,bytes])));return Buffer.concat([n,tag,bytes,crc])};
const png=outside=>{
  const w=128,h=128,rows=Buffer.alloc(h*(w*3+1));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const v=x>=32&&x<=95&&y>=32&&y<=95?60+((x*19+y*31+x*y)%150):outside;
    for(let c=0;c<3;c++)rows[y*(w*3+1)+1+x*3+c]=v;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
};
const square=[{x:32/127,y:32/127},{x:95/127,y:32/127},{x:95/127,y:95/127},{x:32/127,y:95/127}];
const left=await post('/analyze',png(0),square,{capture_type:'surface_crop',mm_per_pixel:'1'});
const right=await post('/analyze',png(255),square,{capture_type:'surface_crop',mm_per_pixel:'1'});
assert.equal(left.status,200);assert.equal(right.status,200);
assert.deepEqual(left.value.features,right.value.features);checks++;
assert.equal(left.value.analysis_region.processed_pixel_count,64*64);
assert.ok(Math.abs(left.value.physical_measurements.area_sq_ft-4096/92903.04)<1e-10);checks++;

console.log(checks+' live API checks passed; '+d.defects.length+' review-required candidates on the provided photo. No population accuracy is implied.');
