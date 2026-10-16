import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const scratch=join(root,'.verification');
await mkdir(scratch,{recursive:true});
for(const name of ['types/api','api/client','api/defects','api/roadQuality']){
let code=stripTypeScriptTypes(await readFile(join(root,'src',name+'.ts'),'utf8'),{mode:'transform'});
code=code.replaceAll("'../types/api'","'../types/api.mjs'").replaceAll("'./client'","'./client.mjs'").replaceAll("'./defects'","'./defects.mjs'").replace('import.meta.env.VITE_API_BASE_URL',"({VITE_API_BASE_URL:'/api'}).VITE_API_BASE_URL");
const dest=join(scratch,name+'.mjs');await mkdir(dirname(dest),{recursive:true});await writeFile(dest,code);
}
const {analyzeRoad,getHealth,isAnalysisResponse}=await import(pathToFileURL(join(scratch,'api/roadQuality.mjs')).href);
const {demoResult}=await import(pathToFileURL(join(root,'src/data/demo.ts')).href);
globalThis.window=globalThis;
let checks=0;
assert.ok(isAnalysisResponse(demoResult));checks++;
assert.ok(!isAnalysisResponse({features:{}}));checks++;
assert.ok(!isAnalysisResponse({...demoResult,features:{...demoResult.features,boundary_contrast:Infinity}}));checks++;
globalThis.fetch=async(url,init)=>{assert.equal(url,'/api/analyze');assert.deepEqual([...init.body.keys()].sort(),['capture_type','image','include_overlay','pitch_degrees']);assert.equal(init.body.get('pitch_degrees'),'0');assert.equal(init.body.get('include_overlay'),'false');assert.equal(init.headers,undefined);return Response.json(demoResult)};
await analyzeRoad({image:new File(['x'],'road.png',{type:'image/png'}),pitchDegrees:0,includeOverlay:false});checks++;
globalThis.fetch=async()=>Response.json({status:'ok',model_loaded:false,feature_version:'surface-v1'});assert.equal((await getHealth()).model_loaded,false);checks++;
globalThis.fetch=async()=>Response.json({detail:[{loc:['body','mm_per_pixel'],msg:'Too small',type:'value_error'}]},{status:422});await assert.rejects(getHealth(),/mm_per_pixel: Too small/);checks++;
globalThis.fetch=async()=>new Response('<html>private stack trace</html>',{status:502});await assert.rejects(getHealth(),/service encountered an error/);checks++;
globalThis.fetch=async()=>{throw new TypeError('Network error')};await assert.rejects(getHealth(),/could not be reached/);checks++;
console.log(checks+' additional API contract and error checks passed using Node-transformed source.');
