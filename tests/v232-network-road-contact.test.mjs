import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {createNetworkRoadSurface,navigationSurface} from '../src/network/road-surface.js';
import {makeLanState,joinLan,setLanReady,startLanRace,sendLanInput,stepLan} from '../src/network/host-core.js';
const path=new URL('../assets/',import.meta.url);
const pack=JSON.parse(readFileSync(new URL('asset-pack.json',path),'utf8'));
const track=JSON.parse(readFileSync(new URL('track.json',path),'utf8'));
test('Real Blender collision GLB has usable drivable triangles and height at grid and high road',()=>{
 const bytes=readFileSync(new URL(pack.staticCollisionGlb,path));
 const surface=createNetworkRoadSurface(track,bytes);
 assert.equal(surface.source,'collision-glb');
 assert(surface.triangles>20,'Collider must include drivable road triangle geometry');
 const p1=surface.sample(track.spawns.p1.x,track.spawns.p1.z);
 assert.equal(p1.source,'collision-glb','P1 should start on a physical road triangle');
 assert(Number.isFinite(p1.height));
 const crest=track.race.navigation.points.reduce((a,b)=>a.y>b.y?a:b);
 const hill=surface.sample(crest.x,crest.z,crest.y);
 assert.equal(hill.source,'collision-glb','Highest point on the course must have collision');
 assert(hill.height>5,'High road must be well above spawn road');
});
test('Network kart and NPC height follows slopes on every physics tick instead of spawn Y',()=>{
 let now=0,seq=0;
 const rising={source:'test',sample:(x,z)=>({height:x*.4,distance:0,onRoad:true,source:'test'})};
 const s=makeLanState(TRAINING_TRACK,{now:()=>now,makeId:()=>String(++seq),surface:rising});
 const host=joinLan(s,'Host'),second=joinLan(s,'Guest');
 assert.equal(s.participants.get(host.token).y, s.participants.get(host.token).x*.4+.67);
 for(const x of [host,second])setLanReady(s,x.token,true);
 startLanRace(s,host.token,{laps:1,npcCount:0,pace:1});
 now=4000;stepLan(s,1/60);
 for(let i=1;i<=180;i++){
  now+=16;
  sendLanInput(s,host.token,{seq:i,throttle:1,steer:0});
  sendLanInput(s,second.token,{seq:i,throttle:1,steer:0});
  stepLan(s,1/60);
 }
 for(const p of [s.participants.get(host.token),s.participants.get(second.token)]){
  assert(p.x>0,'Kart should have travelled along ramp');
  assert(Math.abs(p.y-(p.x*.4+.67))<1e-6,'Kart chassis must track current road surface');
 }
});
test('Navigation fallback samples authored 3D course height rather than global Y=0',()=>{
 const surface=navigationSurface(track);
 const crest=track.race.navigation.points.reduce((a,b)=>a.y>b.y?a:b);
 const sample=surface(crest.x,crest.z);
 assert(Math.abs(sample.height-crest.y)<.02);
 assert(sample.onRoad);
});
