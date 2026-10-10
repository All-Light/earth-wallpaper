import * as THREE from 'three';
import { orbitSpeed, sphereBlocksRay } from './view-math.js';
import { EARTH_HOME } from './home.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ephemeris, cameraDirectionFromAngles, slerpDirection, createCameraReturnState } from './astronomy.js';
import { makeEarthMaterial, makeCloudMaterial, makeAtmosphereMaterial } from './materials.js';

const canvas = document.querySelector('#earth');
const errorBox = document.querySelector('#error');
const defaults = { clouds: true, clock: true, stars: true, returnDelay: 20, quality: 'balanced' };
let settings = { ...defaults };

let renderer, scene, camera, controls, earth, cloud, atmosphere, sunSprite, sunGlow, moon, stars, sunLight;
let frameCount=0, fpsTime=performance.now(), isReturning=false, cloudTexture=null, cloudTextureKind='none', cloudTextureReady=false;
let disposed=false;
let lastRenderedAt=0, nextEphemerisAt=0,pointerActive=false,lastStatusAt=0;
const qualitySettings = { high:{pixelRatio:2,fps:30}, balanced:{pixelRatio:1.4,fps:24}, low:{pixelRatio:1,fps:15} };
let maxDpr = qualitySettings[settings.quality].pixelRatio;
const returnState = createCameraReturnState(settings.returnDelay * 1000);
const homeDirection = {...EARTH_HOME};

function init() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr)); renderer.setSize(innerWidth,innerHeight); renderer.setClearColor(0x010204,1);
    scene=new THREE.Scene(); scene.background=new THREE.Color('#010204');
    camera=new THREE.PerspectiveCamera(37,innerWidth/innerHeight,.1,50000);
    const europe = new THREE.Vector3(EARTH_HOME.x, EARTH_HOME.y, EARTH_HOME.z);
    camera.position.copy(europe).multiplyScalar(3.8);
    controls=new OrbitControls(camera,canvas); controls.enableDamping=true; controls.dampingFactor=.055; controls.minDistance=1.55; controls.maxDistance=4.4; controls.enablePan=false; controls.rotateSpeed=.36;
    controls.target.set(0,0,0);
    controls.addEventListener('start',()=>{returnState.begin(performance.now());isReturning=false;pointerActive=true;notify('INTERACTION');});
    controls.addEventListener('end',()=>{returnState.end(performance.now());pointerActive=false;notify('INTERACTION_END');});
    canvas.addEventListener('pointerdown',()=>{returnState.begin(performance.now());isReturning=false;});
    window.addEventListener('pointerup',()=>{if(returnState.isActive)returnState.end(performance.now());});
    canvas.addEventListener('wheel',()=>{returnState.noteInput(performance.now());isReturning=false;notify('INTERACTION');},{passive:true});
    earth=new THREE.Mesh(new THREE.SphereGeometry(1,128,96),makeEarthMaterial()); scene.add(earth);
    cloud=new THREE.Mesh(new THREE.SphereGeometry(1.002,128,96),makeCloudMaterial(earth.material.uniforms.uSun));
    cloud.visible=false; cloud.renderOrder=1; scene.add(cloud);
    atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.035,128,96),makeAtmosphereMaterial(earth.material.uniforms.uSun));
    atmosphere.renderOrder=2; scene.add(atmosphere);
    const sunGeo=new THREE.SphereGeometry(696000/6371,24,16); sunSprite=new THREE.Mesh(sunGeo,new THREE.MeshBasicMaterial({color:0xffd9a2})); scene.add(sunSprite);
    const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=256;const gc=glowCanvas.getContext('2d');const gradient=gc.createRadialGradient(128,128,2,128,128,128);gradient.addColorStop(0,'rgba(255,225,180,.52)');gradient.addColorStop(.12,'rgba(255,190,125,.28)');gradient.addColorStop(1,'rgba(255,155,90,0)');gc.fillStyle=gradient;gc.fillRect(0,0,256,256);sunGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(glowCanvas),color:0xffd7a6,transparent:true,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false}));scene.add(sunGlow);
    sunLight=new THREE.DirectionalLight(0xffffff,2.3); sunLight.userData.celestialLight=true; scene.add(sunLight);
    moon=new THREE.Mesh(new THREE.SphereGeometry(1737.4/6371,48,32),new THREE.MeshStandardMaterial({color:0xb4b4ad,roughness:1,metalness:0})); scene.add(moon);
    const starGeo=new THREE.BufferGeometry(), pos=[], directions=[];
    for(let i=0;i<2200;i++){const dec=Math.asin(Math.random()*2-1),ra=Math.random()*Math.PI*2,r=Math.cos(dec);directions.push(r*Math.cos(ra),r*Math.sin(ra),Math.sin(dec));pos.push(0,0,0);}
    starGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));starGeo.userData.equatorialDirections=directions;
    stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xa8bfdc,size:1.1,sizeAttenuation:false,transparent:true,opacity:.68}));scene.add(stars);
    loadLocalAssets().then(()=>{if(disposed)return;updateEphemeris();renderer.render(scene,camera);notify('READY');}).catch(()=>showError('Earth imagery could not load. Please retry.')); updateEphemeris(); onResize(); addEventListener('resize',onResize);
    document.addEventListener('visibilitychange',onVisibilityChanged);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();if(disposed)return;renderer.setAnimationLoop(null);showError('Graphics context lost. Waiting for the browser to restore WebGL…');});
    canvas.addEventListener('webglcontextrestored',()=>{errorBox.hidden=true;nextEphemerisAt=0;lastRenderedAt=0;renderer.setAnimationLoop(document.hidden?null:render);});
    renderer.setAnimationLoop(document.hidden?null:render);

  } catch (error) { showError('WebGL could not start. Enable hardware acceleration in the browser settings.'); console.error(error); }
}

