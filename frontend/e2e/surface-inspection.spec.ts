import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {Page} from '@playwright/test';
async function start(page:Page){
 // No tile or road-provider requests: these tests exercise the real image APIs only.
 await page.route('**/api/map/**',route=>route.abort());await page.route('https://*.tile.openstreetmap.org/**',route=>route.abort());
 await page.goto('/');await page.getByRole('button',{name:'New inspection',exact:true}).click();
}
async function target(page:Page,chips:boolean){const data=await page.evaluate(drawChips=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle=drawChips?'rgb(50,50,50)':'rgb(100,100,100)';ctx.fillRect(0,0,256,256);if(drawChips){ctx.fillStyle='rgb(180,180,180)';for(let x=32;x<240;x+=40)for(let y=32;y<240;y+=40){ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill()}}return c.toDataURL('image/png').split(',')[1]},chips);return Buffer.from(data,'base64')}
const analyzed=(page:Page)=>page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.status()===200);
test('real pothole upload produces an outline, pixel measurements, current score and diagnostic overlay',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
 const analysis=analyzed(page);const detected=page.waitForResponse(r=>r.url().endsWith('/api/detect-defects')&&r.status()===200);
 await page.locator('input[type=file]').first().setInputFiles({name:'provided-pothole.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))});
 const [a,d]=await Promise.all([analysis.then(r=>r.json()),detected.then(r=>r.json())]);
 await expect(page.getByRole('region',{name:'Inspection road region'})).toContainText('Review proposed outline');
 expect(a.image.original_width).toBe(640);expect(a.image.original_height).toBe(427);expect(a.surface_measurements.equivalent_diameter.value).toBeGreaterThan(0);
 await expect(page.getByTestId('surface-assessment-score')).toHaveText(d.road_quality_score.score.toFixed(1));await expect(page.getByTestId('road-quality-score')).toHaveText(d.road_quality_score.score.toFixed(1));
 await expect(page.getByText('Mean equivalent chip diameter · pixels',{exact:true})).toBeVisible();await expect(page.getByText('Unable to assess',{exact:true})).toHaveCount(0);
 const updated=page.waitForResponse(r=>r.url().endsWith('/api/road-quality-score')&&r.status()===200);
 await page.getByRole('checkbox',{name:'Use '+d.defects[0].id+' in simulation',exact:true}).uncheck();const revised=await(await updated).json();
 await expect(page.getByTestId('surface-assessment-score')).toHaveText(revised.score.toFixed(1));await expect(page.getByTestId('road-quality-score')).toHaveText(revised.score.toFixed(1));
 await page.getByRole('button',{name:'Diagnostic overlay',exact:true}).click();await expect(page.getByRole('img',{name:/Processed diagnostic overlay showing/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('rectified chip target recalculates physical values automatically when scale is edited',async({page})=>{
 await start(page);let next=analyzed(page);await page.locator('input[type=file]').first().setInputFiles({name:'known-synthetic-chips.png',mimeType:'image/png',buffer:await target(page,true)});await next;
 next=analyzed(page);await page.locator('#capture-type').selectOption('surface_crop');await next;
 next=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.status()===200&&r.request().postData()?.includes('0.5')===true);
 await page.locator('#scale').fill('0.5');const a=await(await next).json();expect(a.physical_measurements.mean_chip_diameter_mm).toBeGreaterThan(0);
 const physical=page.locator('.panel').filter({has:page.getByText('Calibrated measurements',{exact:true})});await expect(physical.getByText('Not available',{exact:true})).toHaveCount(0);
 next=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.status()===200&&r.request().postData()?.includes('0.5')===false);
 await page.locator('#scale').fill('1');const b=await(await next).json();expect(b.physical_measurements.mean_chip_diameter_mm).toBeCloseTo(2*a.physical_measurements.mean_chip_diameter_mm,6);expect(b.physical_measurements.area_sq_ft).toBeCloseTo(4*a.physical_measurements.area_sq_ft,6);await expect(physical.getByText('Not available',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('low-detail capture keeps descriptors but returns specific limits without a perfect road score',async({page})=>{
 await start(page);const next=analyzed(page);await page.locator('input[type=file]').first().setInputFiles({name:'known-blank-test-target.png',mimeType:'image/png',buffer:await target(page,false)});const a=await(await next).json();expect(a.surface_quality.status).toBe('limited');expect(a.defect_detection.road_quality_score).toBeNull();
 await expect(page.getByTestId('surface-assessment-score')).toHaveText('—');await expect(page.getByText('Limited surface detail',{exact:true})).toBeVisible();await expect(page.getByText('Fine surface boundaries are not resolved.',{exact:true})).toBeVisible();await expect(page.getByText('Mean equivalent chip diameter · pixels',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Inspection road region'})).toContainText('Outline needed');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
