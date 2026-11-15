import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  applyRaycastAxleControls,
  BULLET_STEERING_POLARITY,
  RAYCAST_TUNING,
  raycastCommands,
  wheelLayout,
  adaptLegacyNpcSteering
} from '../src/v17/raycast-kart.js';
import {BOOST,makeBoostState,stepBoost} from '../src/race/boost.js';
import {npcSteerForBearing} from '../src/race/raycast-npc.js';
import {fromPad,fromKeys} from '../src/input/controls.js';

/** Records exactly the same Ammo wheel methods as official vehicle.js.
 * The sample itself has wheel order front/front/rear/rear; ours is reversed.
 */
const record = () => {
  const log={engine:[],brake:[],steer:[],friction:[]};
  const native={
    applyEngineForce:(v,i)=>log.engine[i]=v,
    setBrake:(v,i)=>log.brake[i]=v,
    setSteeringValue:(v,i)=>log.steer[i]=v,
    getWheelInfo:i=>({set_m_frictionSlip:v=>log.friction[i]=v})
  };
  return {native,log};
};

test('official 0=right 1=up 2=forward axes and four physical raycast wheel positions',()=>{
 const specs=wheelLayout();
 assert.deepEqual(specs.map(w=>w.front),[false,false,true,true]);
 assert.deepEqual(specs.map(w=>Math.sign(w.z)),[-1,-1,1,1]);
 assert.deepEqual(specs.map(w=>Math.sign(w.x)),[-1,1,-1,1]);
 assert(RAYCAST_TUNING.suspensionRestLength>0);
});

test('front-only steering, rear-only engine and rear-only braking match official axle policy',()=>{
 const {native,log}=record();
 const cmd=raycastCommands({throttle:1,steer:1},3,0,1/60);
 applyRaycastAxleControls(native,cmd,cmd.tireGrip);
 assert.deepEqual(log.engine,[cmd.engine,cmd.engine,0,0]);
 assert.deepEqual(log.brake,[0,0,0,0]);
 assert.equal(log.steer[0],undefined);
 assert.equal(log.steer[1],undefined);
 assert(log.steer[2]<0 && log.steer[3]<0);
 assert.deepEqual(log.friction,[cmd.tireGrip,cmd.tireGrip,cmd.tireGrip,cmd.tireGrip]);
 // Reverse while travelling forward is a braking phase.
 const stop=raycastCommands({throttle:-1,steer:0},4,0,1/60);
 applyRaycastAxleControls(native,stop,stop.tireGrip);
 assert.deepEqual(log.engine,[0,0,0,0]);
 assert.deepEqual(log.brake,[stop.brake*2,stop.brake*2,0,0]);
 assert.equal(log.brake.reduce((sum,v)=>sum+v,0),4*stop.brake);
});

test('same rear braking total during neutral and pause, with no front brake torque',()=>{
 const {native,log}=record();
 for(const input of [{throttle:0,steer:0},{throttle:-1,steer:1}]){
  const cmd=raycastCommands(input,5,0,1/60);
  applyRaycastAxleControls(native,cmd,cmd.tireGrip);
  assert(log.brake[0]>=0&&log.brake[1]>=0);
  assert.equal(log.brake[2],0);assert.equal(log.brake[3],0);
 }
});

test('nitro still strengthens rear engine without changing steering, and has five-second independent cooldown',()=>{
 const normal=raycastCommands({throttle:1,steer:.35},4,0,1/60);
 const nitro=raycastCommands({throttle:1,steer:.35,boostActive:true},4,0,1/60);
 assert(nitro.engine>normal.engine);
 assert.equal(nitro.steeringValue,normal.steeringValue);
 const {native,log}=record();applyRaycastAxleControls(native,nitro,nitro.tireGrip);
 assert.deepEqual(log.engine,[nitro.engine,nitro.engine,0,0]);
 const p1=makeBoostState(),p2=makeBoostState();
 assert(stepBoost(p1,true,1/60).triggered);
 assert.equal(p1.cooldown,BOOST.cooldown);
 assert.equal(p2.cooldown,0);
});

test('hop buttons, Nitro and resets remain distinct for both keyboard players and controllers',()=>{
 const keys=new Set(['ShiftLeft','ShiftRight','Space','KeyM']);
 const a=fromKeys(keys,'p1'),b=fromKeys(keys,'p2');
 assert(a.drift&&b.drift&&a.boost&&b.boost);
 const pad={connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},(_,i)=>({pressed:[0,1].includes(i),value:[0,1].includes(i)?1:0}))};
 const input=fromPad(pad);assert(input.drift&&input.boost);assert(!input.reset);
});

test('NPC steering adapter and player steering sign are unchanged',()=>{
 assert.equal(BULLET_STEERING_POLARITY,-1);
 assert(raycastCommands({steer:1,throttle:1},4,0,1/60).steeringValue<0);
 assert(raycastCommands({steer:-1,throttle:1},4,0,1/60).steeringValue>0);
 const npc=npcSteerForBearing(.35,4);
 assert(npc<0);
 assert.equal(adaptLegacyNpcSteering({steer:npc}).steer,-npc);
});

test('the scene keeps one dynamic chassis with a road mesh and no extra lifting springs',()=>{
 const scene=readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
 const loop=readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
 assert.match(scene,/type:'mesh',renderAsset,convexHull:false/);
 assert.match(scene,/type:'dynamic',mass:T.massKg/);
 assert.match(scene,/createRaycastVehicle\(app,chassis,ammo(?:,T)?\)/);
 assert.match(loop,/driveRaycastVehicle\(car,input,dt,pc\)/);
 assert.doesNotMatch(loop,/applyRoadSupport\(/);
});
