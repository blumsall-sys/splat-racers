import {trackEffect} from '../race/track-effect.js';
/** Experimental LAN host simulation. All positions/laps are server-owned.
 * This is a self-contained fixed-step, kinematic arcade controller for LAN
 * testing, not yet a headless Ammo raycast vehicle. No browser / PlayCanvas.
 */
const randomUUID=()=>globalThis.crypto.randomUUID();
import {ensureGridSpawns,racerResults} from '../race/roster.js';
import {makeLapState,updateLaps} from '../race/laps.js';
import {stepRaycastNpc,npcRacerState} from '../race/raycast-npc.js';
import {navigationCorridor,nearestCorridorSample} from '../race/npc-navigation.js';
import {scanNpcWorldObstacles} from '../race/npc-traffic.js';
import {advanceAirLap,legacyFlightGates} from '../vehicles/air-race.js';
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const limit=v=>Number.isFinite(v)?v:0;
const allowedPace=[.75,1,1.25,1.5,2,2.5];
export const LAN_MAX_RACERS=4;
export function cleanInput(data={}){
 return {throttle:clamp(limit(Number(data.throttle)),-1,1),steer:clamp(limit(Number(data.steer)),-1,1),
  ascend:!!data.ascend,descend:!!data.descend,boost:!!data.boost,
  seq:clamp(Math.floor(limit(Number(data.seq))),0,2147483647)};
}
export function makeLanState(track,{now=()=>Date.now(),makeId=randomUUID}={}){
 const spawns=ensureGridSpawns(track.spawns);
 const state={track,spawns,phase:'lobby',participants:new Map(),npcCount:0,laps:3,pace:1,difficulty:'medium',
  ai:new Map(),race:null,startedAt:null,finishedAt:null,countdownTo:null,now,makeId,tick:0,simClock:0};
 return state;
}
function availableId(s){return ['p1','p2','p3','p4'].find(id=>![...s.participants.values()].some(p=>p.id===id))||null;}
export function joinLan(s,name='RACER'){
 if(s.phase!=='lobby')throw new Error('Race is already starting; return to lobby first');
 const id=availableId(s);if(!id)throw new Error('Room full (four human racers maximum)');
 const token=s.makeId(),player={id,token,label:String(name||'RACER').trim().slice(0,24)||'RACER',
  vehicle:'KART',ready:false,input:cleanInput(),inputSeq:0,lastInputMs:s.now(),x:s.spawns[id].x,z:s.spawns[id].z,
  y:s.spawns[id].y??0,yaw:s.spawns[id].yaw||0,speed:0,vy:0,vx:0,vz:0,boostLeft:0,boostCooldown:0,
  isNpc:false};
 s.participants.set(token,player);return {token,id};
}
export function leaveLan(s,token){const p=s.participants.get(token);if(!p)return false;s.participants.delete(token);if(s.phase==='countdown'||s.phase==='race'){
 // Player departure leaves a neutral ghost until the next lobby; never
 // reallocate that slot or award laps for a teleport during an active race.
 p.input=cleanInput();p.disconnected=true;s.participants.set('disconnected:'+p.id,p);
 }return true;}
export function setLanVehicle(s,token,type){const p=s.participants.get(token);if(!p||s.phase!=='lobby')return false;
 if(!['KART','HOVER','DRONE'].includes(type))return false;p.vehicle=type;p.ready=false;return true;}
export function setLanReady(s,token,value){const p=s.participants.get(token);if(!p||s.phase!=='lobby')return false;p.ready=!!value;return true;}
export function sendLanInput(s,token,raw){const p=s.participants.get(token);if(!p||p.disconnected)return false;
 const input=cleanInput(raw);if(input.seq<=p.inputSeq)return false;
 p.input=input;p.inputSeq=input.seq;p.lastInputMs=s.now();return true;}
