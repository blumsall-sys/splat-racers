import test from 'node:test';
import assert from 'node:assert/strict';
import {fromKeys,fromPad} from '../src/input/controls.js';
import {npcInput} from '../src/race/ai-driver.js';
import {BULLET_STEERING_POLARITY,raycastCommands,RAYCAST_TUNING,adaptLegacyNpcSteering} from '../src/v17/raycast-kart.js';

test('all human input axes use right +1 / left -1 before Bullet conversion',()=>{
  assert.equal(fromKeys(new Set(['KeyW','KeyD']),'p1').steer,1);
  assert.equal(fromKeys(new Set(['KeyW','KeyA']),'p1').steer,-1);
  assert.equal(fromKeys(new Set(['ArrowUp','ArrowRight']),'p2').steer,1);
  assert.equal(fromKeys(new Set(['ArrowUp','ArrowLeft']),'p2').steer,-1);
  const pad=(axis)=>({connected:true,axes:[axis],buttons:[]});
  assert(fromPad(pad(.9)).steer>0);
  assert(fromPad(pad(-.9)).steer<0);
});

test('single engine-boundary polarity makes native right/left steering opposite',()=>{
  assert.equal(BULLET_STEERING_POLARITY,-1);
  const right=raycastCommands({throttle:1,steer:1},5,0,1/60);
  const left=raycastCommands({throttle:1,steer:-1},5,0,1/60);
  assert(right.steeringValue<0 && left.steeringValue>0);
  assert(Math.abs(right.steeringValue)<=RAYCAST_TUNING.maxSteeringRadians);
  assert.equal(Math.abs(right.steeringValue),Math.abs(left.steeringValue));
  assert.equal(raycastCommands({throttle:1,steer:0},5,0,1/60).steeringValue,0);
});

test('steering polarity does not change acceleration, reversing or braking',()=>{
  for(const steer of [-1,0,1]){
    const drive=raycastCommands({throttle:1,steer},0,0,1/60);
    assert.equal(drive.engine,RAYCAST_TUNING.engineForcePerRearWheel);
    assert.equal(drive.brake,0);
    const reverse=raycastCommands({throttle:-1,steer},-2,0,1/60);
    assert.equal(reverse.engine,-RAYCAST_TUNING.reverseForcePerRearWheel);
    assert.equal(reverse.brake,0);
    const stop=raycastCommands({throttle:-1,steer},4,0,1/60);
    assert.equal(stop.engine,0);
    assert(stop.brake>0);
  }
});


test('legacy NPC left/right sign is adapted only for native Bullet karts',()=>{
  const legacyR={throttle:.7,steer:-.6,drift:false,target:{x:2,z:1}};
  const nativeR=adaptLegacyNpcSteering(legacyR);
  assert(nativeR.steer>0 && nativeR.throttle===legacyR.throttle);
  assert.equal(nativeR.target,legacyR.target);
  assert.equal(legacyR.steer,-.6,'legacy NPC remains intact for its own tests');
  assert(raycastCommands(nativeR,5,0,1/60).steeringValue<0);
  const legacyL={throttle:.5,steer:.8};
  assert(raycastCommands(adaptLegacyNpcSteering(legacyL),5,0,1/60).steeringValue>0);
});

