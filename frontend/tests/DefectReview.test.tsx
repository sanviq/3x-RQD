import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {DefectReview} from '../src/components/DefectReview';
import type {DefectDetection} from '../src/types/api';
import raw from './fixtures/pothole-detection.json';

describe('detector identity and class coverage in the main photo panel',()=>{
 it('names the untrained contour source instead of implying trained detections',()=>{
  render(<DefectReview url="blob:photo" detection={raw as DefectDetection} onRetry={()=>{}}/>);
  expect(screen.getByText(/Untrained OpenCV contours/)).toBeVisible();
 });
 it('retains all four feature categories and explains the model class limitation',()=>{
  render(<DefectReview url="blob:photo" detection={{...raw,method:'yolo_rdd_detection',defects:[]} as DefectDetection} onRetry={()=>{}}/>);
  expect(screen.getByText('Depression and uneven-patch features are retained.')).toBeVisible();
  expect(screen.getByText('Depression · OpenCV / manual review')).toBeVisible();
  expect(screen.getByText('Uneven patch · OpenCV / manual review')).toBeVisible();
  expect(screen.getByText(/Trained YOLO predictions from your photo/)).toBeVisible();
 });
 it('lets the user trade recall for false alarms in the same photo review',()=>{
  const onSettings=vi.fn();
  render(<DefectReview url="blob:photo" onRetry={()=>{}} settings={{mode:'model',confidence:.35,resolution:768}} onSettings={onSettings}/>);
  fireEvent.change(screen.getByLabelText('Road candidate confidence'),{target:{value:'0.25'}});
  expect(onSettings).toHaveBeenCalledWith({mode:'model',confidence:.25,resolution:768});
 });
});
