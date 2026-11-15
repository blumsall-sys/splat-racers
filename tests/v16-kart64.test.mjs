import test from 'node:test';
import assert from 'node:assert/strict';
import {fromKeys,fromPad} from '../src/input/controls.js';
import {emptyDrift,nextDrift,kartControlStep,applyKartController} from '../src/v16/kart64.js';
const dt=1/60;
const pose=(patch={})=>({yaw:0,vx:0,vz:6,omega:0,throttle:1,steer:0,...patch});
function input(keys,player='p1'){return fromKeys(new Set(keys),player);}

test('W only accelerates forward without any yaw; W+D turns right with negative yaw; W+A goes left',()=>{
 const forward=kartControlStep(pose(),input(['KeyW']),emptyDrift(),dt);
 const right=kartControlStep(pose(),input(['KeyW','KeyD']),emptyDrift(),dt);
 const left=kartControlStep(pose(),input(['KeyW','KeyA']),emptyDrift(),dt);
 assert(forward.fz>0);assert.equal(forward.desiredYaw,0);assert.equal(forward.commandedYaw,0);
 assert(right.desiredYaw<-.5);assert(right.commandedYaw<-.12);
 assert(left.desiredYaw>.5);assert(left.commandedYaw>.12);
 assert.equal(right.wheelAngle,-left.wheelAngle);
});
test('two player keyboard steering, including independent drift keys',()=>{
 const k=new Set(['KeyW','KeyD','ShiftLeft','ArrowUp','ArrowLeft','ShiftRight']);
 const p1=fromKeys(k,'p1'),p2=fromKeys(k,'p2');
 assert.equal(p1.steer,1);assert.equal(p1.drift,true);assert.equal(p1.accelerate,true);
 assert.equal(p2.steer,-1);assert.equal(p2.drift,true);assert.equal(p2.accelerate,true);
 const right=kartControlStep(pose(),p1,emptyDrift(),dt);
 const left=kartControlStep(pose(),p2,emptyDrift(),dt);
 assert(right.commandedYaw<0);assert(left.commandedYaw>0);
});
test('S brakes and reverses; reverse steering follows backward gear',()=>{
 const backward=kartControlStep(pose({vz:-4}),input(['KeyS','KeyD']),emptyDrift(),dt);
 assert(backward.fz<0);
 assert(backward.commandedYaw>0);
 assert(backward.wheelRoll<0);
});
test('Mario Kart 64-style stopped spin turn requires brake+gas together',()=>{
 const spin=kartControlStep(pose({vz:0}),input(['KeyW','KeyS','KeyD']),emptyDrift(),dt);
 const noSpin=kartControlStep(pose({vz:0}),input(['KeyW','KeyD']),emptyDrift(),dt);
 assert.equal(spin.spinTurn,true);assert(spin.commandedYaw<0);
 assert.equal(noSpin.spinTurn,false);assert(Math.abs(spin.commandedYaw)>Math.abs(noSpin.commandedYaw));
});
test('A-button drift engages at speed, countersteer twice, release gives temporary boost',()=>{
 let d=emptyDrift();
 d=nextDrift(d,{drift:true,steer:1},8,dt);
 assert.equal(d.active,true);assert(d.hopTime>0);
 d=nextDrift(d,{drift:true,steer:-1},8,dt);assert.equal(d.stage,1);
 d=nextDrift(d,{drift:true,steer:1},8,dt);assert.equal(d.stage,2);
 d=nextDrift(d,{drift:true,steer:-1},8,dt);assert.equal(d.stage,3);
 d=nextDrift(d,{drift:false,steer:0},8,dt);
 assert.equal(d.active,false);assert(d.boostTime>.6);
 const boosted=kartControlStep(pose(),input(['KeyW']),d,dt);
 const ordinary=kartControlStep(pose(),input(['KeyW']),emptyDrift(),dt);
 assert(boosted.fz>ordinary.fz);
});
test('standard gamepad: left stick and RT accelerate; A/Bumper initiates drift',()=>{
 const buttons=Array.from({length:16},()=>({value:0}));buttons[7]={value:.8};buttons[0]={value:1};
 const p=fromPad({connected:true,axes:[.72,0],buttons});
 assert(p.steer>.5);assert(p.throttle>.7);assert(p.drift);assert(p.accelerate);
});
test('controller directly sets rigidbody angularVelocity rather than underpowered applyTorque',()=>{
 const trace={forces:[],impulses:[],rotations:[],steers:[],rolls:[]};
 const rb={angularVelocity:{x:0,y:0,z:0},applyForce:(...a)=>trace.forces.push(a),applyImpulse:(...a)=>trace.impulses.push(a),activate:()=>{},applyTorque:()=>{throw new Error('Old torque path must not run');}};
 const car={id:'p1',entity:{rigidbody:rb},wheels:[
  {front:true,spin:0,steering:{setLocalEulerAngles:(...a)=>trace.steers.push(a)},rolling:{setLocalEulerAngles:(...a)=>trace.rolls.push(a)}},
  {front:false,spin:0,steering:{setLocalEulerAngles:(...a)=>trace.steers.push(a)},rolling:{setLocalEulerAngles:(...a)=>trace.rolls.push(a)}}],
  ...pose()};
 const pc={Vec3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}}};
 const applied=applyKartController(car,input(['KeyW','KeyD']),dt,pc);
 assert(rb.angularVelocity.y<0,'physical angular velocity should steer right');
 assert(trace.forces[0][2]>0,'thrust must point ahead');
 assert(trace.steers[0][1]<0,'front tire visually steers right');
 assert.equal(trace.steers[1][1],0,'rear tire cannot steer');
 assert(trace.rolls[0][0]>0,'tire rolls about local X');
 assert.equal(car.driverDiagnostics.yawSet,applied.commandedYaw);
});
function virtualDrive(keys){
 let x=0,z=0,yaw=0,v=0,omega=0;let state=emptyDrift();
 for(let t=0;t<70;t++){
  const commands=input(keys);
  const sim=kartControlStep({yaw,vx:Math.sin(yaw)*v,vz:Math.cos(yaw)*v,omega},commands,state,dt);
  state=sim.drift;omega=sim.commandedYaw;yaw+=omega*dt;
  v=Math.min(11,Math.max(0,v+sim.fz*Math.cos(yaw)/170*dt+sim.fx*Math.sin(yaw)/170*dt));
  x+=Math.sin(yaw)*v*dt;z+=Math.cos(yaw)*v*dt;
 }
 return {x,z,yaw,v};
}
test('70-frame steering integration: W straight, W+D moves screen right, W+A left',()=>{
 const straight=virtualDrive(['KeyW']);
 const right=virtualDrive(['KeyW','KeyD']);
 const left=virtualDrive(['KeyW','KeyA']);
 assert(Math.abs(straight.x)<.001,JSON.stringify(straight));
 assert(right.x< -1,JSON.stringify(right));
 assert(left.x>1,JSON.stringify(left));
 assert(straight.z>3,JSON.stringify(straight));
});

test('drift R-button hop applies one vertical impulse and maintains physical steer',()=>{
 let hit=0;
 const rb={angularVelocity:{x:0,y:0,z:0},applyForce:()=>{},applyImpulse:(x,y,z)=>{assert.equal(x,0);assert(y>100);assert.equal(z,0);hit++;},activate:()=>{}};
 const car={id:'p1',entity:{rigidbody:rb},wheels:[],...pose()};
 const pc={Vec3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}}};
 applyKartController(car,input(['KeyW','KeyD','ShiftLeft']),dt,pc);
 applyKartController(car,input(['KeyW','KeyD','ShiftLeft']),dt,pc);
 assert.equal(hit,1,'one hop per drift activation, not one hop per frame');
 assert(car.driftState.active);
});
