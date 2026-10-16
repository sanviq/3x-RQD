/** Read-only / rejected-write live checks. Never assigns a test photo to a real road. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.ROAD_HEALTH_API_URL||'http://127.0.0.1:8000';
const checks=[];
function check(name,condition){checks.push({name,passed:!!condition});if(!condition)throw Error(name)}
async function json(path,init={}){const r=await fetch(base+path,{...init,signal:AbortSignal.timeout(45000)});return{status:r.status,value:await r.json()}}
const health=await json('/health');check('FastAPI responds',health.status===200);
const config=await json('/map/config');check('Real configurable HTTPS tiles with attribution',config.status===200&&config.value.tile_url.startsWith('https://')&&config.value.tile_attribution.includes('OpenStreetMap'));
const before=await json('/map/network');check('Unknown condition uses null rather than a sample grade',before.status===200&&(before.value.summary.inspected_segments>0||before.value.summary.average_quality===null&&before.value.summary.defect_count===null));
check('Length coverage denominator is mapped geometry',before.value.summary.represented_segment_length_m<=before.value.summary.mapped_length_m);
const bad=await json('/map/roads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({south:12,west:77,north:13,east:78})});check('Rejects oversized network download before contacting provider',bad.status===422);
const reversed=await json('/map/roads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({south:13,west:77,north:12,east:77.001})});check('Rejects inverted bounds',reversed.status===422);
const photo=await readFile(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url));
const form=new FormData();form.set('image',new Blob([photo],{type:'image/jpeg'}),'pothole-road.jpg');
const detected=await json('/detect-defects',{method:'POST',body:form});check('Actual uploaded-photo detector output',detected.status===200&&Array.isArray(detected.value.defects));
const score=detected.value.road_quality_score;check('Backend score is provisional, never model confidence',score?.status==='provisional'&&score.score_is_model_confidence===false);
check('Score uses the original source hash',score.image.sha256===createHash('sha256').update(photo).digest('hex'));
check('Score retains source dimensions',score.image.width===640&&score.image.height===427);
async function assignment({bytes=photo,confirmed=true,excluded='[]'}={}){const f=new FormData();f.set('image',new Blob([bytes],{type:'image/jpeg'}),'test.jpg');f.set('segment_id','nonexistent-test-segment');f.set('score_token',detected.value.score_token);f.set('latitude','13');f.set('longitude','77');f.set('location_confirmed',String(confirmed));f.set('excluded_ids',excluded);return await json('/map/inspections',{method:'POST',body:f})}
check('Requires explicit location confirmation',(await assignment({confirmed:false})).status===422);
check('Rejects a different image against the score snapshot',(await assignment({bytes:Buffer.from('different-image')})).status===409);
check('Does not invent an unknown road segment',(await assignment()).status===404);
check('Rejects malformed defect exclusions',(await assignment({excluded:'[1]'})).status===422);
const after=await json('/map/network');check('Rejected assignments preserve saved network',JSON.stringify(after.value)===JSON.stringify(before.value));
const proxy=await fetch('http://127.0.0.1:5174/api/map/config');check('Frontend /api proxy reaches real backend',proxy.status===200);
await mkdir(new URL('../.verification/',import.meta.url),{recursive:true});
await writeFile(new URL('../.verification/map-live-report.json',import.meta.url),JSON.stringify({checks,detection:{method:detected.value.method,count:detected.value.defects.length,score:score.score},notice:'Checks validate integration and evidence ownership, not population accuracy. No test inspections were persisted.'},null,2));
console.log(checks.length+' live map API checks passed. No test observation saved.');
