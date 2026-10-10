import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = join(root, 'tmp', 'startup-benchmark');
const shortTemp = join(root, 'tmp', 'b');
process.env.TMPDIR = shortTemp;
const fastStart = process.argv.includes('--fast-start');
const gpuMode = process.argv.includes('--gpu');
const RUNS = gpuMode ? 1 : fastStart ? 2 : 3;
const outFile = join(root, 'work', gpuMode ? 'startup-benchmark-gpu.json' : fastStart ? 'startup-benchmark-fast.json' : 'startup-benchmark.json');
const chromePath = '/usr/bin/google-chrome';
const WIDTH = 1280, HEIGHT = 800, RUN_LIMIT_MS = 20_000;
const hr = () => Number(process.hrtime.bigint()) / 1e6;
const memInfo = readFileSync('/proc/meminfo', 'utf8');
const availableKb = Number(memInfo.match(/^MemAvailable:\s+(\d+)/m)?.[1] || 0);
if (availableKb < 3 * 1024 * 1024) throw new Error(`Aborting: only ${Math.round(availableKb / 1024)} MiB MemAvailable (need 3072 MiB).`);
if (!existsSync(chromePath)) throw new Error(`Required Chrome binary not found: ${chromePath}`);

async function freePort() {
  const s = createServer();
  await new Promise((ok, fail) => s.listen(0, '127.0.0.1', ok).once('error', fail));
  const port = s.address().port; await new Promise(ok => s.close(ok)); return port;
}
async function waitHttp(url, child, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Production server exited (${child.exitCode}).`);
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Production server did not answer at ${url}.`);
}
async function waitDevtools(port, child, ms = 5000) {
  const endpoint=`http://127.0.0.1:${port}/json/version`,until=Date.now()+ms;
  while(Date.now()<until){if(child.exitCode!==null)throw new Error(`Chrome exited (${child.exitCode}).`);try{const r=await fetch(endpoint);if(r.ok)return await r.json();}catch{}await new Promise(r=>setTimeout(r,25));}
  throw new Error(`Chrome DevTools did not answer at ${endpoint}.`);
}
function ownedPids(rootPid) {
  const parents = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      parents.set(Number(name), Number(rest[1]));
    } catch {}
  }
  const found = new Set([rootPid]); let changed = true;
  while (changed) { changed = false; for (const [pid, ppid] of parents) if (found.has(ppid) && !found.has(pid)) { found.add(pid); changed = true; } }
  return [...found];
}
function pssKb(pids) {
  let total = 0, available = false;
  for (const pid of pids) try {
    const value = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+) kB/m)?.[1];
    if (value) { total += Number(value); available = true; }
  } catch {}
  return available ? total : null;
}
async function waitExited(pids, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const remaining = pids.filter(pid => existsSync(`/proc/${pid}`));
    if (!remaining.length) return [];
    await new Promise(r => setTimeout(r, 50));
  }
  return pids.filter(pid => existsSync(`/proc/${pid}`));
}
function signalExactPids(pids) {
  for (const pid of [...pids].reverse()) try { process.kill(pid, 'SIGKILL'); } catch {}
}
async function makePrivateEnv(run) {
  const base = join(scratch, `run-${run}`);
  const dirs = Object.fromEntries(['config','cache','data','runtime','tmp'].map(name => [name, join(base, name)]));
  for (const dir of Object.values(dirs)) await mkdir(dir, {recursive:true, mode:0o700});
  const env = {...process.env,
    XDG_CONFIG_HOME:dirs.config, XDG_CACHE_HOME:dirs.cache, XDG_DATA_HOME:dirs.data,
    XDG_RUNTIME_DIR:dirs.runtime, TMPDIR:shortTemp,
    GTK_MODULES:'', GTK3_MODULES:'', GIO_USE_VFS:'local',
    DBUS_SESSION_BUS_ADDRESS:`unix:path=${join(dirs.runtime,'no-session-bus.sock')}`,
  };
  delete env.DISPLAY; delete env.WAYLAND_DISPLAY;
  return env;
}

