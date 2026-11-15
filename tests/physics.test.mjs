import test from 'node:test';import assert from 'node:assert/strict';
import {STEP,makeWorld,stepWorld,resetBody,cleanInput,roadHeight} from '../src/physics/engine.js';
const sim=(world,n,inputs)=>{for(let i=0;i<n;i++)stepWorld(world,inputs,STEP);};
const body=(world,id)=>world.bodies.find(x=>x.id===id);
const speed=b=>Math.hypot(b.vx,b.vz);
test('world starts with p1 p2 and a movable crate',()=>{
  for(const m of ['solo','local']){
    const w=makeWorld(m);assert.equal(w.bodies.length,3);
    assert.equal(body(w,'crate').invMass>0,true);assert.equal(w.walls.length,8);
    assert.equal(body(w,'p1').vx,0);
  }
});
test('forward acceleration travels on the training straight',()=>{
  const w=makeWorld('solo');sim(w,90,{p1:{throttle:1}});
  assert.ok(body(w,'p1').x>-11,`x=${body(w,'p1').x}`);
  assert.ok(speed(body(w,'p1'))>2);
});
test('S key equivalents accelerate in reverse from complete stop',()=>{
  const w=makeWorld('solo');sim(w,90,{p1:{throttle:-1}});
  assert.ok(body(w,'p1').x<-11,`x=${body(w,'p1').x}`);
  assert.ok(body(w,'p1').speed<0);
});
test('reverse brakes first and then drives backwards',()=>{
  const w=makeWorld('solo');sim(w,75,{p1:{throttle:1}});
  const before=body(w,'p1').speed;
  sim(w,120,{p1:{throttle:-1}});
  assert.ok(body(w,'p1').speed<before,'reverse must brake initial speed');
  assert.ok(body(w,'p1').speed<0,'reverse eventually goes negative');
});
test('local mode accelerates both independently',()=>{
  const w=makeWorld('local');sim(w,90,{p1:{throttle:1},p2:{throttle:-1}});
  assert.ok(body(w,'p1').x>-11);
  assert.ok(body(w,'p2').x<-11);
});
test('A turns screen-left; D turns screen-right in both game modes',()=>{
  const turning=makeWorld('solo'),straight=makeWorld('solo');
  sim(turning,100,{p1:{throttle:1,steer:-1}});sim(straight,100,{p1:{throttle:1,steer:0}});
  assert.ok(body(turning,'p1').yaw>body(straight,'p1').yaw+0.08);
  const right=makeWorld('local');sim(right,100,{p2:{throttle:1,steer:1}});
  assert.ok(body(right,'p2').yaw<Math.PI/2-0.08);
});
test('crate gets pushed when bumper car hits it',()=>{
  const w=makeWorld('solo');sim(w,280,{p1:{throttle:1}});
  const crate=body(w,'crate');
  assert.ok(Math.hypot(crate.x-0.7,crate.z+8.25)>0.15,`crate displacement ${crate.x},${crate.z}`);
  assert.ok(w.contacts>0);
});
test('bumper car head-on overlap separates and conserves finite state',()=>{
  const w=makeWorld('local'),a=body(w,'p1'),b=body(w,'p2');
  Object.assign(b,{x:a.x+0.3,z:a.z+0.2,yaw:a.yaw+Math.PI});
  for(let i=0;i<25;i++)stepWorld(w,{p1:{throttle:1},p2:{throttle:1}},STEP);
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>1.0,'cars separate without permanent interpenetration');
  for(const car of [a,b])assert.ok([car.x,car.z,car.omega,car.y].every(Number.isFinite));
});
test('physical boundaries keep fast cars on track',()=>{
  const w=makeWorld('solo');sim(w,1300,{p1:{throttle:1}});
  const p=body(w,'p1');assert.ok(p.x<17.6&&p.x>-17.6&&p.z<12.7&&p.z>-12.7);
});
test('suspension responds to the raised road',()=>{
  assert.ok(roadHeight(6.8,-8.25)>0.25);
  assert.equal(roadHeight(-6.8,-8.25),0);
  const w=makeWorld('solo'),b=body(w,'p1');
  Object.assign(b,{x:6.7,z:-8.25});sim(w,80,{p1:{throttle:0}});
  const flat=makeWorld('solo');sim(flat,80,{p1:{throttle:0}});
  assert.ok(b.y>body(flat,'p1').y+0.09,`ride y ${b.y} vs flat ${body(flat,'p1').y}`);
});
test('R/Enter style reset clears position and velocity',()=>{
  const w=makeWorld('local');sim(w,40,{p1:{throttle:1},p2:{throttle:1}});
  resetBody(w,'p1');assert.equal(body(w,'p1').x,-9.8);assert.equal(body(w,'p1').vx,0);
  sim(w,1,{p2:{reset:true}});assert.equal(body(w,'p2').x,-9.8);
});
test('invalid inputs are finite-clamped',()=>{
  assert.deepEqual(cleanInput({throttle:Infinity,steer:9}),{throttle:0,steer:1,reset:false});
  assert.throws(()=>makeWorld('online'),/mode/);
});
