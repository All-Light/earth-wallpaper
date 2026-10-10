import test from 'node:test';
import assert from 'node:assert/strict';
import {EARTH_HOME,OLD_NORTHERN_EUROPE_HOME,directionFromLatLon,isOldDefaultDirection,migrateHomeDirection,migrateSavedView} from '../src/home.js';

test('Rome is the shared geographic default',()=>{
  const expected=directionFromLatLon(41.9028,12.4964);
  assert.ok(Math.hypot(expected.x-EARTH_HOME.x,expected.y-EARTH_HOME.y,expected.z-EARTH_HOME.z)<1e-12);
  assert.ok(isOldDefaultDirection(OLD_NORTHERN_EUROPE_HOME));
});
test('migrates only the old default home and session camera, preserving radius and custom homes',()=>{
  assert.deepEqual(migrateHomeDirection(OLD_NORTHERN_EUROPE_HOME),EARTH_HOME);
  const radius=2.73, oldCamera={x:OLD_NORTHERN_EUROPE_HOME.x*radius,y:OLD_NORTHERN_EUROPE_HOME.y*radius,z:OLD_NORTHERN_EUROPE_HOME.z*radius};
  const migrated=migrateSavedView({camera:oldCamera,homeDirection:OLD_NORTHERN_EUROPE_HOME});
  assert.ok(Math.abs(Math.hypot(migrated.camera.x,migrated.camera.y,migrated.camera.z)-radius)<1e-12);
  assert.ok(Math.hypot(migrated.camera.x/radius-EARTH_HOME.x,migrated.camera.y/radius-EARTH_HOME.y,migrated.camera.z/radius-EARTH_HOME.z)<1e-12);
  const custom={x:1,y:0,z:0};
  assert.deepEqual(migrateHomeDirection(custom),custom);
  assert.deepEqual(migrateSavedView({camera:custom,homeDirection:custom}).homeDirection,custom);
});
