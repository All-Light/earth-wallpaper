import { EARTH_HOME, isOldDefaultDirection, migrateHomeDirection, migrateSavedView, normalizeDirection } from './home.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const native = new URLSearchParams(location.search).has('native');
const defaults = { clouds: true, clock: true, stars: true, returnDelay: 20, quality: 'balanced' };
const readJSON = (store, key, fallback) => { try { return JSON.parse(store.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJSON = (store, key, value) => { try { store.setItem(key, JSON.stringify(value)); } catch {} };
function validSettings(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { ...defaults, ...Object.fromEntries(['clouds','clock','stars'].map(k=>[k, typeof v[k] === 'boolean' ? v[k] : defaults[k]])),
    quality: ['high','balanced','low'].includes(v.quality) ? v.quality : 'balanced',
    returnDelay: [0,20,45,90].includes(v.returnDelay) ? v.returnDelay : 20 };
}

let settings = validSettings(readJSON(localStorage,'earth-now-settings-v1',defaults));
const storedHome = readJSON(localStorage,'earth-now-home-v1',EARTH_HOME);
let home = migrateHomeDirection(storedHome);
const storedState = readJSON(sessionStorage,'earth-wallpaper-state',null);
let savedState = storedState ? migrateSavedView(storedState,home) : {camera:{x:home.x*3.8,y:home.y*3.8,z:home.z*3.8},homeDirection:home,settings};
if (isOldDefaultDirection(storedHome)) writeJSON(localStorage,'earth-now-home-v1',home);
if (storedState && isOldDefaultDirection(storedState.homeDirection)) writeJSON(sessionStorage,'earth-wallpaper-state',savedState);
let frame = null, api = null, mode = 'sleeping', ready = false, generation = 0;
let idleMs = 45000, refreshMs = 900000, idleTimer = 0, refreshTimer = 0, loadTimer = 0;
let lastInteraction = Date.now(), frameCount = 0, pointer = null, externalDrag = false, refreshLoad = false;
let pendingHomeSave = false;
let queued = [], settingsOpen = false, snapshotReady = false;
const status = message => $('#status').textContent = message;
const canSleep = () => !!frame && ready && !pointer && !externalDrag && !settingsOpen && !api?.getStatus().isReturning && !api?.getStatus().pendingReturn && !api?.getStatus().pointerActive;
function updateClock() {
  $('#clock').hidden = native || !settings.clock;
  if ($('#clock').hidden) return;
  const date = new Date();
  $('#time').textContent = date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});
  $('#date').textContent = date.toLocaleDateString([], {weekday:'long',day:'numeric',month:'long'});
}
function updateControls() {
  for (const key of ['clouds','clock','stars']) $(`#${key === 'clouds' ? 'cloud' : key}Toggle`).checked = settings[key];
  $('#quality').value = settings.quality; $('#returnDelay').value = String(settings.returnDelay);
}
function persist() { writeJSON(localStorage,'earth-now-settings-v1',settings); writeJSON(localStorage,'earth-now-home-v1',home); }
function getState() { return {...(api?.getState() || savedState),settings:{...settings},homeDirection:{...home}}; }
function saveState() { savedState = getState(); writeJSON(sessionStorage,'earth-wallpaper-state',savedState); }
function restoreState(state) {
  if (!state || typeof state !== 'object') return;
  state = migrateSavedView(state,home);
  if (state.settings) settings = validSettings(state.settings);
  if (state.homeDirection) home = migrateHomeDirection(state.homeDirection);
  if (state.camera && [state.camera.x,state.camera.y,state.camera.z].every(Number.isFinite)) savedState = {...state,homeDirection:home,settings};
  persist(); saveWithoutRenderer(); api?.restoreState(savedState); updateControls(); updateClock();
}
function saveWithoutRenderer() { writeJSON(sessionStorage,'earth-wallpaper-state',savedState); }
function scheduleIdle(delay = idleMs) {
  clearTimeout(idleTimer);
  if (!frame) return;
  idleTimer = setTimeout(()=>{ if (canSleep()) void sleep(); else scheduleIdle(1000); }, delay);
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(()=>{ if (mode === 'sleeping') wake({refresh:true}); scheduleRefresh(); },refreshMs);
}
function touch() {
  lastInteraction = Date.now(); refreshLoad = false;
  if (mode === 'capturing') { generation++; mode = 'awake'; }
  restoreChrome(); scheduleIdle();
}
function disposeFrame() {
  clearTimeout(loadTimer); clearTimeout(idleTimer);
  try { api?.shutdown(); } catch {}
  frame?.remove(); frame = null; api = null; ready = false;
}
async function sleep() {
  if (!canSleep()) return false;
  const ticket = ++generation;
  mode = 'capturing';
  try {
    const data = api.capture();
    const decoded = new Image(); decoded.src = data; await decoded.decode();
    if (ticket !== generation || !canSleep()) { if(mode === 'capturing') mode = 'awake'; return false; }
    saveState();
    $('#snapshot').src = data; snapshotReady = true; $('#snapshot').hidden = false;
    disposeFrame(); mode = 'sleeping'; $('#gestureSurface').hidden = false; status('Sleeping · refreshes every 15 minutes');
    return true;
  } catch {
    if (ticket === generation) { mode = 'awake'; status('Snapshot failed · live view retained'); scheduleIdle(10000); }
    return false;
  }
}
function wake({refresh = false} = {}) {
  if (frame) { if (!refresh) touch(); return; }
  generation++; refreshLoad = refresh; mode = 'loading'; ready = false;
  $('#error').hidden = true; status(refresh ? 'Refreshing…' : 'Waking…');
  const element = document.createElement('iframe');
  element.title = 'Live Earth renderer'; element.src = '/renderer.html';
  frame = element; $('#rendererMount').append(element);
  // Keep the previous still visible until the new globe really has its textures.
  $('#snapshot').hidden = !snapshotReady; $('#gestureSurface').hidden = false;
  loadTimer = setTimeout(()=>fail('Renderer did not start. Use Retry to try again.'),25000);
}
function fail(message) {
  if (api) saveState(); disposeFrame(); generation++; mode = 'error';
  $('#snapshot').hidden = !snapshotReady; $('#gestureSurface').hidden = false;
  $('#error').hidden = false; $('#errorMessage').textContent = message; status('Renderer unavailable');
}
function applyGesture(gesture) {
  if (!ready || !api) { queued.push(gesture); return; }
  if (gesture.type === 'wheel') api.zoomBy(gesture.y);
  else api.orbitByPixels(gesture.x,gesture.y);
}
function orbit(dx,dy) { touch(); wake(); applyGesture({type:'orbit',x:dx,y:dy}); }
function zoom(delta) { touch(); wake(); applyGesture({type:'wheel',y:delta}); }
window.addEventListener('message', event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== 'earth-wallpaper') return;
  const {type,detail} = event.data;
  if (type === 'READY') {
    clearTimeout(loadTimer);
    try {
      api = frame.contentWindow.earthRenderer;
      api.restoreState({...savedState,settings,homeDirection:home});
      ready = true; mode = 'awake'; $('#snapshot').hidden = true;
      $('#gestureSurface').hidden = !pointer;
      status('Live'); if(pendingHomeSave){pendingHomeSave=false;saveHome();} const actions = queued; queued = []; actions.forEach(applyGesture);
      if (refreshLoad) { refreshLoad = false; scheduleIdle(200); } else scheduleIdle();
    } catch { fail('Renderer could not initialize. Use Retry to try again.'); }
  } else if (type === 'CLOUD_STATUS') $('#cloudStatus').textContent = detail.message;
  else if (type === 'INTERACTION') { touch(); clearTimeout(idleTimer); }
  else if (type === 'INTERACTION_END') touch();
  else if (type === 'FRAME') frameCount = detail.frameCount;
  else if (type === 'ERROR') fail(detail.message || 'Graphics unavailable. Use Retry to try again.');
});
const surface = $('#gestureSurface');
surface.addEventListener('pointerdown',event=>{
  if (event.button !== 0) return;
  pointer = {x:event.clientX,y:event.clientY,id:event.pointerId}; surface.setPointerCapture(event.pointerId); touch(); wake();
});
surface.addEventListener('pointermove',event=>{
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y;
  pointer.x = event.clientX; pointer.y = event.clientY;
  if (dx || dy) orbit(dx,dy);
});
function release() { pointer = null; surface.hidden = ready; touch(); }
surface.addEventListener('pointerup',release); surface.addEventListener('pointercancel',release);
surface.addEventListener('wheel',event=>{event.preventDefault(); zoom(event.deltaY);},{passive:false});
function openSettings() { settingsOpen = true; $('#panel').hidden = false; $('#menuButton').setAttribute('aria-expanded','true'); touch(); wake(); }
function closeSettings() { settingsOpen = false; $('#panel').hidden = true; $('#menuButton').setAttribute('aria-expanded','false'); touch(); }
$('#menuButton').onclick = openSettings; $('#closePanel').onclick = closeSettings; $('#retryButton').onclick = ()=>wake();
function applySettings(next) {
  settings = validSettings({...settings,...next}); persist(); api?.applySettings(settings); updateControls(); updateClock(); touch();
}
for (const key of ['clouds','clock','stars']) $(`#${key === 'clouds' ? 'cloud' : key}Toggle`).onchange = event=>applySettings({[key]:event.target.checked});
$('#returnDelay').onchange = event=>applySettings({returnDelay:Number(event.target.value)});
$('#quality').onchange = event=>applySettings({quality:event.target.value});
function saveHome() { if (!ready) { pendingHomeSave = true; wake(); return; } home = normalizeDirection(api.getState().camera); persist(); api.setHome(home); saveState(); status('Return location saved'); }
function resetHome() { home = {...EARTH_HOME}; persist(); savedState.homeDirection = home; api?.requestHome(home); saveState(); touch(); }
$('#saveHome').onclick = saveHome; $('#resetHome').onclick = resetHome;
function prepareCapture() { document.documentElement.classList.add('capturing'); }
function restoreChrome() { document.documentElement.classList.remove('capturing'); }
window.addEventListener('keydown',event=>{
  if (event.key === 'Escape') closeSettings();
  if (event.target.matches('input,select,button')) return;
  if (event.key.toLowerCase() === 'h') $('#app').classList.toggle('minimal');
  if (event.key.toLowerCase() === 'f') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }
});
window.wallpaperHost = {
  getStatus:()=>({mode,ready,frameCount,lastInteraction,canSleep:canSleep(),iframePresent:!!frame,snapshotReady}),
  getState,restoreState,wake,sleep,prepareCapture,restoreChrome,applySettings,openSettings,orbit,zoom,
  beginDrag:()=>{externalDrag=true;touch();wake();},endDrag:()=>{externalDrag=false;touch();},
  setIdleMs:value=>{idleMs=Math.max(100,Number(value));scheduleIdle();},
  setRefreshMs:value=>{refreshMs=Math.max(100,Number(value));scheduleRefresh();},saveHome,resetHome,
};
updateControls(); updateClock();
if (!native) setInterval(updateClock,60000);
if (!native || new URLSearchParams(location.search).has('refresh')) wake({refresh:new URLSearchParams(location.search).has('refresh')});
if (!native) scheduleRefresh();
