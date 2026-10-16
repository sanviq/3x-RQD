import {render,screen,fireEvent} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {RoadQualityCard} from '../src/components/RoadQualityCard';
import {isRoadQualityScore,rescoreRoad} from '../src/api/qualityScore';
import {scoreFixture} from './fixtures/qualityScore';
afterEach(()=>vi.unstubAllGlobals());
describe('provisional road score contract',()=>{
 it('accepts real numeric zero and rejects confidence/invalid arithmetic masquerading as score',()=>{
  expect(isRoadQualityScore(scoreFixture(0))).toBe(true);
  expect(isRoadQualityScore({...scoreFixture(),score_is_model_confidence:true})).toBe(false);
  expect(isRoadQualityScore({...scoreFixture(),score:99})).toBe(false);
  expect(isRoadQualityScore({...scoreFixture(),validated:true})).toBe(false);
  const value=scoreFixture();value.validation.mae=4 as unknown as null;expect(isRoadQualityScore(value)).toBe(false);
 });
 it('renders provisional zero, rating, counts and a transparent breakdown without inventing accuracy',()=>{
  render(<RoadQualityCard score={scoreFixture(0)}/>);
  expect(screen.getByTestId('road-quality-score')).toHaveTextContent('0.0');expect(screen.getByText('Provisional',{exact:true})).toBeInTheDocument();
  expect(screen.getByText(/Critical · provisional/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Why this score/));expect(screen.getByRole('table',{name:'Road score defect deductions'})).toHaveTextContent('Pothole');
  expect(screen.getByText(/MAE: unavailable/)).toBeInTheDocument();
 });
 it('never leaves a stale score visible during recalculation or API errors',()=>{
  const view=render(<RoadQualityCard score={scoreFixture()} busy/>);expect(screen.queryByTestId('road-quality-score')).not.toBeInTheDocument();
  view.rerender(<RoadQualityCard score={scoreFixture()} error="Score evidence expired" onRefresh={vi.fn()}/>);
  expect(screen.queryByTestId('road-quality-score')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('expired');
 });
 it('sends only snapshot identity and exclusions and rejects a mismatched server review',async()=>{
  const score=scoreFixture(90,['A']);const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify(score)));vi.stubGlobal('fetch',mock);
  await rescoreRoad(score.snapshot_id,['A']);const [url,options]=mock.mock.calls[0];expect(url).toBe('/api/road-quality-score');
  expect(JSON.parse(options.body)).toEqual({score_token:score.snapshot_id,excluded_ids:['A']});
  mock.mockResolvedValueOnce(new Response(JSON.stringify({...score,excluded_ids:[]})));
  await expect(rescoreRoad(score.snapshot_id,['A'])).rejects.toThrow('incompatible detection evidence');
 });
});
