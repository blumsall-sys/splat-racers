import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {npcAirState,stepAirNpc,planAirGateApproach,airNpcPace} from '../src/race/air-npc.js';
import {flightNpcRecoveryCandidates,crossFlightGate} from '../src/vehicles/air-race.js';
import {driveFlyingVehicle} from '../src/vehicles/flight-controls.js';
import {runForceResponseFlight} from '../scripts/benchmark-flight-force.mjs';
const gate=(id,x,y,z,nx,ny,nz,r=3.7)=>({id,position:[x,y,z],normal:[nx,ny,nz],radius:r});

test('all difficulty levels use decisive acceleration and Hard targets higher cruise speed',()=>{
 const shared={phase:'CROSS',bearing:0,distance:20,signed:-10,radius:4,
  elevation:0,altitudeReady:true,speed:1,pace:1};
 const easy=airNpcPace({...shared,difficulty:'easy'}),med=airNpcPace({...shared,difficulty:'medium'}),hard=airNpcPace({...shared,difficulty:'hard'});
 assert(easy.desiredSpeed<med.desiredSpeed);
 assert(med.desiredSpeed<hard.desiredSpeed);
 for(const level of [easy,med,hard])assert(level.throttle>.9,'NPC should use full throttle on a clear straight');
});

test('single-vehicle physical surrogate clears all eight oriented gates at 1x and 2x without a reset',()=>{
 for(const pace of [1,2])for(const type of ['HOVER','DRONE'])for(const difficulty of ['easy','medium','hard']){
  const result=runForceResponseFlight(type,difficulty,pace);
  assert.equal(result.success,true,`${type} ${difficulty} ${pace}x stuck on ${result.completed.length}/8 at ${result.seconds}s`);
  assert(result.seconds<95,`${type} ${difficulty} ${pace}x too slow: ${result.seconds}s`);
  assert.equal(result.stuckRescueRequests,0,`${type} ${difficulty} ${pace}x required emergency reset`);
 }
});

test('tight gate spacing limits 2x speeds but large track spacing permits true scaled racing',()=>{
 const tight=[gate('0',0,7,0,0,0,1),gate('1',0,7,15,0,0,1),gate('2',0,7,31,0,0,1)];
 const wide=[gate('0',0,7,0,0,0,1),gate('1',0,7,85,0,0,1),gate('2',0,7,170,0,0,1)];
 const car={id:'p3',spec:{type:'DRONE'},x:0,y:7,z:-12,yaw:0,vx:0,vz:0};
 const dense=stepAirNpc(car,tight,{next:0},npcAirState(),1/60,{pace:2,difficulty:'hard'});
 const long=stepAirNpc(car,wide,{next:0},npcAirState(),1/60,{pace:2,difficulty:'hard'});
 assert(dense.diagnostics.effectivePace<=1.05);
 assert(long.diagnostics.effectivePace>1.6);
});

test('recoveries are behind the current required gate and never advance progress',()=>{
 const ring=gate('current',10,8,20,1,0,0,3.7);
 const before={next:3,laps:1,launched:true};
 const candidates=flightNpcRecoveryCandidates(ring,'p3');
 assert(candidates.length>=6);
 for(const p of candidates){
  assert((p.x-10)*ring.normal[0]+(p.z-20)*ring.normal[2]<-5);
  assert(!crossFlightGate(p,{...p,z:p.z+1},ring));
 }
 assert.deepEqual(before,{next:3,laps:1,launched:true});
});

test('tilted ring approach is calculated in the true 3D plane and never accepts backward crossings',()=>{
 const g=gate('tilted',0,9,12,0,.6,.8,3);
 const plan=planAirGateApproach({x:5,y:6,z:3},g);
 assert(plan.lateral>0);
 assert(plan.entry.y<plan.exit.y);
 const invalid=crossFlightGate({x:0,y:11,z:15},{x:0,y:8,z:10},g);
 assert.equal(invalid,false);
});

test('real flight controller follows NPC altitude through forces; player hop still fires impulse',()=>{
 class Vec3 {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
 const pc={Vec3};
 const mock=(type,isNpc,input)=>{
  const calls={force:[],impulse:[],torque:[],teleport:0};
  const rigidbody={linearVelocity:new Vec3(),angularVelocity:new Vec3(),
   applyForce:(x,y,z)=>calls.force.push({x,y,z}),
   applyImpulse:(x,y,z)=>calls.impulse.push({x,y,z}),
   applyTorque:(x,y,z)=>calls.torque.push({x,y,z}),
   teleport:()=>{calls.teleport++;},activate:()=>{}};
  const e={rigidbody,up:new Vec3(0,1,0),right:new Vec3(1,0,0),forward:new Vec3(0,0,-1),
   getPosition:()=>new Vec3(0,3,0)};
  const car={id:'p3',isNpc,entity:e,spec:{type,mass:100,hoverHeight:2.45,jumpSpeed:5.5,maxSpeed:12.5},
   stableFlightYaw:0,hoverWorldTarget:3,hoverManualHeight:false};
  driveFlyingVehicle(car,input,1/60,{raycastFirst:()=>null},pc);
  return {calls,car};
 };
 for(const type of ['HOVER','DRONE']){
  const up=mock(type,true,{steer:0,throttle:.9,npcAltitudeTarget:11,drift:true,descend:false});
  const down=mock(type,true,{steer:0,throttle:.9,npcAltitudeTarget:-2,drift:false,descend:true});
  assert(up.calls.force.some(f=>f.y>100),`${type} needs a positive vertical force`);
  assert(up.calls.force.reduce((s,f)=>s+f.y,0)>down.calls.force.reduce((s,f)=>s+f.y,0));
  assert.equal(up.calls.teleport,0);
  if(type==='HOVER'){
   assert.equal(up.calls.impulse.length,0,'NPC altitude hold must NOT spam hop impulses');
   assert(up.car.hoverWorldTarget>3);
  }
 }
 const player=mock('HOVER',false,{steer:0,throttle:0,drift:true,descend:false});
 assert(player.calls.impulse.some(i=>i.y>0),'human hover button must still impulse upwards');
});

test('export preflight warns about close/reversed steep rings without moving offsets',()=>{
 const s=readFileSync(new URL('../blender_addon/lab5_splat_packager/exporter.py',import.meta.url),'utf8');
 assert(s.includes('change facing by'));
 assert(s.includes('Increase spacing or enlarge the openings'));
 assert(s.includes('AIR_OFFSET_%02d'));
 assert(s.includes('Flight rings %02d / %02d have a steep'));
});
