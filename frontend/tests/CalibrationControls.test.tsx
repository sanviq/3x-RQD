import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ScaleReference} from '../src/components/ScaleReference';
import {isAnalysisResponse} from '../src/api/roadQuality';
import {demoResult} from '../src/data/demo';
describe('measured-reference calibration',()=>{
 it('uses original-image pixels and rejects invalid scales',()=>{
  const apply=vi.fn();render(<ScaleReference image={null} disabled={false} onApply={apply}/>);
  fireEvent.change(screen.getByLabelText('Measured reference length mm'),{target:{value:'100'}});
  fireEvent.change(screen.getByLabelText('Reference span original pixels'),{target:{value:'200'}});
  fireEvent.click(screen.getByText('Apply reference scale'));expect(apply).toHaveBeenCalledWith('0.5');
  fireEvent.change(screen.getByLabelText('Reference span original pixels'),{target:{value:'0'}});
  fireEvent.click(screen.getByText('Apply reference scale'));expect(apply).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alert')).toHaveTextContent('valid original-image pixel span');
 });
 it('rejects malformed server uncertainty instead of rendering invented units',()=>{
  const calibration={source:'user_supplied_uniform_scale',validated:false,mm_per_original_pixel:.5,scale_uncertainty_percent:5,
   bounds:{area_sq_ft:{lower:1,upper:2}},notice:'Scale uncertainty only'};
  expect(isAnalysisResponse({...demoResult,calibration})).toBe(true);
  expect(isAnalysisResponse({...demoResult,calibration:{...calibration,bounds:{area_sq_ft:{lower:2,upper:1}}}})).toBe(false);
  expect(isAnalysisResponse({...demoResult,calibration:{...calibration,validated:true}})).toBe(false);
 });
});