async function loadLocalAssets(){
  const loader=new THREE.TextureLoader();
  const tune=t=>{t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());t.wrapS=THREE.RepeatWrapping;return t;};
  const load=(url,apply,color=false)=>loader.loadAsync(url).then(t=>{if(disposed){t.dispose();return;}if(color)t.colorSpace=THREE.SRGBColorSpace;apply(tune(t));});
  const surface=load('/assets/earth.jpg',t=>{earth.material.uniforms.uTexture.value=t;earth.material.uniforms.uHasTexture.value=1;},true);
  const optional=[
    load('/assets/ocean-mask.jpg',t=>earth.material.uniforms.uOcean.value=t),
    load('/assets/moon.jpg',t=>{moon.material.map=t;moon.material.needsUpdate=true;},true),
    load('/assets/earth-night.jpg',t=>earth.material.uniforms.uNight.value=t,true),
    load('/assets/clouds-alpha.png',t=>setCloudTexture(t,'bundled','Bundled cloud snapshot'))
  ];
  await Promise.all([surface,Promise.allSettled(optional),loadLiveClouds()]);
}
function setCloudStatus(message){notify('CLOUD_STATUS',{message});}
function setCloudTexture(texture,kind,status){
  if(disposed){texture.dispose();return;}
  if(kind==='bundled'&&cloudTextureKind==='live'){texture.dispose();return;}
  if(cloudTexture&&cloudTexture!==texture)cloudTexture.dispose();
  texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  cloudTexture=texture;cloudTextureKind=kind;cloudTextureReady=true;
  earth.material.uniforms.uCloud.value=texture;earth.material.uniforms.uCloudOn.value=settings.clouds?1:0;
  cloud.material.uniforms.uCloud.value=texture;cloud.visible=settings.clouds;
  setCloudStatus(status || (kind==='bundled'?'Bundled image loaded · observation time unavailable':'Cloud image loaded'));
}
async function loadLiveClouds(){
  const url='https://clouds.matteason.co.uk/images/4096x2048/clouds-alpha.png',cacheKey='/earth-wallpaper/live-clouds.png',cacheName='earth-wallpaper-clouds-v1';let cache=null,stored=null;
  try{if('caches'in window){cache=await caches.open(cacheName);stored=await cache.match(cacheKey);}}catch{}
  const fetchedAt=(()=>{try{return Number(localStorage.getItem('earth-clouds-fetched-at'))||0;}catch{return 0;}})();
  const useBlob=(blob,kind,status)=>{const objectUrl=URL.createObjectURL(blob);new THREE.TextureLoader().load(objectUrl,t=>{URL.revokeObjectURL(objectUrl);setCloudTexture(t,kind,status);},undefined,()=>{URL.revokeObjectURL(objectUrl);setCloudStatus('Cloud image could not be decoded · preference retained');});};
  if(stored){try{const lastModified=stored.headers.get('Last-Modified'),date=lastModified?new Date(lastModified):null;const status=date&&!Number.isNaN(date.valueOf())?`Cached source image · modified ${date.toLocaleString()}`:`Cached cloud image · retrieved ${fetchedAt?new Date(fetchedAt).toLocaleString():'date unavailable'}`;useBlob(await stored.blob(),'live',status);}catch{}}
  if(stored&&fetchedAt&&Date.now()-fetchedAt<60*60*1000){if(!stored)setCloudStatus('Cloud cache unavailable · bundled image active');return;}
  try{const response=await fetch(url,{mode:'cors',cache:'no-cache',signal:AbortSignal.timeout(6000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const modified=response.headers.get('Last-Modified'),cacheCopy=response.clone(),blob=await response.blob();try{await cache?.put(cacheKey,cacheCopy);}catch{}try{localStorage.setItem('earth-clouds-fetched-at',String(Date.now()));}catch{}const date=modified?new Date(modified):null;const status=date&&!Number.isNaN(date.valueOf())?`Source modified ${date.toLocaleString()} · retrieved ${new Date().toLocaleString()}`:`Retrieved ${new Date().toLocaleString()} · observation time unavailable`;useBlob(blob,'live',status);}catch{setCloudStatus(cloudTextureReady?`${cloudTextureKind==='live'?'Cached live image':'Bundled clouds'} · refresh failed`:'Clouds unavailable · preference retained');}
}
function updateEphemeris(){
  const e=ephemeris(new Date()); const sun=new THREE.Vector3(e.sun.x,e.sun.y,e.sun.z); const moonDir=new THREE.Vector3(e.moon.x,e.moon.y,e.moon.z);
  earth.material.uniforms.uSun.value.copy(sun); sunSprite.position.copy(sun).multiplyScalar(e.sun.distanceEarthRadii); moon.position.copy(moonDir).multiplyScalar(e.moon.distanceEarthRadii);
  sunLight.position.copy(sun).multiplyScalar(50);
  moon.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),moonDir.clone().negate());
  const starPositions=stars.geometry.attributes.position,dirs=stars.geometry.userData.equatorialDirections,c=Math.cos(e.siderealAngle),s=Math.sin(e.siderealAngle);
  for(let i=0;i<dirs.length;i+=3){const x=dirs[i],y=dirs[i+1],z=dirs[i+2];starPositions.setXYZ(i/3,25000*(c*x+s*y),25000*z,25000*(s*x-c*y));}
  starPositions.needsUpdate=true;
  window.__earth={ephemeris:e,camera,controls,renderer,scene,homeDirection,sunPosition:sunSprite.position,moonPosition:moon.position,settings};
  sunGlow.position.copy(sunSprite.position);const glowSize=e.sun.distanceEarthRadii*.05;sunGlow.scale.set(glowSize,glowSize,1);
  nextEphemerisAt=performance.now()+5000;
}
function applySettings(next={}){settings={...settings,...next};maxDpr=qualitySettings[settings.quality]?.pixelRatio||1.4;if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,maxDpr));lastRenderedAt=0;}if(stars)stars.visible=!!settings.stars;if(cloud){cloud.visible=cloudTextureReady&&!!settings.clouds;if(earth)earth.material.uniforms.uCloudOn.value=cloudTextureReady&&settings.clouds?1:0;}returnState.setDelay(settings.returnDelay*1000);isReturning=false;returnState.complete(performance.now());return settings;}
function notify(type,detail={}){try{parent.postMessage({channel:'earth-wallpaper',type,detail},location.origin);}catch{}}
function getState(){return {camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z},homeDirection:{...homeDirection},settings:{...settings}};}
function restoreState(state={}){if(state.camera){const p=state.camera;if([p.x,p.y,p.z].every(Number.isFinite)){camera.position.set(p.x,p.y,p.z);if(camera.position.length()<.001)camera.position.set(3.8,0,0);camera.position.setLength(THREE.MathUtils.clamp(camera.position.length(),1.55,4.4));}camera.lookAt(0,0,0);controls.update();}applySettings(state.settings||{});if(state.homeDirection){homeDirection.x=state.homeDirection.x;homeDirection.y=state.homeDirection.y;homeDirection.z=state.homeDirection.z;}return getState();}
function orbitByPixels(dx,dy){returnState.noteInput(performance.now());isReturning=false;controls.rotateSpeed=orbitSpeed(camera.position.length());const scale=2*Math.PI/Math.max(1,innerHeight),spherical=new THREE.Spherical().setFromVector3(camera.position);spherical.theta-=dx*scale*controls.rotateSpeed;spherical.phi-=dy*scale*controls.rotateSpeed;spherical.phi=THREE.MathUtils.clamp(spherical.phi,.01,Math.PI-.01);camera.position.setFromSpherical(spherical);camera.lookAt(0,0,0);controls.update();}
function zoomBy(deltaY){returnState.noteInput(performance.now());isReturning=false;camera.position.multiplyScalar(Math.exp(deltaY*.001));const r=THREE.MathUtils.clamp(camera.position.length(),controls.minDistance,controls.maxDistance);camera.position.setLength(r);camera.lookAt(0,0,0);controls.update();}
function requestHome(direction=homeDirection){homeDirection.x=direction.x;homeDirection.y=direction.y;homeDirection.z=direction.z;isReturning=true;returnState.request();}
function capture(){renderer.render(scene,camera);const output=document.createElement('canvas'),scale=Math.min(1,1920/Math.max(canvas.width,canvas.height));output.width=Math.round(canvas.width*scale);output.height=Math.round(canvas.height*scale);output.getContext('2d').drawImage(canvas,0,0,output.width,output.height);return output.toDataURL('image/jpeg',.88);}
function shutdown(){disposed=true;renderer.setAnimationLoop(null);controls.dispose();removeEventListener('resize',onResize);document.removeEventListener('visibilitychange',onVisibilityChanged);scene.traverse(o=>{o.geometry?.dispose?.();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats)if(m){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose?.();}});renderer.dispose();renderer.forceContextLoss();}
window.earthRenderer={getState,getStatus:()=>({frameCount,isReturning,pointerActive,pendingReturn:settings.returnDelay>0&&camera.position.clone().normalize().dot(new THREE.Vector3(homeDirection.x,homeDirection.y,homeDirection.z))<.999999}),restoreState,applySettings,orbitByPixels,zoomBy,requestHome,setHome:direction=>{Object.assign(homeDirection,direction);isReturning=false;returnState.complete(performance.now());},capture,shutdown};
function onVisibilityChanged(){if(document.hidden){renderer.setAnimationLoop(null);return;}lastRenderedAt=0;fpsTime=performance.now();frameCount=0;updateEphemeris();renderer.setAnimationLoop(render);}
function onResize(){if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(37/2))/Math.min(1,camera.aspect)));camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
function showError(message){errorBox.textContent=message;errorBox.hidden=false;notify('ERROR',{message});}

