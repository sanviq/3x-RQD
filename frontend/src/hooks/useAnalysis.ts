import {detectRoadRegion} from '../api/roadRegion';
import type {RoadRegion} from '../types/api';
import {rescoreRoad} from '../api/qualityScore';
import type {RoadQualityScore} from '../api/qualityScore';
import { detectRoadDefects } from '../api/defects';
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeRoad } from '../api/roadQuality';
import type { AnalysisResponse, CaptureType, DefectDetection, RoadDetectorSettings } from '../types/api';
import { fullQuad, sceneQuad } from '../simulation/projection';
import type { RoadQuad } from '../simulation/projection';
import { inspectImage, optionalNumber } from '../utils/imageValidation';
import type { SelectedImage } from '../utils/imageValidation';
export function useAnalysis() {
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [roadRegion,setRoadRegion]=useState<RoadRegion|null>(null);
  const [regionBusy,setRegionBusy]=useState(false);
  const [regionError,setRegionError]=useState('');
  const regionController=useRef<AbortController|null>(null);
  const [roadQuad,setRoadQuad] = useState<RoadQuad>(sceneQuad);
  const [videoSource, setVideoSource] = useState<{file:File;url:string;frameTime:number}|null>(null);
  const currentVideo = useRef<{file:File;url:string;frameTime:number}|null>(null);

  const [excludedDefects,setExcludedDefects]=useState<string[]>([]);
  const [detectionResult,setDetection]=useState<DefectDetection|null>(null);
  const [detectionSource,setDetectionSource]=useState<{file:File;quad:string;revision:number}|null>(null);
  const [detectionBusy,setDetectionBusy]=useState(false);
  const [detectionError,setDetectionError]=useState('');
  const [detectionRevision,setDetectionRevision]=useState(0);
  const [detectorSettings,setDetectorSettings]=useState<RoadDetectorSettings>({mode:'opencv',confidence:.35,resolution:768});
  const detectorKey=JSON.stringify(detectorSettings);
  const quadKey=JSON.stringify(roadQuad);
  const detection=detectionSource?.file===selected?.file&&detectionSource?.quad===quadKey&&detectionSource?.revision===detectionRevision?detectionResult:null;
  useEffect(()=>{
    setDetection(null);setDetectionSource(null);setDetectionError('');setExcludedDefects([]);
    if(!selected){setDetectionBusy(false);return}
    if(regionBusy){setDetectionBusy(true);return}
    const abort=new AbortController();let cancelled=false;
    setDetectionBusy(true);
    const timer=window.setTimeout(()=>{
      detectRoadDefects(selected.file,roadQuad,abort.signal,detectorSettings).then(value=>{if(!cancelled){setDetection(value);setDetectionSource({file:selected.file,quad:JSON.stringify(roadQuad),revision:detectionRevision})}})
        .catch(error=>{if(!cancelled&&!abort.signal.aborted)setDetectionError((error as Error).message)})
        .finally(()=>{if(!cancelled)setDetectionBusy(false)});
    },250);
    return()=>{cancelled=true;window.clearTimeout(timer);abort.abort()};
  },[selected,roadQuad,detectionRevision,regionBusy,detectorSettings]);


  const [scoreRecord,setScoreRecord]=useState<{key:string;value:RoadQualityScore}|null>(null);
  const [scoreFailure,setScoreFailure]=useState<{key:string;message:string}|null>(null);
  const [scoreRevision,setScoreRevision]=useState(0);
  const excludedKey=[...excludedDefects].sort().join('\0');
  const scoreKey=(detection?.score_token??'')+'|'+excludedKey;
  const qualityScore=detection&&!detectionBusy&&scoreRecord?.key===scoreKey?scoreRecord.value:null;
  const qualityScoreError=detection&&scoreFailure?.key===scoreKey?scoreFailure.message:'';
  const qualityScoreBusy=!!selected&&!detectionError&&!qualityScoreError&&!qualityScore;
  useEffect(()=>{
    setScoreRecord(null);setScoreFailure(null);
    if(!detection||detectionBusy)return;
    const abort=new AbortController();let cancelled=false;
    if(!detection.score_token||!detection.road_quality_score){setScoreFailure({key:scoreKey,message:detection.score_error||'The backend did not return a road score. Restart the updated API, then detect again.'});return}
    if(!excludedDefects.length){setScoreRecord({key:scoreKey,value:detection.road_quality_score});return}
    const timer=window.setTimeout(()=>{
      rescoreRoad(detection.score_token!,excludedDefects,abort.signal).then(value=>{if(!cancelled)setScoreRecord({key:scoreKey,value})})
        .catch(e=>{if(!cancelled&&!abort.signal.aborted)setScoreFailure({key:scoreKey,message:(e as Error).message})});
    },180);
    return()=>{cancelled=true;window.clearTimeout(timer);abort.abort()};
    // The immutable detection snapshot and excludedKey fully identify this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[detection,detectionBusy,scoreKey,scoreRevision]);

  const [captureType, setCaptureType] = useState<CaptureType>('road_scene');
  const [scale, setScale] = useState('');
  const [scaleUncertainty,setScaleUncertainty]=useState('');
  const [pitch, setPitch] = useState('');
  const [overlay, setOverlay] = useState(true);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const automaticTimer=useRef<number|undefined>(undefined);
  const revision = useRef({value:0});
  const currentImage = useRef<SelectedImage | null>(null);
  const mounted = useRef(true);
  const invalidate = useCallback((preserveRegion=false) => {
    window.clearTimeout(automaticTimer.current);
    if(!preserveRegion){regionController.current?.abort();regionController.current=null;setRegionBusy(false);}
    revision.current.value++; controller.current?.abort(); controller.current = null;
    setBusy(false); setValidating(false); setResult(null); setErrors({}); setNotice('');
  }, []);
  useEffect(() => {
    mounted.current = true;
    const lifecycleRevision=revision.current;
    return () => {
      mounted.current = false; lifecycleRevision.value++; controller.current?.abort();regionController.current?.abort();
      if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
      if (currentVideo.current) URL.revokeObjectURL(currentVideo.current.url);
    };
  }, []);
  const locateRegion=async(image:SelectedImage,type:CaptureType)=>{
    const c=new AbortController();regionController.current=c;setRegionBusy(true);setRegionError('');setRoadRegion(null);
    try{
      const proposal=await detectRoadRegion(image.file,type,c.signal);
      if(!mounted.current||currentImage.current!==image||regionController.current!==c||c.signal.aborted)return;
      if(proposal){
        if(proposal.image.width!==image.width||proposal.image.height!==image.height)throw Error('Road outline dimensions do not match the original image. Select the road corners manually.');
        setRoadRegion(proposal);setRoadQuad(proposal.road_quad);
      }
    }catch(e){if(mounted.current&&currentImage.current===image&&regionController.current===c&&!c.signal.aborted){setRegionError((e as Error).message);setRoadQuad(fullQuad)}}
    finally{if(mounted.current&&regionController.current===c){setRegionBusy(false);regionController.current=null}}
  };
  const select = async (file: File, videoFile?: File, frameTime=0) => {
    invalidate();setRoadRegion(null);setRegionError('');
    setScale(''); setScaleUncertainty(''); setPitch(''); setRoadQuad(videoFile || captureType === 'road_scene' ? sceneQuad : fullQuad);
    if(videoFile)setCaptureType('road_scene');
    if (currentVideo.current?.file !== videoFile) {
      if (currentVideo.current) URL.revokeObjectURL(currentVideo.current.url);
      currentVideo.current = videoFile ? {file:videoFile,url:URL.createObjectURL(videoFile),frameTime} : null;
      setVideoSource(currentVideo.current);
    } else if(currentVideo.current) {
      currentVideo.current={...currentVideo.current,frameTime};setVideoSource(currentVideo.current);
    }
    if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
    currentImage.current = null; setSelected(null);
    const version = revision.current.value;
    setValidating(true);
    try {
      const image = await inspectImage(file);
      if (!mounted.current || version !== revision.current.value) { URL.revokeObjectURL(image.url); return; }
      currentImage.current = image;setRegionBusy(true);setSelected(image);
      await locateRegion(image,videoFile?'road_scene':captureType);
    } catch (error) {
      if (mounted.current && version === revision.current.value) setErrors({ image: (error as Error).message });
    } finally { if (mounted.current && version === revision.current.value) setValidating(false); }
  };
  const submit = async () => {
    window.clearTimeout(automaticTimer.current);
    if (controller.current || busy || validating || regionBusy) return;
    const parsedScale = optionalNumber(scale, 'scale');
    const parsedPitch = optionalNumber(pitch, 'pitch');
    const nextErrors: Record<string, string> = {};
    if (!selected) nextErrors.image = 'Choose a road-surface image first.';
    if (parsedScale.error) nextErrors.scale = parsedScale.error;
    if (parsedPitch.error) nextErrors.pitch = parsedPitch.error;
    const uncertainty=scaleUncertainty.trim()?Number(scaleUncertainty):undefined;
    if(uncertainty!==undefined&&(!Number.isFinite(uncertainty)||uncertainty<0||uncertainty>=100||parsedScale.value===undefined))nextErrors.scaleUncertainty='Provide a scale and uncertainty from 0% to less than 100%.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !selected) return;
    const version = ++revision.current.value;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true); setResult(null); setNotice('');
    try {
      const response = await analyzeRoad({ image: selected.file, captureType, roadQuad, mmPerPixel: captureType === 'surface_crop' ? parsedScale.value : undefined, scaleUncertaintyPercent:captureType==='surface_crop'?uncertainty:undefined, pitchDegrees: parsedPitch.value, includeOverlay: overlay, detectorSettings }, requestController.signal);
      if (mounted.current && version === revision.current.value) { setResult(response); setNotice('Analysis complete. Results are ready.'); }
    } catch (error) {
      if (mounted.current && version === revision.current.value && !requestController.signal.aborted) setErrors({ request: (error as Error).message });
    } finally { if (mounted.current && version === revision.current.value) { setBusy(false); controller.current = null; } }
  };
  // Upload and road-footprint changes run the complete API analysis, including
  // real aggregate candidates and an overlay. Calibration edits also refresh the current result.
  useEffect(()=>{
    if(!selected||regionBusy)return;
    automaticTimer.current=window.setTimeout(()=>{void submit()},650);
    return()=>window.clearTimeout(automaticTimer.current);
    // submit reads the settings from the render that selected this footprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected,roadQuad,regionBusy,captureType,scale,scaleUncertainty,pitch,overlay,detectorSettings]);
  const updateRoadQuad=(value:RoadQuad)=>{invalidate();setRoadRegion(null);setRegionError('');setRoadQuad(value)};
  const reset = () => {
    invalidate();setRoadRegion(null);setRegionError('');
    if (currentVideo.current) URL.revokeObjectURL(currentVideo.current.url);
    currentVideo.current = null; setVideoSource(null); setCaptureType('road_scene'); setRoadQuad(sceneQuad);
    if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
    currentImage.current = null; setSelected(null); setScale(''); setScaleUncertainty(''); setPitch(''); setOverlay(true);
  };
  return {
    detectorSettings,setDetectorSettings:(value:RoadDetectorSettings)=>{if(JSON.stringify(value)!==detectorKey){invalidate(true);setDetection(null);setDetectionSource(null);setExcludedDefects([]);setDetectorSettings(value)}},
    roadRegion,regionBusy,regionError,retryRoadRegion:()=>{if(selected){invalidate();void locateRegion(selected,captureType)}},
    qualityScore,qualityScoreBusy,qualityScoreError,retryQualityScore:()=>setScoreRevision(n=>n+1),
    excludedDefects,toggleDefect:(id:string)=>setExcludedDefects(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]),
    detection,detectionBusy,detectionError,retryDetection:()=>setDetectionRevision(n=>n+1),
    selected, videoSource, roadQuad, setRoadQuad:updateRoadQuad, captureType, setCaptureType: (value:CaptureType) => { invalidate();setRoadRegion(null);setRegionError('');setCaptureType(value);setRoadQuad(fullQuad);setScale('');setScaleUncertainty('');if(selected)void locateRegion(selected,value); }, scale, pitch, overlay, result, busy, validating, errors, notice, select, submit, reset,
    setScale: (value: string) => { invalidate(true); setScale(value); },
    scaleUncertainty,setScaleUncertainty:(value:string)=>{invalidate(true);setScaleUncertainty(value)},
    setPitch: (value: string) => { invalidate(true); setPitch(value); },
    setOverlay: (value: boolean) => { invalidate(true); setOverlay(value); },
    cancel: () => { invalidate(); setNotice('Request cancelled. Server computation may still finish.'); },
  };
}
export type AnalysisController = ReturnType<typeof useAnalysis>;
