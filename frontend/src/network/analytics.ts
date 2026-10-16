import type {MappedSegment} from '../api/map';
export const scoreTone=(score:number|null|undefined)=>score==null?'unknown':score>=75?'good':score>=55?'fair':'poor';
export const scoreColor=(score:number|null|undefined)=>score==null?'#858b88':score>=90?'#4d7665':score>=75?'#7b9261':score>=55?'#bf9344':score>=35?'#bb6954':'#8d3f48';
export function repairPriorities(segments:MappedSegment[]){
 return segments.filter(s=>s.inspection&&s.inspection.score.summary.included_count>0).sort((a,b)=>a.inspection!.score.score-b.inspection!.score.score||b.inspection!.score.summary.by_severity.High-a.inspection!.score.summary.by_severity.High);
}
export const inspectionDate=(date:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(date));
export function initialRoadBounds(center:[number,number]){return{south:center[0]-.006,west:center[1]-.006,north:center[0]+.006,east:center[1]+.006}}