await mkdir(shortTemp,{recursive:true,mode:0o700});
await rm(join(scratch,'profiles'),{recursive:true,force:true});
await rm(join(scratch,'disk-cache'),{recursive:true,force:true});
await mkdir(join(scratch,'profiles'),{recursive:true,mode:0o700});
await mkdir(join(scratch,'disk-cache'),{recursive:true,mode:0o700});
const port = await freePort();
const serveRoot = fastStart ? join(scratch,'fast-dist') : join(root,'dist');
if (fastStart) {
  await rm(serveRoot,{recursive:true,force:true}); await cp(join(root,'dist'),serveRoot,{recursive:true});
  const python = spawn('python3',['-c',`from PIL import Image\nfrom pathlib import Path\np=Path(${JSON.stringify(join(scratch,'fast-dist/assets'))})\nfor name in ['earth.jpg','earth-night.jpg','ocean-mask.jpg','clouds-alpha.png']:\n f=p/name\n im=Image.open(f); im.thumbnail((1024,512),Image.Resampling.LANCZOS); im.save(f,quality=82,optimize=True)\nf=p/'moon.jpg'; im=Image.open(f); im.thumbnail((512,256),Image.Resampling.LANCZOS); im.save(f,quality=82,optimize=True)`],{stdio:'inherit'});
  await new Promise((ok,fail)=>python.once('exit',code=>code===0?ok():fail(new Error('Pillow downsample failed'))));
}
const url = `http://127.0.0.1:${port}/`;
let appServer;
const results = [];
const median = values => { const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)]; };
function summarize(runs) {
  const successful=runs.filter(run=>!run.error);
  const warm=successful.filter(run=>run.run>1);
  const median=values=>{const a=[...values].sort((x,y)=>x-y);if(!a.length)return null;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
  const bytes=run=>(run.gpuFrame?.loadedAssets||[]).reduce((sum,a)=>sum+a.transferBytes,0);
  const total=successful.map(run=>run.totalFromPreLaunchMs);
  const ready=successful.map(run=>run.rendererReadyMs);
  return {completedRuns:successful.length,coldTotalMs:successful[0]?.totalFromPreLaunchMs??null,
    warmMedianTotalMs:warm.length?median(warm.map(run=>run.totalFromPreLaunchMs)):null,
    coldRendererReadyMs:successful[0]?.rendererReadyMs??null,
    warmMedianRendererReadyMs:warm.length?median(warm.map(run=>run.rendererReadyMs)):null,
    warmMedianGpuFinishMs:warm.length?median(warm.map(run=>run.gpuFinishMs)):null,
    coldAssetTransferBytes:successful[0]?bytes(successful[0]):null,
    warmAssetTransferBytes:warm.length?median(warm.map(bytes)):null,
    sub700ms:total.length===RUNS&&Math.max(...total)<700,
    bottleneck:ready.length?`Renderer readiness measured ${Math.min(...ready)}–${Math.max(...ready)} ms; browser launch/connect/navigation and forced GPU completion are separate.`:'No successful runs'};
}

async function writeResult(serverCleanup=null) { await writeFile(outFile,JSON.stringify({createdAt:new Date().toISOString(),variant:gpuMode?'single hardware-GPU baseline trial':fastStart?'fast-start temporary 1024px texture copy':'baseline production dist',environment:{chromePath,headless:true,angle:gpuMode?'Vulkan requested; verify actual renderer':'SwiftShader software',viewport:`${WIDTH}x${HEIGHT}`,runs:RUNS,runLimitMs:RUN_LIMIT_MS,memAvailableAtStartMiB:Math.round(availableKb/1024),displayUnset:true,privateXdgDirs:true,sharedDiskCache:true,cloudFeed:'bundled fallback; external weather host mapped to NOTFOUND; no request interception'},productionServer:{url,excludedFromTiming:true,cleanupConfirmed:serverCleanup},summary:summarize(results),runs:results},null,2)+'\n'); }
try {
  appServer = createHttpServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,url).pathname);let path=join(serveRoot,normalize(pathname).replace(/^[/\\]+/,''));let info=await stat(path);if(info.isDirectory()){path=join(path,'index.html');info=await stat(path);}const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.json':'application/json'};res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':extname(path)==='.html'?'no-cache':'public,max-age=3600','Content-Length':info.size});createReadStream(path).pipe(res);}catch{res.writeHead(404);res.end('Not found');}});
  await new Promise((ok,fail)=>appServer.listen(port,'127.0.0.1',ok).once('error',fail));
  await waitHttp(url, {get exitCode(){return null;}});
  await readFile(join(root,'public','assets','clouds-alpha.png')); // Confirm bundled fallback exists; external weather DNS is disabled in Chrome.

  for (let i = 1; i <= RUNS; i++) {
    const env = await makePrivateEnv(i);
    const profile=join(scratch,'profiles',i===1?'cold':'warm');
    await mkdir(profile,{recursive:true,mode:0o700});
    const remotePort=await freePort();
    const runStart = hr(); let chromeProcess, browser, page, timeoutId, chromeLogs='';
    let rootPid = null, pids = [], memoryPssKb = null;
    const result = {run:i,cacheState:i===1?'cold profile / private disk cache':'warm shared private disk cache'};
    try {
      const run = (async() => {
        const launchStart = hr();
        chromeProcess=spawn(chromePath,[
          '--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check',
          ...(gpuMode?['--enable-gpu','--use-gl=angle','--use-angle=vulkan','--disable-software-rasterizer']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']), '--disable-dev-shm-usage',
          '--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--host-resolver-rules=MAP clouds.matteason.co.uk ~NOTFOUND',
          `--remote-debugging-port=${remotePort}`,`--user-data-dir=${profile}`,
          `--disk-cache-dir=${join(scratch,'disk-cache')}`,`--window-size=${WIDTH},${HEIGHT}`,'--force-device-scale-factor=1','about:blank',
        ],{cwd:root,env,stdio:['ignore','pipe','pipe']});
        chromeProcess.stdout.on('data',b=>{chromeLogs+=b.toString().slice(0,2000);});
        chromeProcess.stderr.on('data',b=>{chromeLogs+=b.toString().slice(0,10000);});
        rootPid=chromeProcess.pid;
        await waitDevtools(remotePort,chromeProcess,5000);
        result.browserLaunchMs=+(hr()-launchStart).toFixed(1);
        const connectStart=hr(); browser=await chromium.connectOverCDP(`http://127.0.0.1:${remotePort}`);
        result.browserConnectMs=+(hr()-connectStart).toFixed(1);
        const context=browser.contexts()[0];
        if(!context)throw new Error('Chrome default persistent context unavailable');
        result.context='persistent Chrome profile';
        page=await context.newPage(); await page.setViewportSize({width:WIDTH,height:HEIGHT});
        const navigationStart=hr(); await page.goto(url,{waitUntil:'domcontentloaded',timeout:RUN_LIMIT_MS});
        result.navigationMs=+(hr()-navigationStart).toFixed(1);
        const readyStart=hr(); await page.waitForFunction(()=>window.wallpaperHost?.getStatus().ready,{timeout:RUN_LIMIT_MS});
        result.rendererReadyMs=+(hr()-readyStart).toFixed(1);
        const gpuStart=hr();
        const browserCdp=await browser.newBrowserCDPSession();
        try { const systemInfo=await browserCdp.send('SystemInfo.getInfo'); result.cdpGpu={devices:systemInfo.gpu?.devices||[],featureStatus:systemInfo.gpu?.featureStatus||{},auxAttributes:systemInfo.gpu?.auxAttributes||{}}; } catch(e) { result.cdpGpuError=String(e?.message||e); }
        result.gpuFrame=await page.frames().find(frame=>frame.url().endsWith('/renderer.html')).evaluate(()=>{
          const canvas=document.querySelector('#earth');
          const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
          if(!gl)throw new Error('Renderer WebGL context unavailable after READY');
          const debug=gl.getExtension('WEBGL_debug_renderer_info'); const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
          const finishStart=performance.now(); gl.finish(); const finishMs=performance.now()-finishStart;
          const loaded=performance.getEntriesByType('resource').filter(e=>e.name.includes('/assets/'));
          return {width:canvas.width,height:canvas.height,webglRenderer:renderer,glFinishMs:+finishMs.toFixed(1),loadedAssets:loaded.map(e=>({name:new URL(e.name).pathname.split('/').pop(),durationMs:+e.duration.toFixed(1),transferBytes:e.transferSize||0,decodedBytes:e.decodedBodySize||0}))};
        });
        result.gpuRenderer=result.gpuFrame.webglRenderer;
        result.hardwareRendererAccepted=!!gpuMode&&!/swiftshader|llvmpipe|software raster|angle.*software/i.test(result.gpuRenderer||'')&&!!(result.cdpGpu?.devices||[]).some(d=>d.deviceString&&!/swiftshader|llvmpipe|software/i.test(d.deviceString));
        result.gpuFinishMs=result.gpuFrame.glFinishMs;
        result.gpuCdpOverheadMs=+Math.max(0,(hr()-gpuStart)-result.gpuFinishMs).toFixed(1);
        result.totalFromPreLaunchMs=+(hr()-runStart).toFixed(1);
        result.pageReadyFromNavigationMs=+(hr()-navigationStart).toFixed(1);
        pids=ownedPids(rootPid); memoryPssKb=pssKb(pids);
        result.processesAtReady=pids.length; result.processPssKb=memoryPssKb;
      })();
      await Promise.race([run,new Promise((_,reject)=>{timeoutId=setTimeout(()=>reject(new Error(`Run ${i} exceeded ${RUN_LIMIT_MS} ms`)),RUN_LIMIT_MS);})]);
    } catch (error) { result.error=String(error?.message||error); }
    finally {
      clearTimeout(timeoutId);
      if (!pids.length && rootPid) pids=ownedPids(rootPid);
      const exitStart=hr();
      try { await browser?.close(); } catch {}
      try { if(chromeProcess?.exitCode===null)chromeProcess.kill('SIGTERM'); } catch {}
      let remaining=await waitExited(pids,1500);
      if (remaining.length) { signalExactPids(remaining); remaining=await waitExited(remaining,1000); }
      result.browserExitMs=+(hr()-exitStart).toFixed(1);
      result.ownedBrowserPids=pids; result.ownedProcessesExited=remaining.length===0; result.remainingOwnedPids=remaining;
      if (result.error && !result.processPssKb && memoryPssKb) result.processPssKb=memoryPssKb;
      if(result.error&&chromeLogs)result.chromeLogExcerpt=chromeLogs.slice(-6000);
      results.push(result);
      await writeResult();
      console.log(JSON.stringify(result));
      if (!result.ownedProcessesExited) throw new Error(`Owned Chrome processes remain after run ${i}: ${remaining.join(',')}`);
      if (result.error) throw new Error(`Run ${i} failed: ${result.error}${chromeLogs ? `\nChrome: ${chromeLogs}` : ''}`);
      if (i < RUNS) await new Promise(r=>setTimeout(r,250));
    }
  }
} finally {
  let serverCleanup=true; try { if(appServer?.listening) await new Promise((ok,fail)=>appServer.close(e=>e?fail(e):ok())); } catch { serverCleanup=false; }
  await writeResult(serverCleanup);
}
