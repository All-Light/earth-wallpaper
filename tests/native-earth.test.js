import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pendingHomeReturn } from '../native/astronomy-entry.js';
import { ephemeris } from '../src/astronomy.js';
import { directionFromLatLon } from '../src/home.js';

const shader = await readFile(new URL('../native/earth.frag', import.meta.url), 'utf8');
test('native shader includes physical Sun/Moon ray occlusion and geographic equirectangular mapping', () => {
  assert.match(shader, /hitSphere\(cameraPosition,ray,1\.0\)/);
  assert.match(shader, /moonDistance/);
  assert.match(shader, /sunOccluded/);
  assert.match(shader, /0\.5 - asin\(clamp\(n\.y/);
});
test('native astronomy vectors retain physical distances and Rome home direction', () => {
  const e = ephemeris(new Date('2026-03-20T12:00:00Z'));
  assert.ok(e.sun.distanceEarthRadii > 20000 && e.sun.distanceEarthRadii < 25000);
  assert.ok(e.moon.distanceEarthRadii > 50 && e.moon.distanceEarthRadii < 65);
  assert.ok(e.moon.illumination >= 0 && e.moon.illumination <= 1);
  const rome = directionFromLatLon(41.9028,12.4964);
  assert.ok(Math.abs(Math.hypot(rome.x,rome.y,rome.z)-1)<1e-12);
});

test('native idle waits for an enabled return, preserving long delays and zoom', () => {
  const home=directionFromLatLon(41.9028,12.4964);
  const away=directionFromLatLon(-30,-100);
  for(const delay of [20,45,90]) assert.equal(pendingHomeReturn(away,home,delay),true);
  assert.equal(pendingHomeReturn(away,home,0),false);
  assert.equal(pendingHomeReturn({x:home.x*4.4,y:home.y*4.4,z:home.z*4.4},home,90),false);
});
