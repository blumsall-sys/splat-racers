import test from 'node:test';
import assert from 'node:assert/strict';
import {scanNpcObstacle,observeNpcSurface,rescueNpcToRoad,isNpcObstacleEntity} from '../src/race/npc-perception.js';
import {npcRacerState,stepRaycastNpc} from '../src/race/raycast-npc.js';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';

class Vec3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
const car=(x=0,z=-8.25,yaw=Math.PI/2)=>({
 x,y:.7,z,yaw,vx:0,vz:0,vy:0,wheelDiagnostics:{probes:4},
 entity:{getPosition(){return new Vec3(x,.7,z);}}
});
const road={name:'EXPORTED_GEN_RoadCollision',tags:{has(tag){return tag==='lab5-drivable-road';}}};
const crate={name:'Dynamic: crate'};
const wall={name:'Wall: outer'};
const mkRoadPhysics=()=>({raycastFirst(from,to,options){
  if(to.y>=from.y||!options.filterCallback(road))return null;
  return {entity:road,point:new Vec3(from.x,0,from.z),normal:new Vec3(0,1,0)};
}});

test('road, waypoint and race markers are excluded from obstacle sensor',()=>{
 assert(!isNpcObstacleEntity({name:'EXPORTED_GEN_RoadCollision'}));
 assert(!isNpcObstacleEntity({name:'SPAWN_P2'}));
 assert(!isNpcObstacleEntity({name:'GATE_START_FINISH'}));
 assert(isNpcObstacleEntity(crate));assert(isNpcObstacleEntity(wall));
 assert(isNpcObstacleEntity({name:'p1'}));
});
test('NPC sensor detects dynamic crate ahead without marking road as obstacle',()=>{
 const c=car(-5,-8.25,Math.PI/2);
 const physics={raycastFirst(a,b,options){
  if(b.y!==a.y)return null;
  if(options.filterCallback(crate))return {entity:crate,point:new Vec3(a.x+Math.min(3,b.x-a.x),a.y,a.z),normal:new Vec3(-1,0,0)};
  return null;
 }};
 const hit=scanNpcObstacle(physics,c,Vec3);
 assert.equal(hit?.type,'dynamic');assert(hit?.distance<5.5);
});
test('NPC sensor returns no obstacles when only road intersects a ray',()=>{
 const c=car();
 const physics={raycastFirst(a,b,options){return options.filterCallback(road)?{entity:road,point:new Vec3(0,0,0)}:null;}};
 assert.equal(scanNpcObstacle(physics,c,Vec3),null);
});
test('road sensor checks for an actual nearby drivable surface, not distant terrain',()=>{
 const c=car();assert.equal(observeNpcSurface(mkRoadPhysics(),c,Vec3).valid,true);
 const missing={raycastFirst(){return null;}};
 assert.equal(observeNpcSurface(missing,c,Vec3).valid,false);
});
test('rescue returns to road close to fall location, never a future waypoint',()=>{
 const save={x:13,z:5,y:0,yaw:0};
 const commands=[];
 const c={entity:{getPosition:()=>new Vec3(95,-10,-88),rigidbody:{
  teleport(...a){commands.push(a);},activate(){},linearVelocity:null,angularVelocity:null
 }}};
 const result=rescueNpcToRoad(c,TRAINING_TRACK,mkRoadPhysics(),Vec3,null,save);
 assert(result);assert.equal(result.x,13);assert.equal(result.z,5);
 assert(commands[0][0].x===13 && commands[0][0].z===5);
 assert.equal(commands[0][0].y,.67);
});
test('rescue refuses to teleport when no confirmed safe on-track position exists',()=>{
 let called=false;
 const c={entity:{getPosition:()=>new Vec3(99,-10,99),rigidbody:{teleport(){called=true;}}}};
 assert.equal(rescueNpcToRoad(c,TRAINING_TRACK,mkRoadPhysics(),Vec3,null,null),null);
 assert.equal(called,false);
});
test('rescue does not spawn directly inside the human car',()=>{
 const save={x:13,z:5,y:0,yaw:0};
 let position=null;
 const c={entity:{getPosition:()=>new Vec3(99,-10,99),rigidbody:{teleport(v){position=v;},activate(){}}}};
 const result=rescueNpcToRoad(c,TRAINING_TRACK,mkRoadPhysics(),Vec3,{x:13,z:5},save);
 assert(result);
 assert(Math.hypot(result.x-13,result.z-5)>=2.5);
 assert(position);
});
test('temporary obstacle avoidance returns to default racing line after it clears',()=>{
 const c=car(-5,-8.25,Math.PI/2),s=npcRacerState();
 const obs={type:'dynamic',distance:3,awaySide:1,leftClear:true,rightClear:true};
 let result=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,obs,{valid:true,height:0});
 assert.equal(result.state.avoidSide,1);
 for(let i=0;i<120;i++)result=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,null,{valid:true,height:0});
 assert.equal(result.state.avoidSide,0);
});
