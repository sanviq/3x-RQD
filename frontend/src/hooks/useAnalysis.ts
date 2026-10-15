import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeRoad } from '../api/roadQuality';
import type { AnalysisResponse } from '../types/api';
import { inspectImage, optionalNumber } from '../utils/imageValidation';
import type { SelectedImage } from '../utils/imageValidation';
export function useAnalysis() {
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [scale, setScale] = useState('');
  const [pitch, setPitch] = useState('');
  const [overlay, setOverlay] = useState(true);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const currentImage = useRef<SelectedImage | null>(null);
  const mounted = useRef(true);
  const invalidate = useCallback(() => {
    revision.current++; controller.current?.abort(); controller.current = null;
    setBusy(false); setValidating(false); setResult(null); setErrors({}); setNotice('');
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; revision.current++; controller.current?.abort();
      if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
    };
  }, []);
  const select = async (file: File) => {
    invalidate();
    if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
    currentImage.current = null; setSelected(null);
    const version = revision.current;
    setValidating(true);
    try {
      const image = await inspectImage(file);
      if (!mounted.current || version !== revision.current) { URL.revokeObjectURL(image.url); return; }
      currentImage.current = image; setSelected(image);
    } catch (error) {
      if (mounted.current && version === revision.current) setErrors({ image: (error as Error).message });
    } finally { if (mounted.current && version === revision.current) setValidating(false); }
  };
  const submit = async () => {
    if (controller.current || busy || validating) return;
    const parsedScale = optionalNumber(scale, 'scale');
    const parsedPitch = optionalNumber(pitch, 'pitch');
    const nextErrors: Record<string, string> = {};
    if (!selected) nextErrors.image = 'Choose a road-surface image first.';
    if (parsedScale.error) nextErrors.scale = parsedScale.error;
    if (parsedPitch.error) nextErrors.pitch = parsedPitch.error;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !selected) return;
    const version = ++revision.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true); setResult(null); setNotice('');
    try {
      const response = await analyzeRoad({ image: selected.file, mmPerPixel: parsedScale.value, pitchDegrees: parsedPitch.value, includeOverlay: overlay }, requestController.signal);
      if (mounted.current && version === revision.current) { setResult(response); setNotice('Analysis complete. Results are ready.'); }
    } catch (error) {
      if (mounted.current && version === revision.current && !requestController.signal.aborted) setErrors({ request: (error as Error).message });
    } finally { if (mounted.current && version === revision.current) { setBusy(false); controller.current = null; } }
  };
  const reset = () => {
    invalidate();
    if (currentImage.current) URL.revokeObjectURL(currentImage.current.url);
    currentImage.current = null; setSelected(null); setScale(''); setPitch(''); setOverlay(true);
  };
  return {
    selected, scale, pitch, overlay, result, busy, validating, errors, notice, select, submit, reset,
    setScale: (value: string) => { invalidate(); setScale(value); },
    setPitch: (value: string) => { invalidate(); setPitch(value); },
    setOverlay: (value: boolean) => { invalidate(); setOverlay(value); },
    cancel: () => { invalidate(); setNotice('Request cancelled. Server computation may still finish.'); },
  };
}
export type AnalysisController = ReturnType<typeof useAnalysis>;