export function startLanRace(s,token,{npcCount=0,laps=3,pace=1,difficulty='medium'}={}){
 const racers=[...s.participants.values()].filter(p=>!p.disconnected);
 if(s.phase!=='lobby'||!racers.length||s.participants.get(token)?.id!=='p1')throw new Error('Only the room host (P1) can start');
 if(!racers.every(p=>p.ready))throw new Error('All connected racers must be ready');
 npcCount=Number(npcCount);
 if(!Number.isInteger(npcCount)||npcCount<0||npcCount+racers.length>4)throw new Error('Maximum four racers including NPCs');
 if(![1,3,5].includes(Number(laps))||!allowedPace.includes(Number(pace))||!['easy','medium','hard'].includes(difficulty))throw new Error('Invalid race setup');
 s.npcCount=npcCount;s.laps=Number(laps);s.pace=Number(pace);s.difficulty=difficulty;
 s.ai.clear();
 const active=new Set(racers.map(p=>p.id));
 for(const id of ['p1','p2','p3','p4']){
  if(s.ai.size>=npcCount)break;
  if(active.has(id))continue;
  const sp=s.spawns[id];s.ai.set(id,{id,label:'NPC '+(s.ai.size+1),vehicle:'KART',isNpc:true,x:sp.x,z:sp.z,y:sp.y??0,yaw:sp.yaw||0,
   speed:0,vx:0,vz:0,vy:0,npcState:npcRacerState(),input:cleanInput()});
 }
 for(const player of racers){const sp=s.spawns[player.id];Object.assign(player,{x:sp.x,z:sp.z,y:sp.y??0,yaw:sp.yaw||0,speed:0,vx:0,vz:0,vy:0,effectTime:0,effectZone:null,boostLeft:0,boostCooldown:0,input:cleanInput(),inputSeq:0});}
 const all=[...racers,...s.ai.values()];s.race=makeLapState(s.track,s.laps,all.map(p=>p.id));
 s.phase='countdown';s.countdownTo=s.now()+3500;s.startedAt=s.now();s.finishedAt=null;s.simClock=0;
 return true;
}
export function resetLanLobby(s,token){if(s.participants.get(token)?.id!=='p1')return false;
 s.phase='lobby';s.ai.clear();s.race=null;s.countdownTo=null;
 for(const [key,p] of s.participants)if(p.disconnected)s.participants.delete(key);else p.ready=false;
 return true;
}
export function lanRacers(s){return [...s.participants.values(),...s.ai.values()];}
function bounceWalls(p,walls,old){
 // Static yaw boxes approximate Blender wall collision for LAN validation.
 // Arbitrary wall mesh GLB is deliberately NOT used here; see limitations.
 for(const w of walls||[]){
  const a=w.yaw||0,c=Math.cos(a),si=Math.sin(a),dx=p.x-w.x,dz=p.z-w.z;
  const localX=c*dx-si*dz,localZ=si*dx+c*dz;
  const hx=(w.hx||0)+.65,hz=(w.hz||0)+.65;
  if(Math.abs(localX)>=hx||Math.abs(localZ)>=hz)continue;
  if(Math.abs(localX/hx)>Math.abs(localZ/hz)){
   const x=Math.sign(localX||1)*hx;p.x=w.x+c*x+si*localZ;p.z=w.z-si*x+c*localZ;
  }else{const z=Math.sign(localZ||1)*hz;p.x=w.x+c*localX+si*z;p.z=w.z-si*localX+c*z;}
  p.speed*=.32;
 }
 for(const o of sObstacles(old)||[]){const dx=p.x-o.x,dz=p.z-o.z,dist=Math.hypot(dx,dz),r=.8+Math.max(o.hx||.5,o.hz||.5);
  if(dist<r){const n=Math.max(.01,dist);p.x=o.x+dx/n*r;p.z=o.z+dz/n*r;p.speed*=.2;}}
}
const sObstacles=track=>track?.collision?.obstacles||[];
function stepVehicle(p,inp,dt,s){
 const pace=s.pace;let speed=p.speed||0;
 const effect=trackEffect(p,s.track,dt);
 if(effect==='grease')inp={...inp,steer:inp.steer*.27,throttle:inp.throttle*.65};
 const boosted=p.boostLeft>0||effect==='speed';
 const cap=12.5*pace*(boosted?1.35:1),accel=4.5*pace*(boosted?1.4:1);
 if(inp.boost&&p.boostCooldown<=0){p.boostLeft=1.5;p.boostCooldown=5;}
 p.boostLeft=Math.max(0,(p.boostLeft||0)-dt);p.boostCooldown=Math.max(0,(p.boostCooldown||0)-dt);
 if(inp.throttle>0)speed=Math.min(cap,speed+inp.throttle*accel*dt);
 else if(inp.throttle<0)speed=Math.max(-cap*.4,speed+inp.throttle*(speed>0?9:3.5)*pace*dt);
 else speed*=Math.pow(.985,dt*60);
 if(Math.abs(speed)<.02)speed=0;
 const yawRate=-inp.steer*clamp(Math.abs(speed)/3.5,0,1)*1.55*Math.sign(speed||1);
 p.yaw+=yawRate*dt;
 const old={x:p.x,z:p.z};p.x+=Math.sin(p.yaw)*speed*dt;p.z+=Math.cos(p.yaw)*speed*dt;
 if(p.vehicle!=='KART'){
  const delta=(inp.ascend?1:0)-(inp.descend?1:0);
  const target=delta*4;
  p.vy=clamp((p.vy||0)+(target-(p.vy||0))*dt*2.5,-5,5);
  p.y=Math.max((s.spawns[p.id]?.y??0)+1.2,p.y+p.vy*dt);
 }else{p.y=s.spawns[p.id]?.y??0;}
 p.speed=speed;p.vx=Math.sin(p.yaw)*speed;p.vz=Math.cos(p.yaw)*speed;
 // Avoid impossible jumps across very thin walls by maintaining <= .21m
 // per step at standard pace; a true Ammo server is a later milestone.
 bounceWalls(p,s.track.collision.walls,s.track);
 // Resolve pairwise contacts later, after all racers have advanced.
 return old;
}
function settleRacerContacts(racers){
 for(let a=0;a<racers.length;a++)for(let b=a+1;b<racers.length;b++){
  const p=racers[a],q=racers[b],dy=Math.abs((p.y||0)-(q.y||0));if(dy>1.8)continue;
  const dx=q.x-p.x,dz=q.z-p.z,d=Math.hypot(dx,dz),min=1.58;
  if(d>=min)continue;const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0,amount=(min-d)*.5;
  p.x-=nx*amount;p.z-=nz*amount;q.x+=nx*amount;q.z+=nz*amount;
  p.speed*=.75;q.speed*=.75;
 }
}
export function stepLan(s,dt=1/60){
 dt=clamp(dt,0,1/30);s.tick++;if(s.phase==='countdown'&&s.now()>=s.countdownTo){s.phase='race';}
 if(s.phase!=='race'||s.race?.finished)return;
 s.simClock+=dt;
 const all=lanRacers(s),previous={};
 for(const p of all){previous[p.id]={x:p.x,z:p.z,y:p.y};
  let inp=p.input;
  if(p.isNpc){
   // NPC uses the SAME navigation and traffic controller as local PlayCanvas;
   // unlike the browser, this deterministic LAN sandbox has no Ammo raycast.
   const nearby=all.filter(o=>o!==p);
   const obstacle=scanNpcWorldObstacles(p,s.track,nearby);
   const d=stepRaycastNpc(p,s.track,s.difficulty,dt,p.npcState,obstacle,{valid:true,height:p.y},s.pace,nearby);
   p.npcState=d.state;inp=d.input;
   if(d.rescue){
    const anchor=d.state.lastSafe;
    if(anchor){
     const tangent={x:Math.sin(anchor.yaw),z:Math.cos(anchor.yaw)};
     const samples=[0,-2.0,2.0,-4,4].map(v=>({x:anchor.x+tangent.x*v,z:anchor.z+tangent.z*v}));
     const free=samples.find(candidate=>nearby.every(o=>Math.hypot(o.x-candidate.x,o.z-candidate.z)>2.7)&&
      !s.track.collision.obstacles?.some(o=>Math.hypot(o.x-candidate.x,o.z-candidate.z)<1.6));
     if(free){p.x=free.x;p.z=free.z;p.y=anchor.y??0;p.yaw=anchor.yaw||0;p.speed=0;p.vx=0;p.vz=0;
      p.npcState=npcRacerState();p.npcState.lastSafe={...anchor};p.npcState.rescueCooldown=10;
      previous[p.id]={x:p.x,y:p.y,z:p.z};
      continue;
     }
    }
    p.npcState.phase='REVERSE';p.npcState.phaseAge=0;p.npcState.rescueCooldown=4;
   }
  }else if(s.now()-p.lastInputMs>350){inp=cleanInput();}
  stepVehicle(p,inp,dt,s);
 }
 settleRacerContacts(all);
 // Re-project a car from wall penetration after racer-racer collision.
 for(const p of all){
  bounceWalls(p,s.track.collision.walls,s.track);
  // Velocity and speed must stay in sync AFTER wall and racer contact.
  // Otherwise the shared NPC controller thinks a physically stopped car is
  // still moving and never enters its reverse/unstick state.
  p.vx=Math.sin(p.yaw)*p.speed;
  p.vz=Math.cos(p.yaw)*p.speed;
 }
 const world={race:s.race,track:s.track,bodies:all};
 updateLaps(world,previous);
 const gates=s.track.race.airGates?.length?s.track.race.airGates:legacyFlightGates(s.track);
 for(const p of all){
  if(s.race.finished||p.vehicle==='KART'||!gates.length)continue;
  const state=s.race.per[p.id];
  const result=advanceAirLap(state,previous[p.id],p,gates,s.race.lapsToWin);
  if(result.won){s.race.winner=p.id;s.race.finished=true;}
 }
 if(s.race.finished){s.phase='results';s.finishedAt=s.now();}
}
export function lanSnapshot(s){
 const racers=lanRacers(s);
 return {phase:s.phase,tick:s.tick,serverTime:s.now(),raceClock:Math.round(s.simClock*1000)/1000,
  countdownMs:s.countdownTo===null?null:Math.max(0,s.countdownTo-s.now()),
  hostId:'p1',maxRacers:LAN_MAX_RACERS,settings:{npcCount:s.npcCount,laps:s.laps,pace:s.pace,difficulty:s.difficulty},
  racers:racers.map(p=>({id:p.id,label:p.label,vehicle:p.vehicle,isNpc:!!p.isNpc,ready:!!p.ready,disconnected:!!p.disconnected,
   x:+p.x.toFixed(3),y:+p.y.toFixed(3),z:+p.z.toFixed(3),yaw:+p.yaw.toFixed(4),speed:+(p.speed||0).toFixed(3),
   laps:s.race?.per[p.id]?.laps||0,next:s.race?.per[p.id]?.next||0})),
  winner:s.race?.winner||null,standings:s.race?racerResults(racers,s.race,()=>s.track.race.gates.length):[]};
}
