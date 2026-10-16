
import {useEffect,useMemo,useState} from 'react';
import {defaultPhotoSettings,photoSettings,renderRepairPhotos} from '../api/repairPhotos';
import type {RepairPhotoResult,RepairPhotoSettings,PhotoAssumptions} from '../api/repairPhotos';
import type {GrowthRates,Mark} from '../simulation/model';
import type {RoadQuad} from '../simulation/projection';
import {downloadJson} from '../utils/formatters';
interface Props {assumptions?:PhotoAssumptions;onAssumptions?:(value:PhotoAssumptions)=>void;file:File;quad:RoadQuad;marks:Mark[];months:number;growth:GrowthRates;boxGeometry?:boolean;onMonths:(n:number)=>void}
export function RepairPhotoViews(p:Props){
  const [localAssumptions,setLocalAssumptions]=useState<PhotoAssumptions>({...defaultPhotoSettings});
  const assumptions=p.assumptions??localAssumptions;
  const [result,setResult]=useState<RepairPhotoResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [revision,setRevision]=useState(0),[showMasks,setShowMasks]=useState(false);
  const settings=useMemo(()=>photoSettings(p.months,p.growth,assumptions),[p.months,p.growth,assumptions]);
  const marksKey=JSON.stringify(p.marks.map(m=>({id:m.id,kind:m.kind,polygon:m.polygon,x:m.x,y:m.y,width:m.width,length:m.length,repaired:m.repaired,severity:m.severity,visualSeverity:m.visualSeverity,provenance:m.provenance})));
  const settingsKey=JSON.stringify(settings),quadKey=JSON.stringify(p.quad);
  useEffect(()=>{
    let disposed=false;const controller=new AbortController();
    setResult(null);setError('');setBusy(true);
    const timer=window.setTimeout(()=>{
      void renderRepairPhotos(p.file,p.quad,p.marks,settings,controller.signal,p.boxGeometry).then(value=>{if(!disposed)setResult(value)})
        .catch(e=>{if(!disposed&&!controller.signal.aborted)setError((e as Error).message)})
        .finally(()=>{if(!disposed)setBusy(false)});
    },400);
    return()=>{disposed=true;clearTimeout(timer);controller.abort()};
    // Keys include every geometry and setting sent to the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[p.file,marksKey,settingsKey,quadKey,p.boxGeometry,revision]);
  const update=<K extends keyof typeof assumptions>(key:K,value:typeof assumptions[K])=>{const next={...assumptions,[key]:value};if(p.onAssumptions)p.onAssumptions(next);else setLocalAssumptions(next)};
  return <section className="repair-photo-views" aria-label="Photo repair and deterioration simulation">
    <h3>The same road · original, repaired and predicted</h3>
    <p className="input-help">These views edit your original capture without rectifying its perspective. Reviewed masks control every repair. The predicted view is a conditional visual simulation, not a guaranteed forecast.</p>
    <div className="action-row"><span className="fine-print">Photo prediction horizon</span><div className="segmented" role="group" aria-label="Photo prediction horizon">{[3,6,12].map(n=><button key={n} className={p.months===n?'active':''} aria-pressed={p.months===n} onClick={()=>p.onMonths(n)}>{n} months</button>)}</div></div>
    <div className="repair-photo-controls">
      <label className="field">Repair quality · {Math.round(assumptions.repair_quality*100)}%<input aria-label="Photo repair quality" type="range" min="0" max="1" step=".05" value={assumptions.repair_quality} onChange={e=>update('repair_quality',Number(e.target.value))}/></label>
      <label className="field">Traffic assumption<select aria-label="Photo traffic assumption" value={assumptions.traffic} onChange={e=>update('traffic',e.target.value as RepairPhotoSettings['traffic'])}><option value="light">Light traffic</option><option value="normal">Normal traffic</option><option value="heavy">Heavy traffic</option></select></label>
      <label className="field">Weather assumption<select aria-label="Photo weather assumption" value={assumptions.weather} onChange={e=>update('weather',e.target.value as RepairPhotoSettings['weather'])}><option value="dry">Mostly dry</option><option value="seasonal">Seasonal rain</option><option value="wet">Frequent rain / standing water</option><option value="freeze_thaw">Freeze–thaw exposure</option></select></label>
      <label className="field">Repair renderer<select aria-label="Photo repair renderer" value={assumptions.engine} onChange={e=>update('engine',e.target.value as RepairPhotoSettings['engine'])}><option value="auto">Prefer local Diffusers; OpenCV fallback</option><option value="opencv">OpenCV asphalt repair</option><option value="diffusers">Try local Diffusers inpainting</option></select></label>
      <label className="field">OpenCV inpainting<select aria-label="OpenCV inpainting method" value={assumptions.inpaint_method} onChange={e=>update('inpaint_method',e.target.value as 'telea'|'ns')}><option value="telea">Telea</option><option value="ns">Navier–Stokes</option></select></label>
      <label className="field">Patch decay rate / month<input aria-label="Photo patch decay rate" type="number" min="0" max=".2" step=".005" value={assumptions.patch_decay_per_month} onChange={e=>update('patch_decay_per_month',Math.min(.2,Math.max(0,Number(e.target.value)||0)))}/></label>
    </div>
    {busy&&<p role="status" className="input-help"><span className="spinner"/> Rendering masked photo views… Local diffusion can take several minutes; OpenCV usually completes in seconds.</p>}
    {error&&<div role="alert" className="request-error"><p>{error}</p><button className="button secondary small" onClick={()=>setRevision(n=>n+1)}>Retry photo rendering</button><p className="fine-print">The original capture and annotations are preserved. No duplicate images have been substituted for missing results.</p></div>}
    <div className="repair-photo-grid" aria-busy={busy}>{(['original','repaired','predicted'] as const).map(view=><figure key={view}>
      <figcaption><strong>{view==='original'?'Original · detected outlines':view==='repaired'?'Repaired · selected asphalt patches':'Predicted · '+p.months+' months'}</strong>{view==='predicted'&&<small>Conditional simulation</small>}</figcaption>
      <div className="repair-photo-stage">{result?<><img src={result.images[view]} alt={view==='original'?'Original uploaded road with detected defect outlines':view==='repaired'?'Same uploaded road with selected potholes filled with asphalt patches':'Simulated road after '+result.settings.months+' months'}/>{showMasks&&view!=='original'&&<img className="repair-mask-preview" src={result.masks[view==='repaired'?'repair':'prediction']} alt={view==='repaired'?'Repair edit mask':'Prediction edit mask'}/>}</>:<div className="repair-photo-placeholder">{busy?'Preparing '+view+' view…':'Photo view unavailable'}</div>}</div>
      {result&&<a className="text-button" href={result.images[view]} download={'road-'+view+(view==='predicted'?'-'+p.months+'-months':'')+'.png'}>Download {view} PNG</a>}
    </figure>)}</div>
    {result&&<><div className="action-row"><strong className="fine-print">{result.repair_count} selected repair region{result.repair_count===1?'':'s'} · {result.engine_used==='diffusers_inpainting'?'Stable Diffusion inpainting':'OpenCV '+(assumptions.inpaint_method==='ns'?'Navier–Stokes':'Telea')+' + asphalt texture'}</strong><label className="checkbox-row"><input type="checkbox" checked={showMasks} onChange={e=>setShowMasks(e.target.checked)}/>Show exact edit masks</label><button className="text-button" onClick={()=>downloadJson({...result,images:undefined,masks:undefined},'repair-photo-assumptions')}>Download assumptions & defect changes</button></div>
      {!result.repair_count&&<p className="field-error">No repairs selected. Select potholes in the defect list or use “Select all repairs” to produce asphalt patches.</p>}
      <details><summary>Renderer, masks and simulation assumptions</summary><ul className="fine-print">{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul><p className="fine-print">Untreated contours grow in planar road coordinates using severity, monthly footprint growth, traffic and weather. Patch degradation follows an exponential age model moderated by repair quality. These photo aging controls do not measure vehicle forces or validate the separate drive simulation. Original dimensions: {result.image.original_width} × {result.image.original_height}; rendered views: {result.image.width} × {result.image.height}.</p></details>
    </>}
  </section>;
}
