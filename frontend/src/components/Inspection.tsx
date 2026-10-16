import {InspectionRegion} from './InspectionRegion';
import {RoadQualityCard} from './RoadQualityCard';
import { DefectReview } from './DefectReview';
import { CountryComparison } from './CountryComparison';
import { ScaleReference } from './ScaleReference';
import { useRef, useState } from 'react';
import { DetectionWorkspace } from './DetectionWorkspace';
import type { AnalysisController } from '../hooks/useAnalysis';
import { Icon } from './Icon';
import { UploadDrivePreview } from './UploadDrivePreview';
import type { CaptureType } from '../types/api';
import { MediaCapture } from './MediaCapture';
import { AnalysisResults } from './AnalysisResults';
import { SurfaceArt } from './SurfaceArt';
import { Badge, EmptyState, Note, PanelTitle } from './UI';
import { demoResult } from '../data/demo';
import { downloadJson } from '../utils/formatters';
export function Inspection({analysis,onSimulate}:{analysis:AnalysisController;onSimulate:()=>void}) {
  const [sample,setSample]=useState(false);
  const [source,setSource]=useState<'image'|'video'|'camera'>('image');
  const [view,setView]=useState('original');
  const [dragging,setDragging]=useState(false);
  const [dropError,setDropError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const result=sample?demoResult:analysis.result;
  const select=(file:File,videoFile?:File,frameTime=0)=>{setDropError('');setSample(false);setView('original');void analysis.select(file,videoFile,frameTime)};
  const edit=()=>{setSample(false);setView('original')};
  const reset=()=>{analysis.reset();setSample(false);setView('original');if(input.current)input.current.value=''};
  return <div className="page-enter">
    <div className="page-heading"><div><p className="eyebrow">SURFACE INSPECTION</p><h1>Surface inspection<span className="heading-dot">.</span></h1><p>Upload a road image for automatic defect, texture and aggregate-candidate analysis.</p></div>{import.meta.env.VITE_ENABLE_DEMOS==='true'&&<button className="button secondary" onClick={()=>{analysis.reset();setSample(true);setView('original')}}><Icon name="flask" size={16}/>Explore a sample</button>}</div>
    {analysis.selected?.file.name.startsWith('synthetic-')&&<Note tone="warning">This is a synthetic capture. Its results do not describe a real road.</Note>}
    {analysis.selected&&<div className="workspace-note"><span><Icon name="car" size={17}/>Drive this road</span><p>Your preview is ready below. Align the visible road and compare driving, repairs and weather in the lab.</p><button className="button secondary small" onClick={onSimulate}>Simulate uploaded road<Icon name="arrow" size={15}/></button></div>}
    <div className="inspection-layout">
      <div className="input-column">
        <section className="panel upload-panel"><PanelTitle title="Add a road capture" eyebrow="01 / INPUT"/><div className="segmented source-tabs" role="group" aria-label="Capture source">{([['image','Image','image'],['video','Video','video'],['camera','Live camera','camera']] as const).map(([id,label,icon])=><button key={id} className={source===id?'active':''} aria-pressed={source===id} onClick={()=>setSource(id)}><Icon name={icon} size={15}/>{label}</button>)}</div>
          {source==='image'?<div className={'dropzone '+(dragging?'dragging':'')+(analysis.errors.image?' invalid':'')} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length!==1){setDropError('Drop one image at a time.');return}select(e.dataTransfer.files[0])}}>
            <span className="upload-symbol"><Icon name="upload" size={25}/></span><h3>{analysis.validating?'Checking your image…':'Drop your road image here'}</h3><p>or choose a file from your device</p><label className="button secondary file-button">Browse files<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="image-help image-error" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)select(file)}}/></label><small id="image-help">JPEG, PNG, WebP · up to 12 MiB<br/>64 px minimum per side · 20 MP maximum</small>
          </div>:<MediaCapture key={source} kind={source} onCapture={select}/>}
          {(analysis.errors.image||dropError)&&<p id="image-error" role="alert" className="field-error">{analysis.errors.image||dropError}</p>}
          {analysis.selected&&<div className="selected-file"><Icon name="image" size={20}/><div><strong>{analysis.selected.file.name}</strong><small>{analysis.selected.width} × {analysis.selected.height} px · {(analysis.selected.file.size/1048576).toFixed(2)} MiB</small></div><button className="icon-button" aria-label="Remove selected image" onClick={reset}><Icon name="close" size={16}/></button></div>}
        </section>
        <section className="panel calibration-panel"><PanelTitle title="Capture type & measurements" eyebrow="02 / ANALYSIS SETTINGS"/><label className="field" htmlFor="capture-type">What does this capture show?</label><select id="capture-type" className="sim-select" value={analysis.captureType} onChange={e=>{edit();analysis.setCaptureType(e.target.value as CaptureType)}}><option value="road_scene">Road scene / perspective photo</option><option value="surface_crop">Road-only, rectified surface close-up</option></select><p className="input-help">Pixel density, diameter and boundary-gap estimates are reported when visible candidates can be resolved. Millimetres require a road-only crop with uniform scale. The provisional road score uses defect regions, not chip count alone.</p><label className="field" htmlFor="scale">Scale <span>mm per original-image pixel</span></label><input id="scale" disabled={analysis.captureType!=='surface_crop'} type="number" inputMode="decimal" min="0" max="1000" step="any" placeholder="e.g. 0.5" value={analysis.scale} aria-invalid={!!analysis.errors.scale} aria-describedby="scale-help scale-error" onChange={e=>{edit();analysis.setScale(e.target.value)}}/>
          {analysis.errors.scale&&<p id="scale-error" className="field-error">{analysis.errors.scale}</p>}
          <p id="scale-help" className="input-help">A 100 mm reference spanning 200 pixels gives 0.5 mm/pixel. Use an already top-down or rectified image with uniform scale, measured in original pixels after EXIF orientation.</p>
          <ScaleReference key={analysis.selected?.url??'empty'} image={analysis.selected} disabled={analysis.captureType!=='surface_crop'} onApply={analysis.setScale}/>
          <label className="field" htmlFor="scale-uncertainty">Scale uncertainty <span>± percent · optional</span></label><input id="scale-uncertainty" disabled={analysis.captureType!=='surface_crop'} type="number" min="0" max="99.99" step="any" value={analysis.scaleUncertainty} placeholder="e.g. 5" onChange={e=>analysis.setScaleUncertainty(e.target.value)}/><p className="input-help">Use your reference measurement's uncertainty. Blank means unknown. This bounds scale effects; it does not establish segmentation accuracy.</p>{analysis.errors.scaleUncertainty&&<p className="field-error" role="alert">{analysis.errors.scaleUncertainty}</p>}
          <label className="field" htmlFor="pitch">Measured sensor pitch <span>degrees</span></label><input id="pitch" type="number" inputMode="decimal" min="-90" max="90" step="any" placeholder="−90 to 90 · optional" value={analysis.pitch} aria-invalid={!!analysis.errors.pitch} aria-describedby="pitch-help pitch-error" onChange={e=>{edit();analysis.setPitch(e.target.value)}}/>
          {analysis.errors.pitch&&<p id="pitch-error" className="field-error">{analysis.errors.pitch}</p>}<p id="pitch-help" className="input-help">Enter an IMU measurement if available. Zero is valid. Pitch is not inferred from the image.</p>
          <label className="checkbox-row"><input type="checkbox" checked={analysis.overlay} onChange={e=>{edit();analysis.setOverlay(e.target.checked)}}/><span>Include diagnostic overlay<small>Chip candidates and potential dark linear regions</small></span></label>
          <div className="analysis-actions"><button className="button primary full-width" disabled={analysis.busy||analysis.validating||analysis.regionBusy} onClick={()=>{setSample(false);void analysis.submit()}}>{analysis.regionBusy?<><span className="spinner"/>Finding road region…</>:analysis.busy?<><span className="spinner"/>Analyzing surface…</>:<>Analyze surface<Icon name="arrow" size={17}/></>}</button><button className="text-button" onClick={analysis.busy?analysis.cancel:reset}>{analysis.busy?'Cancel request':'Reset inputs'}</button></div>
          <div className="sr-only" role="status" aria-live="polite">{analysis.busy?'Analyzing image. This may take a moment.':analysis.notice}</div>
          {analysis.notice&&<p className="input-help" role="status">{analysis.notice}</p>}
          {analysis.errors.request&&<div className="request-error" role="alert"><p>{analysis.errors.request}</p><button className="text-button" onClick={()=>void analysis.submit()}>Retry analysis<Icon name="refresh" size={14}/></button></div>}
          <p className="privacy-caption"><Icon name="info" size={14}/>Uploads remain in this session. Evidence is saved locally only when you explicitly link an inspection to a mapped road.</p>
        </section>
      </div>
      <div className="output-column">
        <InspectionRegion analysis={analysis}/>
        {analysis.selected&&<RoadQualityCard score={analysis.qualityScore} busy={analysis.qualityScoreBusy} error={analysis.detectionError||analysis.qualityScoreError} onRefresh={analysis.retryDetection}/>}
        {analysis.selected&&<><DefectReview url={analysis.selected.url} detection={analysis.detection} busy={analysis.detectionBusy} error={analysis.detectionError} excluded={analysis.excludedDefects} onToggle={analysis.toggleDefect} onRetry={analysis.retryDetection}/>{analysis.result&&<AnalysisResults result={analysis.result} score={analysis.qualityScore} scoreBusy={analysis.qualityScoreBusy} scoreError={analysis.detectionError||analysis.qualityScoreError}/>}<UploadDrivePreview analysis={analysis} onOpen={onSimulate}/></>}
        <section className="panel preview-panel"><PanelTitle title="Inspection viewer" eyebrow="03 / REVIEW">{sample?<Badge tone="lavender">Synthetic example</Badge>:analysis.selected?<Badge>Original image</Badge>:<Badge>Awaiting capture</Badge>}</PanelTitle>
          {(analysis.selected||sample)?<><div className="segmented preview-tabs" role="group" aria-label="Image view"><button className={view==='original'?'active':''} aria-pressed={view==='original'} onClick={()=>setView('original')}>Original</button><button className={view==='overlay'?'active':''} aria-pressed={view==='overlay'} disabled={!sample&&!result?.overlay_png_base64} onClick={()=>setView('overlay')}>Diagnostic overlay</button></div>
            <div className="image-stage">{sample?<SurfaceArt mode={view==='overlay'?'segmentation':'original'}/>:view==='overlay'&&result?.overlay_png_base64?<img src={'data:image/png;base64,'+result.overlay_png_base64} alt="Processed diagnostic overlay showing green chip candidate boundaries and red potential dark linear regions"/>:<img src={analysis.selected?.url} alt={'Original road surface: '+analysis.selected?.file.name}/>}</div>
            {view==='overlay'&&<div className="overlay-legend"><span><i className="dot good"/>Chip candidate boundaries</span><span><i className="dot poor"/>Potential dark linear regions</span></div>}
            <div className="preview-caption"><span>{sample?'Synthetic sample':analysis.selected?.file.name}</span><span>{result?'Processed '+result.image.processed_width+' × '+result.image.processed_height+' px':analysis.selected?.width+' × '+analysis.selected?.height+' original px'}</span></div>
            {!sample&&result&&!result.overlay_png_base64&&<p className="fine-print">No overlay was returned by the API. Enable “Include diagnostic overlay” and analyze again to request one.</p>}
          </>:<EmptyState icon="image" title="A surface, ready to inspect" description="Your original capture and diagnostic overlay will appear here. Images are uploaded without resizing or cropping."/>}
        </section>
        {result?<><div className="results-toolbar"><span><i className={'dot '+(sample?'lavender':'good')}/>{sample?'Example response · not a real assessment':'Analysis complete'}</span><button className="button secondary small" onClick={()=>downloadJson(sample?{demo:true,result}:result,sample?'demo-road-analysis':'road-analysis')}><Icon name="download" size={15}/>Download JSON</button></div>{sample&&<AnalysisResults result={result} demo/>}</>:analysis.busy?<Note>Analyzing your uploaded road area and generating the diagnostic overlay…</Note>:<Note>Surface analysis reports aggregate candidates and visible texture. Verified pothole classes, metal content, image-derived slope, and material properties require additional models or measurements.</Note>}
      </div>
    </div>
    <DetectionWorkspace image={analysis.selected?.file} scale={analysis.scale} pitch={analysis.pitch}/>
    <CountryComparison/>
  </div>;
}
