import test from 'node:test';import assert from 'node:assert/strict';
import {makeWorld,stepWorld,STEP} from '../src/physics/engine.js';
import {npcInput,AI_LEVELS} from '../src/race/ai-driver.js';
import {gateCrossing,updateLaps} from '../src/race/laps.js';
import {validateTrack,DEFAULT_TRACK,terrainHeight} from '../src/track/track.js';
const car=(w,id)=>w.bodies.find(b=>b.id===id);
function crossGate(world,id,i){
 const g=world.track.race.gates[i],a=g.a,b=g.b,
 dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz),n={x:dz/L,z:-dx/L},mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
 const before={x:mid.x-n.x*.35,z:mid.z-n.z*.35};
 const p=car(world,id);Object.assign(p,{x:mid.x+n.x*.35,z:mid.z+n.z*.35});
 updateLaps(world,{[id]:before});
}
test('directional gate rejects wrong-way crossing and outside segment',()=>{
 const gate=DEFAULT_TRACK.race.gates[0];
 assert.equal(gateCrossing({x:-4.9,z:-8},{x:-4.5,z:-8},gate),true);
 assert.equal(gateCrossing({x:-4.5,z:-8},{x:-4.9,z:-8},gate),false);
 assert.equal(gateCrossing({x:-4.9,z:15},{x:-4.5,z:15},gate),false);
});
test('ordered gates: no short lap with finish stripe alone',()=>{
 const w=makeWorld('local');
 crossGate(w,'p1',0);assert.equal(w.race.per.p1.laps,0);
 crossGate(w,'p1',0);assert.equal(w.race.per.p1.laps,0);
 crossGate(w,'p1',3);assert.equal(w.race.per.p1.next,1);
 for(const i of [1,2,3,0])crossGate(w,'p1',i);
 assert.equal(w.race.per.p1.laps,1);
});
test('after five complete laps race stops and stores correct winner',()=>{
 const w=makeWorld('local');crossGate(w,'p2',0);
 for(let lap=0;lap<5;lap++)for(const i of [1,2,3,0])crossGate(w,'p2',i);
 assert.equal(w.race.per.p2.laps,5);assert.equal(w.race.finished,true);assert.equal(w.race.winner,'p2');
 const previous=w.ticks;stepWorld(w,{p1:{throttle:1}},STEP);assert.equal(w.ticks,previous);
});
test('custom Blender track boxes support yaw and dynamic obstacles',()=>{
 const track=JSON.parse(JSON.stringify(DEFAULT_TRACK));
 track.collision.walls[0].yaw=.5;track.visuals={mode:'boxes',boxes:[{x:0,y:0,z:0,w:4,h:.2,d:4}]};
 assert.equal(validateTrack(track).collision.walls[0].yaw,.5);
 const w=makeWorld('solo',{track});assert.equal(w.staticBodies[0].yaw,.5);
 assert.equal(typeof car(w,'p1').getHeight,'function');
 assert.throws(()=>validateTrack({...track,race:{...track.race,waypoints:[]}}),/waypoints/);
});
test('heightfield is sampled together with bump',()=>{
 const t=JSON.parse(JSON.stringify(DEFAULT_TRACK));
 t.collision.heightfield={origin:{x:0,z:0},cellSize:1,width:2,depth:2,samples:[0,.2,.4,.6]};
 assert.ok(Math.abs(terrainHeight(t,.5,.5)-.3)<1e-10);
});
test('easy medium hard progressively increase NPC speed target and retain finite control',()=>{
 const b=car(makeWorld('solo'),'p2');
 assert.ok(AI_LEVELS.easy.cruise<AI_LEVELS.medium.cruise&&AI_LEVELS.medium.cruise<AI_LEVELS.hard.cruise);
 for(const difficulty of Object.keys(AI_LEVELS)){
  const c=npcInput(b,DEFAULT_TRACK,difficulty);assert.ok([c.throttle,c.steer,c.target.x,c.target.z].every(Number.isFinite));
 }
});
test('NPC drives five laps on every difficulty without wrong-way spins',()=>{
 for(const difficulty of Object.keys(AI_LEVELS)){
   const w=makeWorld('solo',{difficulty});
   for(let i=0;i<120*150&&!w.race.finished;i++)stepWorld(w,{},STEP);
   assert.equal(w.race.winner,'p2',`${difficulty} NPC finished`);
   assert.equal(w.race.per.p2.laps,5);
 }
});
test('human p1 can win the solo race against easy NPC',()=>{
 const w=makeWorld('solo',{difficulty:'easy'});
 for(let i=0;i<120*130&&!w.race.finished;i++){
   const human=npcInput(car(w,'p1'),w.track,'medium');
   stepWorld(w,{p1:human},STEP);
 }
 assert.equal(w.race.winner,'p1');assert.equal(w.race.per.p1.laps,5);
});
test('easy NPC can recover from a severe collision-induced spin',()=>{
 const w=makeWorld('solo',{difficulty:'easy'});
 for(let i=0;i<600;i++)stepWorld(w,{},STEP);
 const b=car(w,'p2');b.yaw+=3;b.omega=5;b.vx=0;b.vz=0;
 for(let i=0;i<120*160&&!w.race.finished;i++)stepWorld(w,{},STEP);
 assert.equal(w.race.winner,'p2');assert.equal(w.race.per.p2.laps,5);
 assert.ok(w.aiRecoveries>=1);
});
