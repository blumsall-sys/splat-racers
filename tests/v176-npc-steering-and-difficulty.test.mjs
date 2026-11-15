import test from 'node:test';
import assert from 'node:assert/strict';
import {stepRaycastNpc,npcRacerState,nearestPathSegment,npcSteerForBearing,NPC_SKILL,NPC_STEER_TO_YAW_SIGN} from '../src/race/raycast-npc.js';
import {raycastCommands,RAYCAST_TUNING} from '../src/v17/raycast-kart.js';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {scanNpcObstacle} from '../src/race/npc-perception.js';

const dt=1/60;
const makeCar=()=>({x:-9.8,z:-9.75,yaw:Math.PI/2,vx:0,vz:0,wheelDiagnostics:{probes:4}});
/** Simplified, non-Ammo simulation, but using the *actual* raycastCommands
 * steering response and Bullet sign convention. Not a substitute for Chrome. */
function simulate(level,seconds=115){
 const car=makeCar(),state=npcRacerState();let speed=0,steering=0,travel=0,errors=0,samples=0,maxError=0;
 for(let i=0;i<seconds*60;i++){
  const decision=stepRaycastNpc(car,TRAINING_TRACK,level,dt,state);
  const cmd=raycastCommands(decision.input,speed,steering,dt);
  steering=cmd.steeringValue;
  const accel=decision.input.throttle>=0?5.0:7.0;
  speed=Math.max(-3,Math.min(RAYCAST_TUNING.speedLimitMps,speed+decision.input.throttle*accel*dt));
  car.yaw+=speed/1.5*Math.tan(steering)*dt;
  car.vx=speed*Math.sin(car.yaw);car.vz=speed*Math.cos(car.yaw);
  car.x+=car.vx*dt;car.z+=car.vz*dt;travel+=Math.hypot(car.vx,car.vz)*dt;
  const err=nearestPathSegment(car,TRAINING_TRACK.race.waypoints).distance;
  errors+=err;samples++;maxError=Math.max(maxError,err);
  assert.equal(decision.rescue,false,'normal driving must not teleport');
 }
 return {travel,meanError:errors/samples,maxError,position:{x:car.x,z:car.z}};
}

test('NPC-only steering maps world +yaw target to the native negative player steer',()=>{
 assert.equal(NPC_STEER_TO_YAW_SIGN,-1);
 assert(npcSteerForBearing(.5,4)<0);
 assert(npcSteerForBearing(-.5,4)>0);
 assert(Math.abs(npcSteerForBearing(0,4))<1e-8);
});
test('NPC starts in lane toward next waypoint rather than instantly steering into the guardrail',()=>{
 const c=makeCar(),s=npcRacerState();const first=stepRaycastNpc(c,TRAINING_TRACK,'medium',dt,s);
 assert(first.input.throttle>0);
 assert(first.input.steer>0,'P2 begins slightly outside racing line and must turn toward negative-world-yaw target');
 const desired=Math.atan2(first.input.target.x-c.x,first.input.target.z-c.z);
 const error=Math.atan2(Math.sin(desired-c.yaw),Math.cos(desired-c.yaw));
 assert(error<0 && first.input.steer>0,'NPC command must reduce world yaw toward target');
});
test('easy medium and hard all follow complete repeated bends on native-steering-sign simulation',()=>{
 const runs=Object.fromEntries(['easy','medium','hard'].map(level=>[level,simulate(level)]));
 for(const [level,r] of Object.entries(runs)){
  assert(r.travel>230,`${level} moved only ${r.travel.toFixed(1)}m`);
  assert(r.maxError<3.5,`${level} exited the lane (${r.maxError.toFixed(2)}m)`);
  assert(r.meanError<1.8,`${level} tracks poorly (${r.meanError.toFixed(2)}m)`);
 }
 assert(runs.medium.travel>runs.easy.travel*1.13);
 assert(runs.hard.travel>runs.medium.travel*1.08);
});
test('difficulty skill increases safe speed authority and acceleration, not just max speed',()=>{
 assert(NPC_SKILL.easy.lateralAccel<NPC_SKILL.medium.lateralAccel);
 assert(NPC_SKILL.medium.lateralAccel<NPC_SKILL.hard.lateralAccel);
 assert(NPC_SKILL.easy.throttleGain<NPC_SKILL.medium.throttleGain);
 assert(NPC_SKILL.medium.throttleGain<NPC_SKILL.hard.throttleGain);
 assert(NPC_SKILL.easy.avoidDistance>NPC_SKILL.hard.avoidDistance);
});
test('a forward obstacle passing lane is rejected if there is no drivable road beside it',()=>{
 class V {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
 const c=makeCar();c.entity={getPosition:()=>new V(c.x,.65,c.z)};
 const crate={name:'Dynamic: crate'},road={name:'GEN_RoadCollision',tags:{has:k=>k==='lab5-drivable-road'}};
 const physics={raycastFirst(a,b,opts){
  if(Math.abs(a.y-b.y)<.0001){
   if(opts.filterCallback(crate) && Math.abs(a.z-c.z)<.70)return {entity:crate,point:new V(a.x+2,a.y,a.z),normal:new V(-1,0,0)};
   return null;
  }
  if(opts.filterCallback(road)){
   // P2 faces +X, so +side/right is more negative world Z, which
   // is unsafe in this intentionally one-sided road simulation.
   if(a.z<-10.5)return null;
   return {entity:road,point:new V(a.x,0,a.z),normal:new V(0,1,0)};
  }
  return null;
 }};
 const seen=scanNpcObstacle(physics,c,V);
 assert(seen && seen.type==='dynamic');
 assert.equal(seen.rightClear,false);
 assert.equal(seen.leftClear,true);
 const d=stepRaycastNpc(c,TRAINING_TRACK,'medium',dt,npcRacerState(),seen,{valid:true,height:0});
 assert.equal(d.state.avoidSide,-1,'NPC should choose the road-supported side');
});
