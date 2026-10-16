import {expect,test} from '@playwright/test';
// Actual read-only backend reports. Run with ROAD_HEALTH_REAL_API=1.
test.skip(process.env.ROAD_HEALTH_REAL_API!=='1','Requires the locally running updated backend.');
test('real country sample comparison and measured evaluation remain distinct from synthetic charts',async({page,request})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'New inspection',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Compare real country samples'})).toBeVisible();
 await expect(page.getByText(/real labelled images · D00/)).toBeVisible();
 const sampleReport=await (await request.get('/api/dataset/comparison')).json();
 if(sampleReport.rows.some((r:{detection_evaluation:unknown})=>r.detection_evaluation))await expect(page.getByRole('heading',{name:'Measured detector results'})).toBeVisible();
 else await expect(page.getByText('Country-level evaluation is not available',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('heading',{name:'Compare real country samples'}).scrollIntoViewIfNeeded();
 await page.locator('.page-enter').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished))});
 await page.screenshot({path:test.info().outputPath('country-comparison.png'),fullPage:false});
 const menu=page.getByRole('button',{name:'Open navigation'});
 if(await menu.isVisible())await menu.click();
 await page.getByRole('button',{name:'Model evaluation',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Measured RDD2022 evaluation'})).toBeVisible();
 await expect(page.getByText('Held-out test',{exact:true})).toBeVisible();
 await expect(page.getByText(/true positives, .* false positives, .* missed labels/)).toBeVisible();
 await expect(page.getByText(/Local improvement job:/)).toBeVisible();
 await page.locator('.page-enter').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished))});
 await page.screenshot({path:test.info().outputPath('measured-evaluation.png'),fullPage:false});
});
