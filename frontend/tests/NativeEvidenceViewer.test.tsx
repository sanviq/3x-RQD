
import {render,fireEvent,screen} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import {NativeEvidenceViewer} from '../src/components/NativeEvidenceViewer';
import {weatherFixture} from './fixtures/weather';
describe('native pixel evidence viewer',()=>{
 it('keeps all polygons but suppresses overlapping labels',()=>{
  const d=weatherFixture().frames[0].defects[0];const {container}=render(<NativeEvidenceViewer url="blob:source" width={640} height={427} title="Original" defects={[d,{...d,id:'original-2'}]}/>);
  expect(container.querySelectorAll('polygon')).toHaveLength(2);expect(container.querySelectorAll('text')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'100%',exact:true}));
  expect(container.querySelector('img')).toHaveAttribute('width','640');expect(container.querySelector('svg')).toHaveAttribute('viewBox','0 0 640 427');
 });
 it('switches to original-coordinate polygons for perspective comparison',()=>{
  const d=weatherFixture().frames[0].defects[0];d.frame_polygon=[[20,20],[30,20],[30,30]];
  const {container}=render(<NativeEvidenceViewer reference url="blob:source" width={640} height={427} title="Mapped" defects={[d]}/>);
  expect(container.querySelector('polygon')).toHaveAttribute('points',d.reference_polygon.map(p=>p.join(',')).join(' '));
 });
});
