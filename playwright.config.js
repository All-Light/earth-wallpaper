import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  outputDir: './tmp/playwright-results',
  use: {baseURL:'http://127.0.0.1:4180',viewport:{width:1280,height:800},timezoneId:'Europe/Stockholm',
    launchOptions:{executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
  webServer:{command:'node scripts/serve.mjs',env:{PORT:'4180'},url:'http://127.0.0.1:4180',reuseExistingServer:false},
});
