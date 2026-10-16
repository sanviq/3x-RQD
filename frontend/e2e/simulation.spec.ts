import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {weatherFixture} from '../tests/fixtures/weather';
test.beforeEach(async({page})=>{
  await page.route('**/api/detect-defects',route=>route.fulfill({json:{"version":"opencv-candidates-v1","method":"opencv_multiscale_contours","coordinate_system":"normalized_exif_oriented_original","confidence_calibrated":false,"requires_review":true,"road_quad":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1},{"x":0,"y":1}],"image":{"width":64,"height":64},"defects":[],"warnings":[]}}));
  await page.route('**/api/health',route=>route.fulfill({json:{status:'ok',model_loaded:false,feature_version:'surface-v1'}}));
});
test('uploaded road supports driving, repairs and real weather comparison',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'New inspection',exact:true}).click();
  const fixture=readFileSync(new URL('./fixtures/synthetic-64.png',import.meta.url));
  await page.locator('input[type=file]').setInputFiles({name:'user-road.png',mimeType:'image/png',buffer:fixture});
  await page.getByRole('button',{name:'Simulate uploaded road'}).click();
  await expect(page.getByRole('heading',{name:'Scenario lab.'})).toBeVisible();
  const annotation=page.getByRole('button',{name:'Mark a defect on the road image',exact:true});
  await annotation.focus();await annotation.press('Enter');
  await expect(page.getByRole('heading',{name:'M1 / Pothole',exact:true})).toBeVisible();
  await page.getByLabel('Defect width',{exact:true}).focus();await page.getByLabel('Defect width',{exact:true}).press('End');
  await page.getByLabel('Assumed road width (m)',{exact:true}).fill('6');
  await page.getByLabel('Assumed image length along road (m)').fill('10');
  await page.getByLabel('Assumed driving speed',{exact:true}).focus();await page.getByLabel('Assumed driving speed',{exact:true}).press('End');
  await page.getByRole('button',{name:'Start drive',exact:true}).click();
  await expect(page.getByRole('button',{name:'Drive again',exact:true})).toBeVisible({timeout:15000});
  await expect(page.locator('.drive-results')).toContainText('80.00 km/h');
  await page.getByLabel('Repair this defect',{exact:false}).check();
  await page.getByRole('group',{name:'Road scenario'}).getByRole('button',{name:'Repaired',exact:true}).click();
  await page.getByRole('button',{name:'Start drive',exact:true}).click();
  await expect(page.getByRole('button',{name:'Drive again',exact:true})).toBeVisible({timeout:15000});
  await expect(page.locator('.drive-results')).toContainText('0.00 m/s²');
  await page.getByRole('button',{name:'Weather lab',exact:true}).click();
  await page.getByRole('button',{name:'Low light',exact:true}).click();
  let requests=0;
  await page.route('**/api/weather-compare',async route=>{requests++;await route.fulfill({json:weatherFixture('low_light',64,64)})});
  await page.route('**/api/weather-evidence/**',route=>route.fulfill({contentType:'image/png',body:fixture}));
  await page.getByRole('button',{name:'Analyze original & altered images'}).click();
  await expect(page.getByRole('table',{name:'Weather robustness metrics'})).toBeVisible();
  expect(requests).toBe(1);await expect(page.locator('.native-evidence')).toHaveCount(2);
  const downloaded=page.waitForEvent('download');await page.getByRole('link',{name:'Download altered native image'}).click();
  expect((await downloaded).suggestedFilename()).toBe('road-low_light-native.png');
  await page.getByRole('button',{name:'Shadow',exact:true}).click();
  await expect(page.getByAltText('Shadow altered road at original resolution')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('all simulation tools open without backend',async({page,isMobile})=>{
  await page.goto('/');
  if(isMobile)await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Scenario lab',exact:true}).click();
  for(const name of ['Digital twin','Repair & deterioration','Severity heatmap','Weather lab','Repair budget','Driving comparison']){
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
});
