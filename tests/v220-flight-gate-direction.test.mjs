import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacyFlightGates,inspectFlightCourse,validateAirGates,crossFlightGate,advanceAirLap} from '../src/vehicles/air-race.js';
import {stepAirNpc,npcAirState,planAirGateApproach} from '../src/race/air-npc.js';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const gate=(id,x,y,z,nx,ny,nz,r=3.5)=>({id,position:[x,y,z],normal:[nx,ny,nz],radius:r});

test('training fallback gate 0 follows the start line, NOT waypoint 0 behind the players',()=>{
 const g=legacyFlightGates(TRAINING_TRACK);
 assert.equal(g.length,8);
 assert.equal(g[0].id,'LEGACY_AIR_0');
 const start=TRAINING_TRACK.spawns.p1;
 const to={x:g[0].position[0]-start.x,z:g[0].position[2]-start.z};
 assert(to.x*Math.sin(start.yaw)+to.z*Math.cos(start.yaw)>g[0].radius+4);
 assert(inspectFlightCourse(g,TRAINING_TRACK.spawns).ok);
 const old=TRAINING_TRACK.race.waypoints[0];
 assert(old.x<start.x,'the old first waypoint is indeed behind the sample grid');
});

test('fallback gate heading follows reversed waypoint order when the path data are reversed',()=>{
 const mirrored=structuredClone(TRAINING_TRACK);
 mirrored.race.waypoints.reverse();
 const gates=legacyFlightGates(mirrored);
 assert(inspectFlightCourse(gates,mirrored.spawns).ok);
 assert(gates[0].normal[0]>.5,'reversing the path array should not reverse the race');
});

test('flight course warnings expose backwards normals, first ring behind spawn and nearly overlapping rings',()=>{
 const spawns={p1:{x:0,y:1,z:0,yaw:0},p2:{x:1,y:1,z:0,yaw:0}};
 const good=[gate('first',0,4,10,0,0,1),gate('second',0,4,24,0,0,1)];
 assert(inspectFlightCourse(good,spawns).ok);
 const bad=[gate('first',0,4,-4,0,0,-1),gate('second',0,4,-4.1,0,0,1)];
 const report=inspectFlightCourse(bad,spawns);
 assert(!report.ok);
 assert(report.warnings.some(x=>x.includes('ahead')));
 assert(report.warnings.some(x=>x.includes('coincident')));
});

test('flight AI stages behind the oriented ring, commits when aligned and reapproaches after a miss',()=>{
 const g=gate('start',0,8,10,0,0,1,3.7);
 const aligned=planAirGateApproach({x:0,y:8,z:0},g);
 assert.equal(aligned.phase,'CROSS');
 assert(aligned.target.z>10);
 const offaxis=planAirGateApproach({x:7,y:8,z:0},g);
 assert.equal(offaxis.phase,'ALIGN');assert(offaxis.target.z<10);
 const missed=planAirGateApproach({x:0,y:8,z:17},g);
 assert.equal(missed.phase,'REAPPROACH');assert(missed.target.z<10);
 const car={id:'p3',spec:{type:'DRONE'},x:0,y:8,z:17,yaw:Math.PI,vx:0,vz:0};
 const result=stepAirNpc(car,[g],{next:0},npcAirState(),1/60);
 assert.equal(result.diagnostics.phase,'REAPPROACH');
 assert.equal(result.diagnostics.wrongSide,true);
 assert.equal(result.diagnostics.committed,false);
});

test('backwards and off-axis crossings NEVER advance laps, even with very large rings',()=>{
 const g=validateAirGates([gate('r',0,7,12,0,0,1,7)])[0];
 const state={next:0,launched:false,laps:0};
 assert(!advanceAirLap(state,{x:0,y:7,z:15},{x:0,y:7,z:9},[g],1).crossed);
 assert(!advanceAirLap(state,{x:8,y:7,z:10},{x:8,y:7,z:14},[g],1).crossed);
 assert.equal(state.next,0);
 assert(advanceAirLap(state,{x:0,y:7,z:10},{x:0,y:7,z:14},[g],1).crossed);
 assert.equal(state.laps,0);
});

test('Blender export refreshes generated ring anchors and still preserves individual AIR_OFFSET edits',()=>{
 const addon=text('blender_addon/lab5_splat_packager/__init__.py');
 const builder=text('blender_addon/lab5_splat_packager/track_builder.py');
 const exporter=text('blender_addon/lab5_splat_packager/exporter.py');
 assert(addon.includes('air_gate_min_start_clearance:FloatProperty'));
 assert(builder.includes('fraction=max(nominal,clearance/perimeter)'));
 assert(builder.includes('offset.parent=anchor'));
 assert(builder.includes('tangent=(positions[j]-positions[i]).normalized()'));
 assert(exporter.includes('if refresh_air_gates(scene)<count'));
 assert(exporter.includes('P1 spawn is not on AIR_00 entry side'));
 assert(exporter.includes('firstAirRingDistanceMeters'));
});

