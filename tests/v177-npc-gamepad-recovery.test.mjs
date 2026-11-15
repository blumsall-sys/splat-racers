import test from 'node:test';
import assert from 'node:assert/strict';
import {npcRacerState,npcTrappedOnRoad,stepRaycastNpc} from '../src/race/raycast-npc.js';
import {rescueNpcToRoad} from '../src/race/npc-perception.js';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {fromPad} from '../src/input/controls.js';
import {GamepadMenuNavigator,menuPadIntent} from '../src/input/menu-gamepad.js';

const k=()=>({x:0,z:-8.25,yaw:Math.PI/2,vx:0,vz:0,y:1,vy:0,wheelDiagnostics:{probes:4}});
const surf={valid:true,height:0};
const withButtons=(pressed=[],values={})=>({connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},(_,i)=>({pressed:pressed.includes(i),value:values[i]??0}))});

function stuckSimulation(){
 const car=k(),s=npcRacerState();let outcome=null;
 for(let n=0;n<2400;n++){
  const o=stepRaycastNpc(car,TRAINING_TRACK,'medium',1/60,s,{type:'wall',distance:.5},surf);
  if(o.rescue){outcome={seconds:n/60,o};break;}
 }
 return outcome;
}
test('NPC will not teleport after one bump, but can escape long repeat trap locally',()=>{
 const outcome=stuckSimulation();
 assert(outcome&&outcome.seconds>=12);
 assert.equal(outcome.o.state.lastRescueReason,'stuck-on-track');
 assert.equal(outcome.o.state.lastSafe.y,0);
 assert(Math.hypot(outcome.o.state.lastSafe.x,outcome.o.state.lastSafe.z-(-8.25))<2);
});
test('on-road trapped-area watchdog clears when car moves beyond stuck radius',()=>{
 const s=npcRacerState(),car=k();s.recoveryAttempts=3;s.lastSafe={x:0,z:-8.25,y:0,yaw:0};
 for(let i=0;i<300;i++)assert.equal(npcTrappedOnRoad(s,car,true,1/60),false);
 car.x=5;
 assert.equal(npcTrappedOnRoad(s,car,true,1/60),false);
 assert.equal(s.trapSeconds,0);assert.equal(s.recoveryAttempts,0);
});
test('watchdog never rescues during cooldown or after a single recovery attempt',()=>{
 const s=npcRacerState(),car=k();s.recoveryAttempts=1;s.lastSafe={x:0,z:-8.25,y:0,yaw:0};
 for(let i=0;i<900;i++)assert.equal(npcTrappedOnRoad(s,car,true,1/60),false);
 s.recoveryAttempts=3;s.rescueCooldown=10;
 for(let i=0;i<200;i++)assert.equal(npcTrappedOnRoad(s,car,true,1/60),false);
});
test('gamepad Y resets; A/X hop and LB descends without hopping',()=>{
 assert.equal(fromPad(withButtons([3])).reset,true);
 for(const btn of [0,2])assert.equal(fromPad(withButtons([btn])).drift,true);
 assert.equal(fromPad(withButtons([4])).drift,false);assert.equal(fromPad(withButtons([4])).descend,true);
 assert.equal(fromPad(withButtons([2])).reset,false);
});
test('gamepad menu A and X confirm even when pressed flag is true and value is zero',()=>{
 assert.equal(menuPadIntent(withButtons([0])).confirm,true);
 assert.equal(menuPadIntent(withButtons([2])).confirm,true);
 assert.equal(menuPadIntent(withButtons([9])).confirm,true);
 assert.equal(menuPadIntent(withButtons([1])).back,true);
});
test('gamepad confirm selects highlighted button, B opens pause, A during racing does not click hidden UI',()=>{
 const mk=()=>({disabled:false,hidden:false,tagName:'BUTTON',clicked:0,classList:{add(){},remove(){}},focus(){},closest(){return null;},click(){this.clicked++;}});
 const one=mk(),two=mk(),root={querySelectorAll:()=>[one,two]};
 let visible=true,pad=withButtons([]),next,pauses=0;
 const nav=new GamepadMenuNavigator({getRoot:()=>visible?root:null,onPause:()=>{pauses++;},getPads:()=>[pad],raf:fn=>{next=fn;}});
 pad=withButtons([0]);next();assert.equal(one.clicked,1);
 pad=withButtons([]);next();pad=withButtons([13]);next();assert.equal(nav.selected,two);
 pad=withButtons([]);next();pad=withButtons([2]);next();assert.equal(two.clicked,1);
 visible=false;pad=withButtons([]);next();pad=withButtons([0]);next();assert.equal(one.clicked,1);assert.equal(two.clicked,1);
 pad=withButtons([]);next();pad=withButtons([9]);next();assert.equal(pauses,1);
 nav.destroy();
});
test('on-road safe rescue does not spawn within wall clearance',()=>{
 class V{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
 const road={name:'EXPORTED_GEN_RoadCollision',tags:{has:x=>x==='lab5-drivable-road'}};
 const barrier={name:'Wall: inner'};
 const queries=[];
 const physics={raycastFirst(a,b,opts){
  queries.push({a,b});
  if(a.y===b.y){
   // Reject candidate x=13 with a barrier directly beside it.
   if(a.x===13&&a.z===5)return {entity:barrier,point:new V(a.x+.5,a.y,a.z)};
   return null;
  }
  return {entity:road,point:new V(a.x,0,a.z),normal:new V(0,1,0)};
 }};
 let spawned=null;
 const c={entity:{getPosition:()=>new V(40,-5,40),rigidbody:{teleport(v){spawned=v;},activate(){},linearVelocity:null,angularVelocity:null}}};
 const result=rescueNpcToRoad(c,TRAINING_TRACK,physics,V,null,{x:13,z:5,y:0,yaw:0},'stuck-on-track');
 assert(result);assert.notEqual(result.z,5,'recovery should try an adjacent verified lane position');
 assert(spawned);
});
