import { detectRoadDefects } from '../api/defects';
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeRoad } from '../api/roadQuality';
import type { AnalysisResponse, CaptureType, DefectDetection } from '../types/api';
import { fullQuad, sceneQuad } from '../simulation/projection';
import type { RoadQuad } from '../simulation/projection';
import { inspectImage, optionalNumber } from '../utils/imageValidation';
import type { SelectedImage } from '../utils/imageValidation';
export function useAnalysis() {
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [roadQuad,setRoadQuad] = useState<RoadQuad>(sceneQuad);
  const [videoSource, setVideoSource] = useState<{file:File;url:string;frameTime:number}|null>(null);
  const currentVideo = useRef<{file:File;url:string;frameTime:number}|null>(null);

  const [excludedDefects,setExcludedDefects]=useState<string[]>([]);
  const [detection,setDetection]=useState<DefectDetection|null>(null);
  const [detectionBusy,setDetectionBusy]=useState(false);
  const [detectionError,setDetectionError]=useState('');
  const [detectionRevision,setDetectionRevision]=useState(0);
  useEffect(()=>{
    setDetection(null);setDetectionError('');setExcludedDefects([]);
    if(!selected){setDetectionBusy(false);return}
    const abort=new AbortController();let cancelled=false;
    setDetectionBusy(true);
    const timer=window.setTimeout(()=>{
      detectRoadDefects(selected.file,roadQuad,abort.signal).then(value=>{if(!cancelled)setDetection(value)})
        .catch(error=>{if(!cancelled&&!abort.signal.aborted)setDetectionError((error as Error).message)})
        .finally(()=>{if(!cancelled)setDetectionBusy(false)});
    },250);
    return()=>{cancelled=true;window.clearTimeout(timer);abort.abort()};
  },[selected,roadQuad,detectionRevision]);

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
  const invalidate = useCallback(() => {
    window.clearTimeout(automaticTimer.current);
    revision.current.value++; controller.current?.abort(); controller.current = null;
    setBusy(false); setValidating(false); setResult(null); setErrors({}); setNotice('');
  }, []);
  useEffect(() => {
    mounted.current = true;
    const lifecycleRevision=revision.current;
    return () => {
      mounted.current = false; lifecycleRevision.value++; controller.current?.abort();
      if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
      if (currentVideo.current) URL.revokeObjectURL(currentVideo.current.url);
    };
  }, []);
  const select = async (file: File, videoFile?: File, frameTime=0) => {
    invalidate();
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
      currentImage.current = image; setSelected(image);
    } catch (error) {
      if (mounted.current && version === revision.current.value) setErrors({ image: (error as Error).message });
    } finally { if (mounted.current && version === revision.current.value) setValidating(false); }
  };
  const submit = async () => {
    window.clearTimeout(automaticTimer.current);
    if (controller.current || busy || validating) return;
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
      const response = await analyzeRoad({ image: selected.file, captureType, roadQuad, mmPerPixel: captureType === 'surface_crop' ? parsedScale.value : undefined, scaleUncertaintyPercent:captureType==='surface_crop'?uncertainty:undefined, pitchDegrees: parsedPitch.value, includeOverlay: overlay }, requestController.signal);
      if (mounted.current && version === revision.current.value) { setResult(response); setNotice('Analysis complete. Results are ready.'); }
    } catch (error) {
      if (mounted.current && version === revision.current.value && !requestController.signal.aborted) setErrors({ request: (error as Error).message });
    } finally { if (mounted.current && version === revision.current.value) { setBusy(false); controller.current = null; } }
  };
  // Upload and road-footprint changes run the complete API analysis, including
  // real aggregate candidates and an overlay; calibration edits remain explicit.
  useEffect(()=>{
    if(!selected)return;
    automaticTimer.current=window.setTimeout(()=>{void submit()},650);
    return()=>window.clearTimeout(automaticTimer.current);
    // submit reads the settings from the render that selected this footprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected,roadQuad]);
  const updateRoadQuad=(value:RoadQuad)=>{invalidate();setRoadQuad(value)};
  const reset = () => {
    invalidate();
    if (currentVideo.current) URL.revokeObjectURL(currentVideo.current.url);
    currentVideo.current = null; setVideoSource(null); setCaptureType('road_scene'); setRoadQuad(sceneQuad);
    if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
    currentImage.current = null; setSelected(null); setScale(''); setScaleUncertainty(''); setPitch(''); setOverlay(true);
  };
  return {
    excludedDefects,toggleDefect:(id:string)=>setExcludedDefects(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]),
    detection,detectionBusy,detectionError,retryDetection:()=>setDetectionRevision(n=>n+1),
    selected, videoSource, roadQuad, setRoadQuad:updateRoadQuad, captureType, setCaptureType: (value:CaptureType) => { invalidate(); setCaptureType(value); setRoadQuad(value === 'surface_crop' ? fullQuad : sceneQuad); setScale(''); setScaleUncertainty(''); }, scale, pitch, overlay, result, busy, validating, errors, notice, select, submit, reset,
    setScale: (value: string) => { invalidate(); setScale(value); },
    scaleUncertainty,setScaleUncertainty:(value:string)=>{invalidate();setScaleUncertainty(value)},
    setPitch: (value: string) => { invalidate(); setPitch(value); },
    setOverlay: (value: boolean) => { invalidate(); setOverlay(value); },
    cancel: () => { invalidate(); setNotice('Request cancelled. Server computation may still finish.'); },
  };
}
export type AnalysisController = ReturnType<typeof useAnalysis>;