/** Fixed-step headless route smoke test: not intended to substitute Ammo. */
function runFlightCourse(type,gates,{x=0,y=3,z=0,yaw=0}={},limit=5200){
 const car={id:'p3',spec:{type},x,y,z,yaw,vx:0,vz:0};
 const progress={next:0,launched:false,laps:0};
 let state=npcAirState(),speed=0;const clears=[];
 for(let tick=0;tick<limit&&clears.length<gates.length;tick++){
  const decision=stepAirNpc(car,gates,progress,state,1/60,{difficulty:'hard'});
  state=decision.state;
  const before={x:car.x,y:car.y,z:car.z};
  car.yaw-=decision.input.steer*1.65/60;
  speed=Math.max(-3,Math.min(10,speed+(decision.input.throttle*4-speed*.06)/60));
  car.vx=Math.sin(car.yaw)*speed;car.vz=Math.cos(car.yaw)*speed;
  car.x+=car.vx/60;car.z+=car.vz/60;
  car.y+=(decision.input.drift?4.6:decision.input.descend?-4.6:0)/60;
  const passed=advanceAirLap(progress,before,car,gates,1);
  if(passed.crossed)clears.push(passed.gate);
 }
 return clears;
}

test('hovercraft and drone clear offset, elevated, 90-degree and reverse-facing segments in authored order',()=>{
 const gates=validateAirGates([
  gate('R0',0,8,12,0,0,1,3.7),
  gate('R1',10,13,24,1,0,0,4.1),
  gate('R2',21,6,28,0,0,1,3.7),
  gate('R3',16,7,40,-1,0,0,4.0)
 ]);
 for(const type of ['DRONE','HOVER']){
  const cleared=runFlightCourse(type,gates);
  assert.deepEqual(cleared,gates.map(g=>g.id),`${type} should navigate four differently oriented rings in sequence; got ${cleared.join(',')}`);
 }
});

test('three mixed air NPCs do not all aim for the same point or skip gates in a queued grid',()=>{
 const gates=validateAirGates([
  gate('G0',0,7,12,0,0,1,4),
  gate('G1',10,10,24,1,0,0,4),
  gate('G2',18,6,31,0,0,1,4)
 ]);
 const cars=[
  {id:'p2',spec:{type:'HOVER'},x:-2,y:3,z:0,yaw:0},
  {id:'p3',spec:{type:'DRONE'},x:0,y:3,z:-3,yaw:0},
  {id:'p4',spec:{type:'HOVER'},x:2,y:3,z:-6,yaw:0}
 ];
 const progress=Object.fromEntries(cars.map(c=>[c.id,{next:0,launched:false,laps:0}]));
 const states=Object.fromEntries(cars.map(c=>[c.id,npcAirState()]));
 const speeds=Object.fromEntries(cars.map(c=>[c.id,0]));
 const clears=Object.fromEntries(cars.map(c=>[c.id,[]]));
 for(let tick=0;tick<5000;tick++){
  for(const car of cars){
   if(clears[car.id].length===gates.length)continue;
   const result=stepAirNpc(car,gates,progress[car.id],states[car.id],1/60,{difficulty:'hard',others:cars.filter(c=>c.id!==car.id)});
   states[car.id]=result.state;
   const before={x:car.x,y:car.y,z:car.z};
   car.yaw-=result.input.steer*1.65/60;
   const speed=speeds[car.id]=Math.max(-3,Math.min(10,speeds[car.id]+(result.input.throttle*4-speeds[car.id]*.06)/60));
   car.vx=Math.sin(car.yaw)*speed;car.vz=Math.cos(car.yaw)*speed;
   car.x+=car.vx/60;car.z+=car.vz/60;
   car.y+=(result.input.drift?4.6:result.input.descend?-4.6:0)/60;
   const pass=advanceAirLap(progress[car.id],before,car,gates,1);
   if(pass.crossed)clears[car.id].push(pass.gate);
  }
  if(cars.every(c=>clears[c.id].length===gates.length))break;
 }
 for(const car of cars)assert.deepEqual(clears[car.id],gates.map(g=>g.id),`${car.id} could not complete traffic route`);
 const finishPositions=cars.map(c=>c.x);
 assert(Math.max(...finishPositions)-Math.min(...finishPositions)>1,'per-NPC gate lane targets prevent identical race-line convergence');
});
