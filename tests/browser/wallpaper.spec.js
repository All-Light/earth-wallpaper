import {test,expect} from '@playwright/test';
import path from 'node:path';

test('renderer wakes on first drag, preserves state, and unloads completely on idle',async({page})=>{
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.stack)});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLEERR',m.text())});
  await page.route('https://clouds.matteason.co.uk/**',r=>r.fulfill({path:path.resolve('public/assets/clouds-alpha.png'),contentType:'image/png'}));
  await page.goto('/');await page.waitForFunction(()=>window.wallpaperHost);
  await page.evaluate(()=>{window.wallpaperHost.applySettings({returnDelay:0});window.wallpaperHost.setIdleMs(1200);});
  await page.waitForFunction(()=>window.wallpaperHost.getStatus().ready,{timeout:15000});
  const initial=await page.evaluate(()=>window.wallpaperHost.getState().camera);
  await page.mouse.move(500,360);await page.mouse.down();await page.mouse.move(750,420,{steps:8});await page.mouse.up();
  await page.waitForTimeout(600);
  const moved=await page.evaluate(()=>window.wallpaperHost.getState().camera);
  expect(Math.hypot(moved.x-initial.x,moved.y-initial.y,moved.z-initial.z)).toBeGreaterThan(.1);
  await page.waitForFunction(()=>window.wallpaperHost.getStatus().mode==='sleeping',{timeout:8000});
  expect(await page.locator('#rendererMount iframe').count()).toBe(0);
  expect(await page.locator('#snapshot').evaluate(e=>!e.hidden&&e.src.startsWith('data:image/jpeg'))).toBeTruthy();
  const frameCount=await page.evaluate(()=>window.wallpaperHost.getStatus().frameCount);
  await page.waitForTimeout(500);expect(await page.evaluate(()=>window.wallpaperHost.getStatus().frameCount)).toBe(frameCount);
  await page.mouse.wheel(0,-120);await page.waitForFunction(()=>window.wallpaperHost.getStatus().ready,{timeout:10000});
  await page.getByRole('button',{name:'Open settings'}).click();await expect(page.getByText('Settings',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('settings remain usable asleep and bookmark retains zoom across reload',async({page})=>{
  await page.addInitScript(()=>{try{localStorage.setItem('earth-now-settings-v1','{broken');}catch{}});
  await page.goto('/?native=1');await page.waitForFunction(()=>window.wallpaperHost?.getStatus().mode==='sleeping');
  await expect(page.locator('#clock')).toBeHidden();await page.getByRole('button',{name:'Open settings'}).click();
  await page.waitForFunction(()=>window.wallpaperHost.getStatus().ready,{timeout:10000});
  await page.mouse.wheel(0,-150);await page.waitForTimeout(500);
  const before=await page.evaluate(()=>window.wallpaperHost.getState().camera);await page.getByRole('button',{name:'Save current view as return location'}).click();
  await page.waitForTimeout(2500);const after=await page.evaluate(()=>window.wallpaperHost.getState().camera);
  expect(Math.abs(Math.hypot(before.x,before.y,before.z)-Math.hypot(after.x,after.y,after.z))).toBeLessThan(.01);
});

test('refresh uses a bounded renderer and returns to a decoded still',async({page})=>{
  await page.route('https://clouds.matteason.co.uk/**',r=>r.abort());
  await page.goto('/?refresh=1');
  await page.waitForFunction(()=>window.wallpaperHost?.getStatus().mode==='sleeping');
  expect(await page.locator('#rendererMount iframe').count()).toBe(0);
  await expect(page.locator('#snapshot')).toHaveJSProperty('complete',true);
  const src=await page.locator('#snapshot').getAttribute('src');expect(src.startsWith('data:image/jpeg')).toBe(true);
  await page.evaluate(()=>window.wallpaperHost.setRefreshMs(1000));
  await page.waitForFunction(()=>window.wallpaperHost.getStatus().mode==='loading');
  await page.evaluate(()=>window.wallpaperHost.setRefreshMs(900000));
  await page.waitForFunction(()=>window.wallpaperHost.getStatus().mode==='sleeping');
  expect(await page.locator('#rendererMount iframe').count()).toBe(0);
  expect(await page.locator('body').innerText()).not.toMatch(/Earth, now|DRAG TO ORBIT|SCROLL TO EXPLORE|One planet/);
});

test('a failed essential texture retains an actionable retry instead of a blank cached globe',async({page})=>{
  await page.route('**/assets/earth.jpg',r=>r.abort());
  await page.goto('/');
  await page.waitForFunction(()=>window.wallpaperHost?.getStatus().mode==='error');
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  expect(await page.locator('#rendererMount iframe').count()).toBe(0);
  await page.unroute('**/assets/earth.jpg');
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>window.wallpaperHost.getStatus().ready);
});
