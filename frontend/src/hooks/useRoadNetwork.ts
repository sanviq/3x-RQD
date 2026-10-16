
import {useRef,useState} from 'react';
import type {AnalysisResponse} from '../types/api';
import {parseNetwork} from '../network/graph';
import type {RoadLink} from '../network/graph';
export interface InspectionRecord {name:string;capturedAt:string;result:AnalysisResponse;excludedCandidates:string[]}
export function useRoadNetwork(){
  const [links,setLinks]=useState<RoadLink[]>([]);
  const [records,setRecords]=useState<Record<string,InspectionRecord>>({});
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const revision=useRef(0);
  const importFile=async(file:File)=>{
    const request=++revision.current;
    try{
      if(file.size>4*1024*1024)throw Error('GeoJSON must be smaller than 4 MiB.');
      const next=parseNetwork(JSON.parse(await file.text()));
      if(request!==revision.current)return;
      setLinks(next);setRecords({});setSelected(next[0].id);setError('');
    }catch(e){if(request!==revision.current)return;setError((e as Error).message)}
  };
  return {links,records,selected,setSelected,error,importFile,
    attach:(name:string,result:AnalysisResponse,excludedCandidates:string[])=>setRecords(old=>({...old,[selected]:{name,capturedAt:new Date().toISOString(),result,excludedCandidates:[...excludedCandidates]}}))};
}
export type NetworkController=ReturnType<typeof useRoadNetwork>;
