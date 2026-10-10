import test from 'node:test';
import assert from 'node:assert/strict';
import { ephemeris, cameraDirectionFromAngles, slerpDirection, createCameraReturnState } from '../src/astronomy.js';

test('subsolar point follows equinox and solstice seasons', () => {
  const eq = ephemeris(new Date('2024-03-20T03:06:00Z')).sun.subpoint.latitude;
  const june = ephemeris(new Date('2024-06-20T20:51:00Z')).sun.subpoint.latitude;
  const dec = ephemeris(new Date('2024-12-21T09:21:00Z')).sun.subpoint.latitude;
  assert.ok(Math.abs(eq) < 0.5, `equinox latitude ${eq}`);
  assert.ok(june > 23.0 && june < 24.0, `June solstice latitude ${june}`);
  assert.ok(dec < -23.0 && dec > -24.0, `December solstice latitude ${dec}`);
});

test('Sun and Moon retain physical distances and the Moon stays near its true angular scale', () => {
  const { sun, moon } = ephemeris(new Date('2024-04-08T18:00:00Z'));
  assert.ok(sun.distanceEarthRadii > 23000 && sun.distanceEarthRadii < 25000);
  assert.ok(moon.distanceEarthRadii > 55 && moon.distanceEarthRadii < 65);
  assert.ok(moon.angularRadius > 0.004 && moon.angularRadius < 0.0055);
  assert.ok(moon.radiusEarthRadii > 0.27 && moon.radiusEarthRadii < 0.28);
  assert.ok(moon.illumination < 0.02, `eclipse-date Moon illumination ${moon.illumination}`);
});

test('camera spherical angles can target the northern Europe home view', () => {
  const latitude = 60 * Math.PI / 180, longitude = 18 * Math.PI / 180;
  const direction = cameraDirectionFromAngles(Math.PI/2+longitude, Math.PI/2-latitude);
  assert.ok(Math.abs(direction.x-Math.cos(latitude)*Math.cos(longitude)) < 1e-12);
  assert.ok(Math.abs(direction.y-Math.sin(latitude)) < 1e-12);
  assert.ok(Math.abs(direction.z+Math.cos(latitude)*Math.sin(longitude)) < 1e-12);
});

test('antipodal camera return follows a safe great circle and preserves zoom radius', () => {
  const from = {x:1,y:0,z:0}, home = {x:-1,y:0,z:0}, radius = 3.7;
  let direction = from;
  for (const t of [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1]) {
    direction = slerpDirection(from, home, t);
    const cameraPosition = {x:direction.x*radius,y:direction.y*radius,z:direction.z*radius};
    assert.ok(Math.abs(Math.hypot(cameraPosition.x,cameraPosition.y,cameraPosition.z)-radius)<1e-12);
    assert.ok(Math.hypot(cameraPosition.x,cameraPosition.y,cameraPosition.z)>0);
  }
  assert.ok(direction.x < -0.999999);
});

test('idle return waits for a held drag to end and supports an explicit home request', () => {
  const state = createCameraReturnState(100);
  state.begin(20);
  assert.equal(state.shouldReturn(500), false);
  state.end(500);
  assert.equal(state.shouldReturn(599), false);
  assert.equal(state.shouldReturn(600), true);
  state.begin(610);
  state.request();
  assert.equal(state.shouldReturn(610), false);
  state.end(620);
  assert.equal(state.shouldReturn(620), true);
  state.complete(620);
  assert.equal(state.shouldReturn(621), false);
});
