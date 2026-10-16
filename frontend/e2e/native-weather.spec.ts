
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
test('uploaded pothole native evidence maps every weather condition without invented accuracy',async({page})=>{
 test.skip(process.env.ROAD_HEALTH_REAL_API!=='1','Requires local updated FastAPI');test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:'New inspection',exact:true}).click();
 const detection=page.waitForResponse(r=>r.url().endsWith('/api/detect-defects')&&r.status()===200);
 await page.locator('input[type=file]').first().setInputFiles({name:'pothole.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))});await detection;
 await page.getByRole('button',{name:'Simulate uploaded road',exact:true}).click();await page.getByRole('button',{name:'Weather lab',exact:true}).click();
 const lab=page.getByRole('region',{name:'Native-resolution weather comparison'});
 await expect(lab.locator('img')).toHaveCount(1);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/weather-compare')&&r.status()===200,{timeout:120000});
 await lab.getByRole('button',{name:'Analyze all seven conditions',exact:true}).click();
 const body=await (await response).json();expect(body.frames).toHaveLength(8);expect(body.metadata.width).toBe(640);expect(body.metadata.height).toBe(427);
 await expect(lab.getByRole('table',{name:'Weather robustness metrics'})).toBeVisible({timeout:15000});
 for(const label of ['Rain','Puddles','Shadow','Low light','Glare','Blur','Perspective']){
   await lab.getByRole('button',{name:label,exact:true}).click();
   const image=lab.getByAltText(label+' altered road at original resolution');await expect(image).toBeVisible();
   await expect.poll(()=>image.evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBe(640);
   const metrics=lab.getByRole('table',{name:'Condition defect measurements'});await expect(metrics).toBeVisible();
 }
 await lab.getByRole('checkbox',{name:'Map condition detections onto original coordinates'}).check();
 await expect(lab.getByAltText('Perspective detections mapped to original at original resolution')).toBeVisible();
 const original=lab.locator('.native-evidence').first();await original.getByRole('button',{name:'100%',exact:true}).click();
 await expect(original.locator('.native-zoom')).toContainText('100%');
 await expect(lab.getByRole('table',{name:'Weather robustness metrics'})).toContainText('No ground truth');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('weather service failure retains original and retries real inference',async({page})=>{
 test.skip(process.env.ROAD_HEALTH_REAL_API!=='1','Requires local updated FastAPI');test.setTimeout(120000);
 await page.route('**/api/weather-compare',route=>route.fulfill({status:429,json:{detail:'Comparison is busy. Retry after it finishes.'}}));
 await page.goto('/');await page.getByRole('button',{name:'New inspection',exact:true}).click();
 const detection=page.waitForResponse(r=>r.url().endsWith('/api/detect-defects')&&r.status()===200);
 await page.locator('input[type=file]').first().setInputFiles({name:'pothole.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../../tests/fixtures/pothole-road.jpg',import.meta.url))});await detection;
 await page.getByRole('button',{name:'Simulate uploaded road',exact:true}).click();await page.getByRole('button',{name:'Weather lab',exact:true}).click();
 const lab=page.getByRole('region',{name:'Native-resolution weather comparison'});
 await lab.getByRole('button',{name:'Analyze original & altered images'}).click();await expect(lab.getByRole('alert')).toContainText('busy');await expect(lab.locator('img')).toHaveCount(1);
 await page.unroute('**/api/weather-compare');await lab.getByRole('button',{name:'Analyze original & altered images'}).click();await expect(lab.getByRole('table',{name:'Weather robustness metrics'})).toBeVisible({timeout:60000});
});

test('exact bundled RDD photo reports genuine annotation metrics rather than baseline agreement',async({page})=>{
 test.skip(process.env.ROAD_HEALTH_REAL_API!=='1','Requires local updated FastAPI');test.setTimeout(120000);
 await page.goto('/');await page.getByRole('button',{name:'New inspection',exact:true}).click();
 const detection=page.waitForResponse(r=>r.url().endsWith('/api/detect-defects')&&r.status()===200);
 await page.locator('input[type=file]').first().setInputFiles({name:'renamed-rdd.jpg',mimeType:'image/jpeg',buffer:readFileSync(new URL('../../data/examples/rdd2022/India_India_000114.jpg',import.meta.url))});await detection;
 await page.getByRole('button',{name:'Simulate uploaded road',exact:true}).click();await page.getByRole('button',{name:'Weather lab',exact:true}).click();
 const lab=page.getByRole('region',{name:'Native-resolution weather comparison'});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/weather-compare')&&r.status()===200);
 await lab.getByRole('button',{name:'Analyze original & altered images'}).click();
 const data=await (await response).json();expect(data.ground_truth_source).toBe('Bundled RDD2022 exact SHA-256 match');expect(data.frames.every((f:{metrics:{available:boolean}})=>f.metrics.available)).toBe(true);
 await expect(lab.getByText('Ground truth: Bundled RDD2022 exact SHA-256 match',{exact:true})).toBeVisible();
 await expect(lab.getByRole('table',{name:'Weather robustness metrics'})).not.toContainText('No ground truth');
});
