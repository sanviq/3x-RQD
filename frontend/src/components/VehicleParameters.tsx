import {suspensionFor,suspensionLimits,vehicle,clamp} from '../simulation/model';
import type {RoadConfig,SuspensionParameters} from '../simulation/model';
const fields:[keyof SuspensionParameters,string,string][]=[['sprungMass','Sprung mass per wheel','kg'],['unsprungMass','Unsprung mass per wheel','kg'],['spring','Suspension spring stiffness','N/m'],['damping','Suspension damping','N·s/m'],['tire','Tire vertical stiffness','N/m']];
export function VehicleParameters({config,onChange}:{config:RoadConfig;onChange:(c:RoadConfig)=>void}){
 const values=suspensionFor(config);
 return <details className="vehicle-parameters"><summary>Vehicle model parameters</summary><p className="fine-print">Enter traceable vehicle or test-bench values when available. Editing parameters changes the shared renderer, tire preload, live drive and batch comparison. Inputs remain unverified; these are four independent quarter-car models, not validated full-vehicle dynamics.</p>
 {fields.map(([key,label,unit])=><label className="field" key={key}>{label} · {unit}<input aria-label={label} type="number" min={suspensionLimits[key][0]} max={suspensionLimits[key][1]} step={key==='spring'||key==='tire'?1000:10} value={values[key]} onChange={e=>{const value=Number(e.target.value);onChange({...config,suspension:{...values,[key]:clamp(Number.isFinite(value)?value:vehicle[key],...suspensionLimits[key])}})}}/></label>)}
 <label className="field">Vehicle parameter source / test reference<input aria-label="Vehicle parameter reference" maxLength={200} value={config.vehicleReference??''} placeholder="Optional vehicle specification or test ID" onChange={e=>onChange({...config,vehicleReference:e.target.value})}/></label>
 <p className="fine-print">{config.vehicleReference?'User-supplied reference; independent validation pending.':'Default assumptions; no measured vehicle data supplied.'} Wheelbase 2.6 m, track 1.5 m and tire radius 345 mm remain fixed assumptions. Integration: 240 Hz. No friction, braking or safe-speed prediction.</p>
 <button className="text-button" onClick={()=>onChange({...config,suspension:undefined,vehicleReference:undefined})}>Restore default vehicle assumptions</button></details>;
}
