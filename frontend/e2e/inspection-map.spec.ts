import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {mapFixture,mapConfig} from '../tests/fixtures/mapNetwork';
import type {RoadQualityScore} from '../src/api/qualityScore';
import type {Page} from '@playwright/test';
// Explicit test fixtures and route interception; never contacts public tile/search services or stores fake GPS observations.
async function setup(page:Page,inspected=false){
 let state=mapFixture(inspected);let searches=0;let observedScore:RoadQualityScore|undefined;let assignmentBody='';
 await page.route('https://example.test/**',route=>route.abort());
 await page.route('**/api/map/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/config'))return route.fulfill({json:mapConfig});
  if(url.pathname.endsWith('/search')){searches++;return route.fulfill({json:{results:[{label:'Fixture locality — not real evidence',latitude:12.9716,longitude:77.5946}]}})}
  if(url.pathname.endsWith('/inspections')){
   assignmentBody=route.request().postData()??'';expect(observedScore).toBeDefined();
   const source=mapFixture().segments[0].inspection!;
   state={...state,segments:state.segments.map(s=>({...s,inspection:{...source,score:observedScore!,source_hash:observedScore!.image.sha256,source_width:observedScore!.image.width,source_height:observedScore!.image.height,analyzed_at:observedScore!.generated_at}})),summary:{...state.summary,inspected_segments:1,not_inspected_segments:0,average_quality:observedScore!.score,defect_count:observedScore!.summary.included_count,represented_segment_length_m:100,represented_length_percent:100,by_type:Object.fromEntries(Object.entries(observedScore!.summary.by_type).filter(([,v])=>v!==null)) as Record<string,number>,by_severity:observedScore!.summary.by_severity}};
  }
  return route.fulfill({json:state});
 });
 page.on('response',async response=>{if(response.url().endsWith('/api/detect-defects')&&response.ok()){observedScore=(await response.json()).road_quality_score}});
 return{searches:()=>searches,assignment:()=>assignmentBody};
}
test('unknown roads stay uninspected; map loads, zooms and searches only on submit',async({page})=>{
 const state=await setup(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await expect(page.locator('.leaflet-container')).toHaveCount(1);await expect(page.locator('.inspection-card')).toContainText('Not inspected');await expect(page.locator('.condition-panel')).toContainText('No inspection-backed scores yet');
 await page.getByRole('textbox',{name:'Search map location'}).fill('Fixture');expect(state.searches()).toBe(0);
 await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.getByRole('button',{name:/Fixture locality/})).toBeVisible();expect(state.searches()).toBe(1);
 await page.getByRole('button',{name:/Fixture locality/}).click();await expect(page.locator('.map-search-results')).toHaveCount(0);
 const scale=await page.locator('.leaflet-control-scale-line').textContent();await page.getByRole('button',{name:'Zoom in'}).click();await expect(page.locator('.leaflet-control-scale-line')).not.toHaveText(scale!);
 await expect(page.getByText('Sample network',{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('linked segment reveals evidence, score, date and uncertainty',async({page})=>{
 await setup(page,true);await page.goto('/');await expect(page.locator('.segment-evidence')).toContainText('80.0 / 100');await expect(page.getByRole('img',{name:'Uploaded road with detected regions outlined'})).toBeVisible();await expect(page.locator('.segment-evidence')).toContainText('Analyzed');
 await page.getByRole('button',{name:'Original preview',exact:true}).click();await expect(page.getByRole('img',{name:'Unannotated uploaded-road preview'})).toBeVisible();
 await page.getByText('Method and uncertainty',{exact:true}).click();await expect(page.locator('.segment-evidence')).toContainText('not detection accuracy or GPS');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('actual uploaded detection is explicitly assigned and updates dashboard without a demo score',async({page})=>{
 const state=await setup(page);await page.goto('/');await page.getByRole('button',{name:'New inspection',exact:true}).click();
 const detected=page.waitForResponse(r=>r.url().endsWith('/api/detect-defects')&&r.status()===200);
 await page.locator('input[type=file]').first().setInputFiles({name:'provided-pothole.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))});
 const response=await(await detected).json();await expect(page.getByTestId('road-quality-score')).toHaveText(response.road_quality_score.score.toFixed(1));
 await page.getByRole('button',{name:'Choose road on map',exact:true}).click();const save=page.getByRole('button',{name:'Save inspection to this road',exact:true});await expect(save).toBeDisabled();
 await page.getByRole('checkbox',{name:/I confirm this capture belongs/}).check();await save.click();await expect(page.getByText('Inspection linked. The dashboard now uses this saved score.')).toBeVisible();
 expect(state.assignment()).toContain(response.score_token);expect(state.assignment()).toContain('provided-pothole.jpg');expect(state.assignment()).not.toContain('"score":');
 await page.getByRole('button',{name:'Overview',exact:true}).first().click();await expect(page.locator('.segment-evidence')).toContainText(response.road_quality_score.score.toFixed(1)+' / 100');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
