import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {navigationCorridor,nearestCorridorSample,routeTargetSpeed,validateDriveability} from '../src/race/npc-navigation.js';
import {planNpcTraffic,scanNpcWorldObstacles} from '../src/race/npc-traffic.js';
import {isNpcObstacleEntity,scanNpcObstacle} from '../src/race/npc-perception.js';
import {NPC_SKILL,npcRacerState,stepRaycastNpc} from '../src/race/raycast-npc.js';
import {graphicsConfiguration,GRAPHICS_PRESETS} from '../src/render/graphics-quality.js';
import {makeLanState,joinLan,sendLanInput,startLanRace,setLanReady,setLanVehicle,stepLan,lanSnapshot} from '../src/network/host-core.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('P1–P4, props and barriers are visible to NPC sensor; own body is excluded',()=>{
 for(const id of ['p1','p2','p3','p4'])assert.equal(isNpcObstacleEntity({name:id}),true,id);
 assert.equal(isNpcObstacleEntity({name:'Dynamic: Crate'}),true);
 assert.equal(isNpcObstacleEntity({name:'Wall: guardrail'}),true);
 assert.equal(isNpcObstacleEntity({name:'decorative tree'}),false);
 class V {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}}
 const car={id:'p2',yaw:0,x:0,z:0,entity:{name:'p2',getPosition:()=>new V(0,.5,0)}};
 const rays=[];
 const physics={raycastFirst(a,b,options){rays.push(options.filterCallback(car.entity));return null;}};
 const target=scanNpcObstacle(physics,car,V);
 assert.equal(target,null);assert(rays.length>0);assert(rays.every(value=>value===false));
});

test('race route is dense, immutable source, bounded and usable around sharp corners',()=>{
 const count=TRAINING_TRACK.race.waypoints.length;
 const nav=navigationCorridor(TRAINING_TRACK);
 assert(nav.points.length>=count*3);assert.equal(TRAINING_TRACK.race.waypoints.length,count);
 const curvatures=nav.points.map(p=>p.curvature);
 assert(Math.max(...curvatures)>.15);
 const near=nearestCorridorSample({x:-12,z:-8.3},nav);
 assert(near.distance<1.5);
 const bend=nav.points.findIndex(p=>p.curvature>.4);
 const slow=routeTargetSpeed(nav,bend,0,NPC_SKILL.medium);
 assert(slow.speed<8,`tight corner should slow down: ${slow.speed}`);
 assert(validateDriveability(nav).every(p=>Number.isFinite(p.index)));
});

test('other NPCs are evaluated even without engine entity refs; follow and pass respect lane clearance',()=>{
 const car={id:'p3',x:0,z:0,yaw:0,vx:0,vz:5};
 const others=[{id:'p2',x:0,z:5,yaw:0,vx:0,vz:1}];
 const pass=planNpcTraffic(car,others,{roadWidth:7,lookahead:8,obstacle:{leftClear:true,rightClear:false}});
 assert.equal(pass.leader.id,'p2');assert.equal(pass.side,-1);assert.equal(pass.reason,'pass');
 const follow=planNpcTraffic(car,others,{roadWidth:4,lookahead:8,obstacle:{leftClear:false,rightClear:false}});
 assert.equal(follow.reason,'follow');assert.equal(follow.side,0);assert(Number.isFinite(follow.desiredSpeed));
 assert.equal(planNpcTraffic(car,[car],{roadWidth:6}).neighbors,0);
});

test('LAN analytic obstacle sweep detects a visible crate without sensing a distant wall as a giant circle',()=>{
 const car={id:'p2',x:0,z:0,yaw:0};
 const track={race:{roadWidth:10,waypoints:[{x:0,z:-10},{x:0,z:0},{x:0,z:15},{x:5,z:10}]},collision:{obstacles:[{id:'crate',x:0,z:7,hx:.5,hz:.5}],walls:[{id:'wall',x:6,z:2,hx:.25,hz:30}]}};
 const scan=scanNpcWorldObstacles(car,track,[]);
 assert(scan&&scan.type==='dynamic'&&scan.distance>3,JSON.stringify(scan));
});