function render(){
  const now=performance.now();
  const frameInterval=1000/qualitySettings[settings.quality].fps;
  if(lastRenderedAt&&now-lastRenderedAt<frameInterval)return;
  const elapsed=lastRenderedAt?Math.min((now-lastRenderedAt)/1000,.25):0;lastRenderedAt=now;
  controls.update();
  if(!isReturning&&returnState.shouldReturn(now))isReturning=true;
  if(isReturning){
    const radius=camera.position.length(),direction=slerpDirection(camera.position,homeDirection,1-Math.exp(-elapsed*.32));
    camera.position.set(direction.x*radius,direction.y*radius,direction.z*radius);camera.lookAt(0,0,0);
    if(1-(direction.x*homeDirection.x+direction.y*homeDirection.y+direction.z*homeDirection.z)<1e-7){camera.position.set(homeDirection.x*radius,homeDirection.y*radius,homeDirection.z*radius);camera.lookAt(0,0,0);isReturning=false;returnState.complete(now);controls.update();}
  }
  earth.material.uniforms.uTime.value+=elapsed;
  if(now>=nextEphemerisAt)updateEphemeris();
  const distance=camera.position.length();controls.rotateSpeed=orbitSpeed(distance);
  sunGlow.visible=!sphereBlocksRay(camera.position,sunSprite.position,{x:0,y:0,z:0},1)&&!sphereBlocksRay(camera.position,sunSprite.position,moon.position,1737.4/6371);
  renderer.render(scene,camera);frameCount++;if(now-lastStatusAt>1000){lastStatusAt=now;notify('FRAME',{frameCount});}
}
init();
