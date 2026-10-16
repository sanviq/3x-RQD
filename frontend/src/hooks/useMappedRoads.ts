import {useCallback,useEffect,useRef,useState} from 'react';
import {getMapConfig,getMappedNetwork,fetchMappedRoads,attachMapInspection} from '../api/map';
import type {MapConfig,MapNetwork,MapBounds} from '../api/map';
import type {AnalysisController} from './useAnalysis';
export function useMappedRoads(){
 const [config,setConfig]=useState<MapConfig|null>(null),[network,setNetwork]=useState<MapNetwork|null>(null);
 const [selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const controller=useRef<AbortController|null>(null),generation=useRef({value:0}),mounted=useRef(true);
 const apply=useCallback((v:MapNetwork)=>{setNetwork(v);setSelected(old=>v.segments.some(s=>s.id===old)?old:v.segments.find(s=>s.inspection)?.id??v.segments[0]?.id??'')},[]);
 const refresh=useCallback(async()=>{
  controller.current?.abort();const c=new AbortController();controller.current=c;const revision=++generation.current.value;setBusy(true);setError('');
  const values=await Promise.allSettled([getMapConfig(c.signal),getMappedNetwork(c.signal)]);
  if(!mounted.current||revision!==generation.current.value)return;
  if(values[0].status==='fulfilled')setConfig(values[0].value);
  if(values[1].status==='fulfilled')apply(values[1].value);
  setError(values.filter(x=>x.status==='rejected').map(x=>(x as PromiseRejectedResult).reason.message).join(' '));setBusy(false);
 },[apply]);
 useEffect(()=>{const lifecycle=generation.current;mounted.current=true;void refresh();return()=>{mounted.current=false;lifecycle.value++;controller.current?.abort()}},[refresh]);
 const load=useCallback(async(bounds:MapBounds)=>{
  controller.current?.abort();const c=new AbortController();controller.current=c;const revision=++generation.current.value;setBusy(true);setError('');
  try{const v=await fetchMappedRoads(bounds,c.signal);if(mounted.current&&revision===generation.current.value)apply(v)}catch(e){if(mounted.current&&revision===generation.current.value&&!c.signal.aborted)setError((e as Error).message)}finally{if(mounted.current&&revision===generation.current.value)setBusy(false)}
 },[apply]);
 const attach=async(analysis:AnalysisController,coordinates:[number,number],confirmed:boolean,reviewed:boolean)=>{
  if(saving)return false;setSaving(true);setSaveError('');
  try{const v=await attachMapInspection(selected,analysis,coordinates,confirmed,reviewed);if(mounted.current){apply(v);setError('')}return true}catch(e){if(mounted.current)setSaveError((e as Error).message);return false}finally{if(mounted.current)setSaving(false)}
 };
 return {config,network,selected,setSelected,error,busy,refresh,load,attach,saving,saveError};
}
export type MappedRoadsController=ReturnType<typeof useMappedRoads>;
