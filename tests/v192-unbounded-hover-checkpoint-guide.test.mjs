import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hoverHopUpdate} from '../src/vehicles/hover-drive.js';
import {driveFlyingVehicle} from '../src/vehicles/flight-controls.js';
import {nextCheckpoint,raceProgress,waypointGuidance,roadGateTarget,airGateTarget} from '../src/race/checkpoint-guide.js';
import {makeLapState,updateLaps} from '../src/race/laps.js';
import {advanceAirLap,validateAirGates} from '../src/vehicles/air-race.js';
import {vehicleCatalog} from '../src/vehicles/library.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const track={race:{gates:[{id:'start',a:{x:-3,z:0},b:{x:3,z:0}},{id:'bend',a:{x:-3,z:15},b:{x:3,z:15}}],
 waypoints:[{x:0,z:0,y:2},{x:0,z:15,y:8}]},spawns:{p1:{y:2},p2:{y:2}}};
const rings=validateAirGates([
 {id:'r0',position:[0,18,0],normal:[0,0,1],radius:2.5},
 {id:'r1',position:[0,44,15],normal:[0,0,1],radius:2.5}
]);

test('hover propulsion has cooldown and NO maximum altitude; descending returns it toward road mode',()=>{
 const c={spec:{hoverHeight:2.45,jumpSpeed:5.5,hoverHopStep:3,hoverHopInterval:.78}};
 let r=hoverHopUpdate(c,{y:2.45,vy:0,groundY:0,ascend:true,dt:1/60});
 assert(r.impulseSpeed>5);assert(r.manual);assert(r.targetY>5);
 r=hoverHopUpdate(c,{y:3,vy:4,groundY:0,ascend:true,dt:1/60});
 assert.equal(r.impulseSpeed,0,'cooldown stops impulses every frame');
 let y=3;
 for(let i=0;i<40;i++){
  y+=3.3;r=hoverHopUpdate(c,{y,vy:0,groundY:i<2?0:null,ascend:true,dt:.8});
 }
 assert(r.targetY>100,'no arbitrary competitive 3.45m or other Y-height clamp');
 const before=r.targetY;
 r=hoverHopUpdate(c,{y:before,vy:0,groundY:null,descend:true,dt:.1});
 assert(r.targetY<before,'descend controls world target at any altitude');
 r=hoverHopUpdate(c,{y:2.5,vy:-.1,groundY:0,dt:.1});
 assert(!r.manual,'normal ground-following resumes once hovercraft lands');
});

test('Ammo force + impulse mock climbs to a high Blender ring even after ground ray disappears',()=>{
 const mass=140,dt=1/60,pos={x:0,y:2.45,z:0},velocity={x:0,y:0,z:0};
 let forceY=0,impulses=0;
 const rb={linearVelocity:velocity,angularVelocity:{x:0,y:0,z:0},
  applyForce(x,y,z){forceY+=y;},applyTorque(){},applyImpulse(x,y,z){velocity.y+=y/mass;impulses++;},activate(){}};
 const car={id:'p1',entity:{rigidbody:rb,up:{x:0,y:1,z:0},right:{x:1,y:0,z:0},forward:{x:0,y:0,z:-1},getPosition(){return pos;}},
  spec:{type:'HOVER',mass,hoverHeight:2.45,jumpSpeed:5.5,maxSpeed:12.5}};
 const physics={raycastFirst:()=>pos.y<8?{point:{y:0}}:null};
 const pc={Vec3:class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}};
 let peak=pos.y;
 for(let i=0;i<1500;i++){
  const climbing=i<1150,descending=i>=1300;
  forceY=0;
  driveFlyingVehicle(car,{throttle:0,steer:0,drift:climbing,descend:descending},dt,physics,pc);
  velocity.y+=(forceY/mass-9.81)*dt;
  pos.y=Math.max(.36,pos.y+velocity.y*dt);
  if(pos.y===.36&&velocity.y<0)velocity.y=0;
  peak=Math.max(peak,pos.y);
 }
 assert(impulses>=18,'held input repeats hop pulses');
 assert(peak>44,'must physically reach a ring 44 m high');
 assert(car.hoverWorldTarget>20,'world-space height hold persists without road ray');
});

