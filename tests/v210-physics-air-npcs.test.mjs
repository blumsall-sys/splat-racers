import test from 'node:test';
import assert from 'node:assert/strict';
import {kartDownforce,kartUprightTorque,kartSteeringScale,kartLaunchScale} from '../src/vehicles/kart-stability.js';
import {npcAirState,npcAirChoice,stepAirNpc,flightNpcObstacle} from '../src/race/air-npc.js';
import {raceRoster} from '../src/race/roster.js';
import {DEFAULT_VEHICLES} from '../src/vehicles/library.js';
import {crossFlightGate,advanceAirLap} from '../src/vehicles/air-race.js';
import {isNpcObstacleEntity} from '../src/race/npc-perception.js';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const gates=[{id:'AIR_00',position:[0,8,10],normal:[0,0,1],radius:3.7},
 {id:'AIR_01',position:[12,12,25],normal:[1,0,0],radius:3.7}];

test('2x kart has progressive steering reduction and grounded downforce but still hops freely',()=>{
 assert(kartSteeringScale(25,2)<kartSteeringScale(12.5,1));
 assert.equal(kartLaunchScale(0,2),.78);
 assert(kartDownforce(170,25,2,4,false)>kartDownforce(170,12.5,1,4,false));
 assert.equal(kartDownforce(170,25,2,0,false),0);
 assert.equal(kartDownforce(170,25,2,4,true),0);
 const torque=kartUprightTorque({up:{x:0,y:.8,z:.6},angular:{x:0,z:0},mass:170,pace:2,contacts:4});
 assert(torque.x<0,'tilted nose must receive righting torque');
 assert.deepEqual(kartUprightTorque({up:{x:0,y:.8,z:.6},mass:170,pace:2,contacts:0}),{x:0,z:0});
 const bank=kartUprightTorque({up:{x:0,y:.91,z:.41},roadNormal:{x:0,y:.91,z:.41},mass:170,pace:2,contacts:4});
 assert(Math.abs(bank.x)<1,'inclined road is not forcibly flattened');
});

test('ring auto-scale and matching export radius share the same Blender source',()=>{
 const addon=read('blender_addon/lab5_splat_packager/__init__.py');
 const builder=read('blender_addon/lab5_splat_packager/track_builder.py');
 const exporter=read('blender_addon/lab5_splat_packager/exporter.py');
 assert(addon.includes('air_ring_auto_scale:BoolProperty'));
 assert(addon.includes("default=2.5,min=2.5,max=20"));
 assert(builder.includes('float(scene.lab5_pack.air_ring_radius)*factor'));
 assert(builder.includes("offset['lab5_ring_radius']=automatic_radius"));
 assert(builder.includes("ring['lab5_visual_radius']=radius"));
 assert(exporter.includes("radius=float(ob.get('lab5_ring_radius',scene.lab5_pack.air_ring_radius))"));
});

test('rival class selection gives hover or drone player a matching NPC, while allowing all-three class races',()=>{
 const solo=raceRoster(1,3),duo=raceRoster(2,2);
 assert.deepEqual(npcAirChoice(solo,['hover'],DEFAULT_VEHICLES,8),['hover','hover','drone','kart']);
 assert.deepEqual(npcAirChoice(solo,['drone'],DEFAULT_VEHICLES,8),['drone','drone','hover','kart']);
 assert.deepEqual(npcAirChoice(solo,['kart'],DEFAULT_VEHICLES,8),['kart','hover','drone','kart']);
 assert.deepEqual(npcAirChoice(duo,['kart','kart'],DEFAULT_VEHICLES,8),['kart','kart','hover','drone']);
 assert.deepEqual(npcAirChoice(duo,['hover','drone'],DEFAULT_VEHICLES,8),['hover','drone','hover','drone']);
 assert.deepEqual(npcAirChoice(solo,['kart'],DEFAULT_VEHICLES,0),['kart','kart','kart','kart']);
});

