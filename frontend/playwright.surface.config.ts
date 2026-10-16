import {defineConfig,devices} from '@playwright/test';
import {existsSync} from 'node:fs';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const executablePath=process.env.ROAD_HEALTH_BROWSER_EXECUTABLE??(process.platform==='win32'&&existsSync(edge)?edge:undefined);
export default defineConfig({testDir:'./e2e',testMatch:'surface-inspection.spec.ts',fullyParallel:false,workers:1,timeout:90000,expect:{timeout:20000},use:{baseURL:process.env.ROAD_HEALTH_TEST_URL??'http://127.0.0.1:5174',trace:'retain-on-failure',launchOptions:{executablePath}},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],browserName:'chromium'}}]});
