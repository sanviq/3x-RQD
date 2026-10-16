import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
const base=process.env.ROAD_HEALTH_API_URL??'http://127.0.0.1:8000';
const photo=await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
let checks=0;
async function upload(bytes=photo,quad){const form=new FormData();form.append('image',new Blob([bytes]),'source.jpg');if(quad)form.append('road_quad',JSON.stringify(quad));const r=await fetch(base+'/detect-defects',{method:'POST',body:form});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.ok(d.road_quality_score,d.score_error);return d}
async function rescore(token,excluded=[],config){const r=await fetch(base+'/road-quality-score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score_token:token,excluded_ids:excluded,...(config?{config}:{})})});return {status:r.status,value:await r.json()}}
function verify(s){
 assert.equal(s.status,'provisional');assert.equal(s.validated,false);assert.equal(s.score_is_model_confidence,false);assert.ok(Number.isFinite(s.score)&&s.score>=0&&s.score<=100);
 const total=s.components.reduce((v,c)=>v+c.points,0);assert.ok(Math.abs(total-s.deduction_points)<.0001);assert.ok(Math.abs(s.score-Math.max(0,Math.min(100,100-total)))<=.051);
 assert.ok(Math.abs(s.defects.reduce((v,d)=>v+d.deduction_points,0)-s.deduction_points)<.001);
 assert.equal(s.cells.reduce((v,c)=>v+c.road_pixels,0),s.summary.visible_road_pixel_area);
 assert.equal(s.defects.reduce((v,d)=>v+d.owned_pixel_area,0),s.summary.unique_penalized_pixels);
 assert.ok(s.summary.affected_pixel_area<=s.summary.visible_road_pixel_area);assert.equal(s.summary.included_count+s.summary.excluded_count,s.summary.detected_count);
 assert.equal(s.validation.available,false);assert.equal(s.validation.mae,null);assert.equal(s.validation.pearson_r,null);
 assert.ok(s.defects.every(d=>d.confidence>=0&&d.confidence<=1&&d.severity>=0&&d.severity<=1));
 checks++;
}
const d=await upload();const initial=d.road_quality_score;verify(initial);assert.ok(d.defects.length>0);assert.equal(initial.image.sha256,hash(photo));assert.deepEqual([initial.image.width,initial.image.height],[640,427]);checks++;
const replay=await rescore(d.score_token);assert.equal(replay.status,200);verify(replay.value);assert.equal(replay.value.score,initial.score);checks++;
const largest=[...initial.defects].sort((a,b)=>b.deduction_points-a.deduction_points)[0].id;
const removed=(await rescore(d.score_token,[largest])).value;verify(removed);assert.ok(removed.score>=initial.score);assert.equal(removed.summary.included_count,initial.summary.included_count-1);assert.ok(removed.summary.affected_pixel_area<=initial.summary.affected_pixel_area);checks++;
const all=(await rescore(d.score_token,d.defects.map(d=>d.id))).value;verify(all);assert.equal(all.score,100);assert.equal(all.summary.affected_pixel_area,0);assert.equal(all.summary.included_count,0);assert.ok(all.uncertainty.some(s=>s.includes('not proof')));checks++;
const restored=(await rescore(d.score_token,[])).value;verify(restored);assert.equal(restored.score,initial.score);checks++;
const lessEvidence=(await rescore(d.score_token,[],{...initial.config,confidence_power:4})).value;verify(lessEvidence);assert.ok(lessEvidence.score>=initial.score);checks++;
const moreEvidence=(await rescore(d.score_token,[],{...initial.config,confidence_power:1})).value;verify(moreEvidence);assert.ok(moreEvidence.score<=initial.score);checks++;
const noPenalty=(await rescore(d.score_token,[],{...initial.config,opencv_discount:0,model_discount:0})).value;verify(noPenalty);assert.equal(noPenalty.score,100);assert.equal(noPenalty.summary.included_count,initial.summary.included_count);assert.equal(noPenalty.config_source,'request_override');checks++;
const frozen=(await rescore(d.score_token,[])).value;assert.equal(frozen.score,initial.score);assert.equal(frozen.config_sha256,initial.config_sha256);checks++;
assert.equal((await rescore(d.score_token,['does-not-exist'])).status,422);checks++;
assert.equal((await rescore(d.score_token,[largest,largest])).status,422);checks++;
assert.equal((await rescore(d.score_token,[],{...initial.config,area_cap:100,hotspot_cap:100})).status,422);checks++;
assert.equal((await rescore('missing-snapshot-token-1234567890')).status,410);checks++;
const injected=await fetch(base+'/road-quality-score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score_token:d.score_token,excluded_ids:[],defects:[]})});assert.equal(injected.status,422);checks++;
const smooth=await upload(await readFile(new URL('../../tests/fixtures/smooth-road.png',import.meta.url)));verify(smooth.road_quality_score);assert.equal(smooth.defects.length,0);assert.equal(smooth.road_quality_score.score,100);assert.equal(smooth.road_quality_score.status,'provisional');checks++;
const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1}return (c^0xffffffff)>>>0};
const chunk=(name,bytes)=>{const type=Buffer.from(name),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,bytes])),bytes.length+8);return out};
const width=1739,height=1081,raw=Buffer.alloc(height*(width*3+1));
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dark=((x-900)/120)**2+((y-740)/65)**2<1;const v=dark?35:95+((x*13+y*17)%12);for(let c=0;c<3;c++)raw[y*(width*3+1)+1+x*3+c]=v}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
const native=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);

const nativeDetection=await upload(native);verify(nativeDetection.road_quality_score);assert.deepEqual([nativeDetection.road_quality_score.image.width,nativeDetection.road_quality_score.image.height],[width,height]);assert.equal(nativeDetection.road_quality_score.summary.visible_road_pixel_area,width*height);assert.equal(nativeDetection.road_quality_score.image.sha256,hash(native));checks++;
// EXIF-oriented portrait: native dimensions must follow the orientation, never stretch.
const original=await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url));
const exif=Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000','hex'),marker=Buffer.alloc(4);marker[0]=255;marker[1]=225;marker.writeUInt16BE(exif.length+2,2);
const portrait=await upload(Buffer.concat([original.subarray(0,2),marker,exif,original.subarray(2)]));verify(portrait.road_quality_score);assert.deepEqual([portrait.road_quality_score.image.width,portrait.road_quality_score.image.height],[427,640]);checks++;
assert.equal(hash(photo),hash(await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))));checks++;
await mkdir(new URL('../.verification/',import.meta.url),{recursive:true});await writeFile(new URL('../.verification/quality-score-live-report.json',import.meta.url),JSON.stringify({checks,source:initial.image,initial_score:initial.score,rating:initial.rating,excluded_candidate:largest,after_exclusion:removed.score,components:initial.components,expert_validation:{available:false,mae:null,pearson_r:null},notice:'API/geometry contract checks, not accuracy validation. No expert road-condition scores are available.'},null,2));
console.log(checks+' live provisional-score checks passed. Initial source score '+initial.score+' ('+initial.rating+', provisional); MAE/correlation unavailable.');