test('flight NPC ascends to raised ring, descends to lower next gate, steers and brakes for 3D obstacle',()=>{
 const car={id:'p3',spec:{type:'DRONE'},x:0,y:3,z:0,yaw:0,vx:0,vz:0};
 const race={next:0};
 let res=stepAirNpc(car,gates,race,npcAirState(),1/60,{difficulty:'hard',pace:2});
 assert(res.input.drift);assert(!res.input.descend);assert(res.input.throttle>0);assert(res.diagnostics.distance>0);
 car.y=15;res=stepAirNpc(car,gates,race,res.state,1/60,{pace:1});assert(res.input.descend);
 res=stepAirNpc(car,gates,race,res.state,1/60,{obstacle:{distance:1.5},pace:1});
 assert(res.input.throttle<=0,'physical obstacle forces braking');
 car.z=15;car.y=8;res=stepAirNpc(car,gates,race,res.state,1/60);
 assert(res.diagnostics.wrongSide,'missed checkpoint returns around approach side');
 assert(isNpcObstacleEntity({name:'p3 HOVER'}));assert(isNpcObstacleEntity({name:'p4 DRONE'}));
});

test('flying NPC earns progress only by crossing an oriented ring, and cannot cheat via rescue',()=>{
 const state={next:0,launched:false,laps:0};
 assert(!crossFlightGate({x:0,y:8,z:12},{x:0,y:8,z:7},gates[0]));
 assert(!crossFlightGate({x:0,y:8,z:8},{x:8,y:8,z:12},gates[0]));
 const result=advanceAirLap(state,{x:0,y:8,z:8},{x:0,y:8,z:12},gates,3);
 assert(result.crossed);assert.equal(state.next,1);assert.equal(state.laps,0);
 const npc=stepAirNpc({id:'p3',spec:{type:'HOVER'},x:0,y:8,z:12,yaw:0,vx:0,vz:0},gates,state,npcAirState());
 assert(npc.input && !('next' in npc.input),'control decision cannot award checkpoint progress');
});

test('bouncy collisions use restitution on actual dynamic hull and static walls, without overriding raycast physics',()=>{
 const src=read('src/v14/pc-scene.js');
 assert.match(src,/mass:T.massKg,friction:\.40,restitution:\.64/);
 assert.match(src,/friction:\.75,restitution:\.72/);
 assert.match(src,/mass:spec.mass,friction:\.35,restitution:\.56/);
 const ray=read('src/v17/raycast-kart.js');
 assert(ray.includes('vehicle.addWheel('));
 assert(ray.includes('kartDownforce('));
 assert(ray.includes('rig.hopAirTime>0'));
});


test('simple 3D NPC flight loop reaches two differently oriented rings in order',()=>{
 const car={id:'p3',spec:{type:'DRONE'},x:0,y:3,z:0,vx:0,vz:0,yaw:0};
 const progress={next:0,launched:false,laps:0};
 let state=npcAirState(),speed=0;const clears=[];
 for(let tick=0;tick<1100&&clears.length<2;tick++){
  const {state:next,input}=stepAirNpc(car,gates,progress,state,1/60,{difficulty:'hard'});
  state=next;
  const before={x:car.x,y:car.y,z:car.z};
  car.yaw-=input.steer*1.65/60;
  speed=Math.max(-4,Math.min(9,speed+(input.throttle*4-speed*.05)/60));
  car.vx=Math.sin(car.yaw)*speed;car.vz=Math.cos(car.yaw)*speed;
  car.x+=car.vx/60;car.z+=car.vz/60;
  car.y+=(input.drift?4.6:input.descend?-4.6:0)/60;
  const passage=advanceAirLap(progress,before,car,gates,1);
  if(passage.crossed)clears.push(passage.gate);
 }
 assert.deepEqual(clears,['AIR_00','AIR_01']);
 assert.equal(progress.next,0);
});
