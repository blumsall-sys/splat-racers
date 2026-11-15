import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeBoostState,stepBoost,boostLabel,BOOST} from '../src/race/boost.js';
import {fromPad,fromKeys} from '../src/input/controls.js';
import {raycastCommands,RAYCAST_TUNING} from '../src/v17/raycast-kart.js';
import {closestLinePoint,deathZone,findRoadRespawn} from '../src/race/recovery.js';
import {makeLapState,updateLaps} from '../src/race/laps.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const line=[{x:0,z:0},{x:20,z:0},{x:20,z:20},{x:0,z:20}];
const track={race:{waypoints:line,roadWidth:7,lapsToWin:5,gates:[{id:'start',a:{x:2,z:-2},b:{x:2,z:2}},{id:'north',a:{x:20,z:8},b:{x:24,z:8}},{id:'west',a:{x:8,z:20},b:{x:8,z:24}}]}};
test('B engages nitro but never steals A/X hop or Y reset on standard controller',()=>{
 const pad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 pad.buttons[1].pressed=true;
 let input=fromPad(pad);assert.equal(input.boost,true);assert.equal(input.drift,false);assert.equal(input.reset,false);
 pad.buttons[0].pressed=true;input=fromPad(pad);assert.equal(input.drift,true);assert.equal(input.boost,true);
 pad.buttons[3].pressed=true;assert.equal(fromPad(pad).reset,true);
});
test('separate keyboard nitro and reset for both players',()=>{
 let keys=new Set(['KeyW','Space','ArrowUp','KeyM']);
 assert.equal(fromKeys(keys,'p1').boost,true);assert.equal(fromKeys(keys,'p2').boost,true);
 assert.equal(fromKeys(keys,'p1').throttle,1);assert.equal(fromKeys(keys,'p2').throttle,1);
 keys=new Set(['Numpad0','ShiftRight','ShiftLeft']);
 assert.equal(fromKeys(keys,'p2').boost,true);assert.equal(fromKeys(keys,'p2').drift,true);
 assert.equal(fromKeys(keys,'p1').drift,true);
});
test('nitro triggers on a fresh press, recharges in five seconds and cannot retrigger while held',()=>{
 const s=makeBoostState();let r=stepBoost(s,true,1/60);
 assert.equal(r.triggered,true);assert.equal(r.remaining,BOOST.cooldown);assert.equal(r.active,true);
 for(let i=0;i<60;i++)r=stepBoost(s,true,1/60);
 assert.equal(r.triggered,false);assert.equal(r.active,false);assert.match(boostLabel(s),/NITRO/);
 for(let i=0;i<250;i++)r=stepBoost(s,false,1/60);
 assert.equal(r.remaining,0);assert.equal(boostLabel(s),'NITRO READY');
 assert.equal(stepBoost(s,true,1/60).triggered,true);
});
test('boost extends engine/speed only when active; normal steering and braking are identical',()=>{
 const plain=raycastCommands({throttle:1,steer:.6},5,0,1/60);
 const boosted=raycastCommands({throttle:1,steer:.6,boostActive:true},5,0,1/60);
 assert.equal(plain.engine,RAYCAST_TUNING.engineForcePerRearWheel);
 assert.ok(boosted.engine>plain.engine);
 assert.equal(boosted.steeringValue,plain.steeringValue);
 assert.equal(boosted.brake,plain.brake);
 assert.equal(raycastCommands({throttle:-1,boostActive:true},0,0,1/60).engine,raycastCommands({throttle:-1},0,0,1/60).engine);
 assert.ok(raycastCommands({throttle:1,boostActive:true},14,0,1/60).engine>0);
});
test('closest rejoin point follows current segment, not original starting grid',()=>{
 const nearest=closestLinePoint(line,16,-2);
 assert.equal(nearest.x,16);assert.equal(nearest.z,0);assert.equal(nearest.index,0);
 assert.ok(Math.abs(nearest.yaw-Math.PI/2)<1e-8);
});
test('death volume uses last road height, not a global fixed Y',()=>{
 const last={x:10,z:0,roadY:18};
 assert.equal(deathZone(track,{x:10,y:18,z:0},last).shouldRespawn,false);
 assert.equal(deathZone(track,{x:10,y:10,z:0},last).fell,true);
 assert.equal(deathZone(track,{x:120,y:18,z:0},last).outside,true);
 assert.equal(deathZone(track,{x:11,y:18,z:0},last).outside,false);
});
test('rejoin performs physical road checks and returns nearby centreline with correct height',()=>{
 class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}
 const physics={raycastFirst(from,to,{filterCallback}={}){if(!filterCallback({name:'EXPORTED_GEN_RoadCollision',tags:{has:v=>v==='lab5-drivable-road'}}))return null;return {point:{x:from.x,y:18,z:from.z},normal:{y:1}};}};
 const position=findRoadRespawn(track,physics,Vec3,{x:16,y:10,z:-3},{x:-3,z:5},{x:15,z:-1,roadY:18},.67);
 assert.ok(position);assert.ok(Math.hypot(position.x-16,position.z+3)<5);
 assert.ok(Math.abs(position.y-18.67)<1e-7);
 assert.ok(Math.abs(position.yaw-Math.PI/2)<1e-7);
});
test('ordered checkpoint progression remains separate from respawn and completed laps are retained',()=>{
 const w={track,bodies:[{id:'p1',x:4,z:0}],race:makeLapState(track)};
 w.race.per.p1={laps:3,next:1,launched:true};
 const saved=structuredClone(w.race.per.p1);
 updateLaps(w,{p1:{x:-100,z:0}}); // teleport cannot count gates
 assert.deepEqual(w.race.per.p1,saved);
 const source=read('src/v14/main.js');
 assert.doesNotMatch(source,/resetLap\(world,car\.id\)/);
 assert.match(source,/if\(newRace\|\|!car\.boost\)/);
 assert.match(source,/recoverCar\(car,before,'manual'\)/);
});
test('two-player HUD is explicitly enabled only in local mode and displays independent cooldowns',()=>{
 const html=read('index.html'),js=read('src/v14/main.js'),css=read('src/site.css');
 for(const id of ['p1-laps','p2-laps','p1-boost','p2-boost','p2-panel'])assert.ok(html.includes(`id="${id}"`));
 assert.match(js,/\$\('p2-panel'\)\.hidden=!game\|\|mode!=='local'/);
 assert.match(js,/\$\(car\.id\+'-boost'\)\.textContent=/);
 assert.match(css,/\.speed-panel\[hidden\]/);
});
test('Blender procedural finish line uses adjustable curve fraction, exports a mesh without collider',()=>{
 const addon=read('blender_addon/lab5_splat_packager/__init__.py');
 const gen=read('blender_addon/lab5_splat_packager/track_builder.py');
 const exp=read('blender_addon/lab5_splat_packager/exporter.py');
 assert.match(addon,/start_percent:FloatProperty/);
 assert.match(addon,/layout\.prop\(p,'start_percent'\)/);
 assert.match(gen,/_samples_with_frames\(curve,32,float\(scene\.lab5_pack\.start_percent\)\/100\.0\)/);
 assert.match(gen,/def _update_finish_visual/);
 assert.match(gen,/name='GEN_FinishLine'/);
 assert.match(gen,/coll=_child\(root,'RACE_VISUALS'\)/);
 assert.match(exp,/finishLineInVisuals/);
 assert.match(read('src/v14/pc-scene.js'),/CHECKERED FINISH — VISUAL ONLY/);
});
test('boost B requires fresh press after entering or resuming race; menus retain B back',()=>{
 const input=read('src/input/controls.js'),menu=read('src/input/menu-gamepad.js');
 assert.match(input,/this\.boostGate\.p1=true/);
 assert.match(input,/if\(!pad\.boost\)this\.boostGate\[id\]=false/);
 assert.match(input,/boost:keys\.boost\|\|\(!this\.boostGate\[id\]&&pad\.boost\)/);
 assert.match(menu,/back:v\(1\)>\.5/);
});
