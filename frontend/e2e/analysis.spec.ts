import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoResult } from '../src/data/demo';
test.beforeEach(async({page})=>{
  await page.route('**/api/health',route=>route.fulfill({json:{status:'ok',model_loaded:false,feature_version:'surface-v1'}}));
});
test('responsive overview and full upload-to-export flow with mocked API',async({page})=>{
  const fixture=readFileSync(new URL('./fixtures/synthetic-64.png',import.meta.url));
  let submitted=false;
  await page.route('**/api/analyze',async route=>{
    submitted=true;
    const body=route.request().postData()||'';
    expect(body).toContain('name="pitch_degrees"');
    expect(body).toContain('name="include_overlay"');
    await route.fulfill({json:{...demoResult,overlay_png_base64:fixture.toString('base64')}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Roads at a glance.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'New inspection',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-64.png',mimeType:'image/png',buffer:fixture});
  await expect(page.getByText('64 × 64 px', {exact:false}).first()).toBeVisible();
  await page.getByLabel('Scale mm per original-image pixel',{exact:false}).fill('0.5');
  await page.getByLabel('Measured sensor pitch',{exact:false}).fill('0');
  await page.getByRole('button',{name:'Analyze surface',exact:true}).click();
  await expect(page.getByText('64.0',{exact:true})).toBeVisible();
  expect(submitted).toBe(true);
  await page.getByRole('button',{name:'Diagnostic overlay',exact:true}).click();
  await expect(page.getByAltText('Processed diagnostic overlay',{exact:false})).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download JSON',exact:true}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^road-analysis-.*\.json$/);
  await page.getByLabel('Measured sensor pitch',{exact:false}).fill('1');
  await expect(page.getByText('64.0',{exact:true})).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('sample routes and budget scenarios are interactive',async({page,isMobile})=>{
  await page.goto('/');
  if(isMobile)await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Repair planner',exact:true}).click();
  const budget=page.getByLabel('Available budget');
  await budget.focus();
  await budget.press('Home');
  await expect(page.getByText('₹0',{exact:true}).first()).toBeVisible();
  expect(await page.locator('.repair-table input:checked').count()).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