test('LAN room supports four authenticated players but never fifth; server owns poses and laps',()=>{
 let now=1000;let next=0;
 const state=makeLanState(TRAINING_TRACK,{now:()=>now,makeId:()=>`session${++next}`});
 const sessions=[];
 for(let i=0;i<4;i++)sessions.push(joinLan(state,'Test'+i));
 assert.deepEqual(sessions.map(p=>p.id),['p1','p2','p3','p4']);
 assert.throws(()=>joinLan(state,'Fifth'),/full/i);
 assert.equal(sendLanInput(state,'fake',{seq:1,throttle:1,x:100}),false);
 assert.equal(sendLanInput(state,sessions[0].token,{seq:1,throttle:900,x:1000,z:2000,laps:9}),true);
 const p1=state.participants.get(sessions[0].token);
 assert.equal(p1.input.throttle,1);assert.equal('x' in p1.input,false);assert.equal('laps' in p1.input,false);
 assert.equal(sendLanInput(state,sessions[0].token,{seq:1,throttle:-1}),false);
 assert.equal(p1.x,TRAINING_TRACK.spawns.p1.x);
 assert.equal(setLanVehicle(state,sessions[1].token,'DRONE'),true);
 for(const item of sessions)assert.equal(setLanReady(state,item.token,true),true);
 assert.throws(()=>startLanRace(state,sessions[1].token,{npcCount:0,laps:1}),/Only the room host/);
 assert.equal(startLanRace(state,sessions[0].token,{npcCount:0,laps:1}),true);
 assert.equal(state.phase,'countdown');now=4600;stepLan(state,1/60);assert.equal(state.phase,'race');
 for(let i=0;i<120;i++){now+=16;stepLan(state,1/60);}
 const snapshot=lanSnapshot(state);
 assert.equal(snapshot.racers.length,4);assert.equal(snapshot.maxRacers,4);
 assert.equal(snapshot.racers[0].laps,state.race.per.p1.laps);
 assert(snapshot.racers.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));
});

test('LAN solo host can fill other three slots with NPCs and preserve checkpoints',()=>{
 let now=0;const s=makeLanState(TRAINING_TRACK,{now:()=>now,makeId:()=> 'host'});
 const host=joinLan(s,'Host');assert.equal(setLanReady(s,host.token,true),true);
 assert.equal(startLanRace(s,host.token,{npcCount:3,laps:3,difficulty:'easy',pace:1}),true);
 assert.deepEqual([...s.ai.keys()],['p2','p3','p4']);
 now=4000;for(let i=0;i<600;i++)stepLan(s,1/60);
 assert.equal(lanSnapshot(s).racers.length,4);
 assert(s.ai.size===3);assert(s.race);
 assert(s.ai.get('p2').npcState?.phase);
});

test('graphics choice preserves GLB UVs and limits author exposure while keeping backend WebGL',()=>{
 assert.equal(GRAPHICS_PRESETS.balanced.shadowResolution,1536);
 assert(graphicsConfiguration('quality',{rendering:{exposure:1.4,fogDistance:150}}).exposure>1.3);
 assert.equal(graphicsConfiguration('performance',{rendering:{fogDistance:-5}}).fogDistance,0);
 assert.throws(()=>graphicsConfiguration('quality',{rendering:{environmentAtlas:'../../outside'}}));
 assert.match(read('src/v14/main.js'),/new pc\.Application\(/);
 assert.match(read('blender_addon/lab5_splat_packager/exporter.py'),/def _write_curve_road_uv/);
 assert.match(read('blender_addon/lab5_splat_packager/exporter.py'),/mesh\.uv_layers\.active=uv/);
 assert.match(read('blender_addon/lab5_splat_packager/exporter.py'),/rendering\['environmentAtlas'\]/);
 assert.match(read('blender_addon/lab5_splat_packager/__init__.py'),/render_environment_atlas/);
});

test('three medium NPCs escape traffic congestion and produce a winner on training circuit',()=>{
 let now=0;
 const state=makeLanState(TRAINING_TRACK,{now:()=>now,makeId:()=> 'host'});
 const host=joinLan(state,'Parked human');setLanReady(state,host.token,true);
 startLanRace(state,host.token,{npcCount:3,laps:1,pace:1,difficulty:'medium'});
 now=4000;
 for(let i=0;i<60*120&&state.phase!=='results';i++)stepLan(state,1/60);
 assert.equal(state.phase,'results','three-NPC traffic jam should end with a race winner within 120 simulated seconds');
 assert.equal(lanSnapshot(state).winner,'p2');
});
