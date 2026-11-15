import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RAYCAST_TUNING, raycastCommands, wheelLayout} from '../src/v17/raycast-kart.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('native raycast steering reverses the empirically inverted v1.7.2 mapping',()=>{
  const wheels=wheelLayout();
  assert.equal(wheels.length,4);
  assert.deepEqual(wheels.map(w=>w.front),[false,false,true,true]);
  const right=raycastCommands({steer:1,throttle:1},4,0,1/60).steeringValue;
  const left=raycastCommands({steer:-1,throttle:1},4,0,1/60).steeringValue;
  assert(right<0, 'D must send negative Bullet steering in this runtime');
  assert(left>0, 'A must send positive Bullet steering in this runtime');
  assert.equal(Math.sign(right),-Math.sign(left));
  const neutral=raycastCommands({steer:0,throttle:1},4,0,1/60).steeringValue;
  assert.equal(neutral,0);
});

test('test-friendly torque and braking levels are proportional to the small kart mass',()=>{
  const t=RAYCAST_TUNING;
  const thrustAccel=(t.engineForcePerRearWheel*2)/t.massKg;
  assert(thrustAccel>=2 && thrustAccel<=6,`forward acceleration proxy ${thrustAccel} m/s²`);
  assert(t.reverseForcePerRearWheel<t.engineForcePerRearWheel);
  assert(t.brakingForcePerWheel<=30);
  assert(t.startHeightAboveRoad-t.suspensionConnectionY*-1-t.suspensionRestLength-t.wheelRadius>=0);
  assert(t.suspensionRestLength>0 && t.suspensionStiffness>0);
  assert(t.rollInfluence<.15);
});

test('chassis pitch/roll are damped without locking the yaw turning axis',()=>{
  const source=read('src/v14/pc-scene.js');
  const factor=/angularFactor=new pc\.Vec3\((\.?[\d.]+),([\d.]+),(\.?[\d.]+)\)/.exec(source);
  assert(factor, 'anti-tip angular factor missing');
  assert(Number(factor[1])>0&&Number(factor[1])<=.35);
  assert.equal(Number(factor[2]),1);
  assert(Number(factor[3])>0&&Number(factor[3])<=.35);
  assert(!source.includes('angularDamping:2.5'));
});

test('no manual yaw servo or second lift, true Ammo wheels own suspension',()=>{
  const src=read('src/v14/main.js');
  assert(src.includes('driveRaycastVehicle(car,input,dt,pc)'));
  assert(!src.includes('applyRoadSupport('));
  const ray=read('src/v17/raycast-kart.js');
  assert(ray.includes('world.addAction(vehicle)'));
  assert(ray.includes('vehicle.setSteeringValue(command.steeringValue,index)'));
  assert(ray.includes('vehicle.getWheelTransformWS(i)'));
  assert(ray.includes('kartUprightTorque('),'only contact-gated pitch/roll correction may apply torque');
  assert(!ray.includes('rig.vehicle.setAngularVelocity'),'no manual steering yaw snap');
});
