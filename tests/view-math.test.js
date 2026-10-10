import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orbitSpeed,sphereBlocksRay} from '../src/view-math.js';
test('orbit angular speed follows altitude above the surface',()=>{
  assert.ok(Math.abs(orbitSpeed(2.4)/orbitSpeed(3.8)-.5)<1e-10);
  assert.ok(orbitSpeed(1.55)<orbitSpeed(2.4));
});
test('sun halo is occluded by foreground Earth and Moon, not background bodies',()=>{
  const camera={x:0,y:0,z:4},sun={x:0,y:0,z:-23000};
  assert.equal(sphereBlocksRay(camera,sun,{x:0,y:0,z:0},1),true);
  assert.equal(sphereBlocksRay(camera,sun,{x:3,y:0,z:0},1),false);
  assert.equal(sphereBlocksRay(camera,sun,{x:0,y:0,z:60},.27),false);
  assert.equal(sphereBlocksRay(camera,sun,{x:0,y:0,z:-60},.27),true);
});
