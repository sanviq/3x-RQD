import { defineConfig, devices } from '@playwright/test';
const baseURL=process.env.ROAD_HEALTH_TEST_URL??'http://127.0.0.1:5173';
const executablePath=process.env.ROAD_HEALTH_BROWSER_EXECUTABLE;
export default defineConfig({
  testDir:'./e2e',fullyParallel:true,
  use:{baseURL,trace:'retain-on-failure',...(executablePath?{launchOptions:{executablePath}}:{})},
  webServer:{command:'npm run dev -- --port 5173 --strictPort',url:baseURL,reuseExistingServer:!process.env.CI},
  projects:[
    {name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'mobile',use:{...devices['iPhone 13'],browserName:'chromium'}},
  ],
});