test('per-player route selection uses vehicle-specific ordered gates without sharing state',()=>{
 const p1={spec:{type:'HOVER'}},p2={spec:{type:'KART'}};
 const s1={next:1,laps:0,launched:true},s2={next:0,laps:0,launched:false};
 let a=nextCheckpoint(track,rings,p1,s1),b=nextCheckpoint(track,rings,p2,s2);
 assert.equal(a.id,'r1');assert.equal(a.position.y,44);
 assert.equal(b.id,'start');assert.equal(b.position.y,2.65);
 assert.equal(a.kind,'AIR');assert.equal(b.kind,'ROAD');
 assert.equal(raceProgress(s1,2,3),1/6);
 assert.equal(raceProgress(s2,2,3),0);
 s1.next=0;s1.laps=1;s2.next=1;s2.launched=true;
 a=nextCheckpoint(track,rings,p1,s1);b=nextCheckpoint(track,rings,p2,s2);
 assert.equal(a.id,'r0');assert.equal(b.id,'bend');
 assert.equal(raceProgress(s1,2,3),2/3);
 assert.equal(raceProgress(s2,2,3),1/6);
 assert.equal(raceProgress({...s1,laps:9},2,3),1);
});

test('direction arrows account for screen-right polarity, distance and high/low ring targets',()=>{
 const target=airGateTarget(rings,1);
 const forward={x:0,z:1},pos={x:10,y:22,z:2};
 const guide=waypointGuidance(pos,forward,target);
 assert.equal(guide.arrow,'↗','-X is screen-right when moving +Z');
 assert.equal(guide.verticalHint,'↑ 22 m');
 assert(guide.distance>24);
 const left=waypointGuidance({x:-10,y:44,z:2},forward,target);
 assert.equal(left.arrow,'↖');
 const back=waypointGuidance({x:0,y:44,z:20},forward,target);
 assert.equal(back.arrow,'↓');
});

test('real road and air gates still require directional sequential crossings and preserve state',()=>{
 const world={race:makeLapState({...track,race:{...track.race,lapsToWin:3}},3),track,bodies:[{id:'p2',x:0,z:1,spec:{type:'KART'}}]};
 const no=updateLaps(world,{p2:{x:0,z:2}});assert.deepEqual(no,[]);
 world.bodies[0].z=-1;
 const event=updateLaps(world,{p2:{x:0,z:1}});
 assert.equal(event.length,1);assert.equal(event[0].index,0);assert.equal(world.race.per.p2.next,1);
 assert.equal(world.race.per.p1.next,0);
 const flight={next:0,laps:0,launched:false};
 const bad=advanceAirLap(flight,{x:0,y:18,z:1},{x:0,y:18,z:-1},rings,3);
 assert(!bad.crossed);
 const good=advanceAirLap(flight,{x:0,y:18,z:-1},{x:0,y:18,z:1},rings,3);
 assert(good.crossed);assert.equal(flight.next,1);
});

test('HUD, physics and Blender export use the same new checkpoint / pulse contract',()=>{
 const html=read('index.html'),main=read('src/v14/main.js'),markers=read('src/v14/checkpoint-markers.js');
 const plugin=read('blender_addon/lab5_splat_packager/exporter.py');
 for(const id of ['p1','p2'])for(const field of ['target','direction','progress-bar','notice','rival'])
  assert(html.includes(`id="${id}-${field}"`));
 assert(main.includes('makeCheckpointMarkers(app)'));
 assert(markers.includes("target.kind==='AIR'"));
 assert(markers.includes('NO PHYSICS'));
 assert(main.includes("const roadEvents=updateLaps(world,before)"));
 assert(main.includes('flight.autoLeveled'));
 assert(!read('src/vehicles/flight-controls.js').includes('ceiling=competitive'));
 assert(plugin.includes("'hoverHopInterval':"));assert(plugin.includes("'hoverHopStep':"));
 const example={id:'hopcraft',type:'HOVER',label:'Hop Test',mass:140,jumpSpeed:5.5,maxSpeed:12.5,hoverHeight:2.45,
  bodyGlb:'vehicles/hopcraft.glb',hoverHopStep:5,hoverHopInterval:1.2};
 assert.equal(vehicleCatalog({vehicles:[example]}).at(-1).hoverHopStep,5);
 assert.throws(()=>vehicleCatalog({vehicles:[{...example,hoverHopInterval:0.1}]}));
});
