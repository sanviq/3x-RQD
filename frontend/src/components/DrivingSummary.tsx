import type {DriveResult,Mark,Scenario} from '../simulation/model';
export function DrivingSummary({runs,marks}:{runs:Partial<Record<Scenario,DriveResult>>;marks:Mark[]}){
 const before=runs.Original,after=runs.Repaired;
 if(!before||!after)return <p className="input-help">Record both Original and Repaired drives to see a matched improvement summary.</p>;
 const matched=before.speed===after.speed&&Math.abs(before.distance-after.distance)<1e-6&&Math.abs(before.seconds-after.seconds)<1e-6;
 if(!matched)return <p className="field-error">These runs use different conditions. Repeat the matched comparison before interpreting a repair benefit.</p>;
 const improvement=before.rms>1e-9?(before.rms-after.rms)/before.rms*100:null;
 return <><div className="simulation-gains"><div><span>Simulated RMS change after repairs</span><strong>{improvement==null?'No baseline vibration':(improvement>=0?'-':'+')+Math.abs(improvement).toFixed(1)+'%'}</strong></div><div><span>Selected repairs / remaining annotations</span><strong>{marks.filter(m=>m.repaired).length} / {marks.filter(m=>!m.repaired).length}</strong></div><div><span>Matched route and vehicle</span><strong>{before.speed} km/h</strong><span>{before.distance.toFixed(1)} m · {before.seconds.toFixed(2)} s</span></div></div><p className="fine-print">This quantifies the simulated response under the same path, speed, vehicle and depth assumptions. Some repairs can alter excitation without improving RMS. It is not measured ride comfort, IRI, a road grade or a safe-speed recommendation.</p></>;
}
