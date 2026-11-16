/**
 * Online host adapter for the existing PlayCanvas/Ammo runtime.
 * NO independent vehicle, road, suspension, checkpoint or collision solver.
 * The host's src/v14/main.js drives native Ammo vehicles, and this adapter
 * translates remote input to that loop and publishes read-only snapshots.
 */
import {cleanInput} from './input-contract.js';
import {racerResults} from '../race/roster.js';

const IDS=['p1','p2','p3','p4'];
const RACE_SETTINGS={npcCount:0,laps:3,pace:1,difficulty:'medium'};
export function createAmmoHostAdapter({getWorld,startRace,backToLobby,getPhase,getTrack}){
 const participants=new Map(),inputs=new Map();
 let phase='lobby',settings={...RACE_SETTINGS};
 const ordered=()=>IDS.map(id=>[...participants.values()].find(p=>p.id===id)).filter(Boolean);
 const roster=()=>ordered().map(p=>({id:p.id,human:true,label:p.label}));
 const ids=()=>new Set(ordered().map(p=>p.id));
 const aiIds=()=>IDS.filter(id=>!ids().has(id)).slice(0,settings.npcCount);
 const count=()=>participants.size;
 function execute(member,action,data={}){
  if(action==='join'){
   if(member.id)throw Error('Already joined');
   if(phase!=='lobby')throw Error('Race is already starting');
   const id=IDS.find(id=>!ids().has(id));if(!id)throw Error('Room full (maximum four players)');
   const label=String(data.name||'RACER').trim().slice(0,24)||'RACER';
   const p={id,label,ready:false,vehicle:'KART'};
   participants.set(member,p);member.id=id;return {id,token:id};
  }
  if(!member.id||!participants.has(member))throw Error('Join the room first');
  const p=participants.get(member);
  if(action==='input'){
   if(phase!=='race')return {};
   const input=cleanInput(data);
   const old=inputs.get(p.id);
   if(!old||input.seq>old.seq)inputs.set(p.id,input);
   return {};
  }
  if(action==='vehicle'){
   if(phase!=='lobby'||!['KART','HOVER','DRONE'].includes(data.vehicle))throw Error('Vehicle unavailable');
   p.vehicle=data.vehicle;p.ready=false;return {};
  }
  if(action==='ready'){
   if(phase!=='lobby')throw Error('Race is not in lobby');
   p.ready=!!data.ready;return {};
  }
  if(p.id!=='p1')throw Error('Only room host (P1) can control race');
  if(action==='reset'){
   backToLobby();phase='lobby';for(const racer of participants.values())racer.ready=false;
   inputs.clear();return {};
  }
  if(action==='start'){
   if(phase!=='lobby'||!participants.size||!ordered().every(v=>v.ready))throw Error('All racers must be ready');
   const npcCount=Number(data.npcCount),laps=Number(data.laps),pace=Number(data.pace);
   if(!Number.isInteger(npcCount)||npcCount<0||npcCount+participants.size>4||
      ![1,3,5].includes(laps)||![.75,1,1.25,1.5,2,2.5].includes(pace)||
      !['easy','medium','hard'].includes(data.difficulty))throw Error('Invalid race settings');
   settings={npcCount,laps,pace,difficulty:data.difficulty};
   inputs.clear();
   startRace(settings);
   phase='countdown';return {};
  }
  throw Error('Unknown room action');
 }
 function leave(member){
  const p=participants.get(member);if(!p)return;
  participants.delete(member);inputs.delete(p.id);
  // Live race slots remain as physically simulated zero-input cars until reset.
  if(phase==='race'||phase==='countdown'){
   inputs.set(p.id,{...cleanInput(),seq:0,disconnected:true});
  }
 }
 function inputFor(id,hostInput){
  if(id==='p1')return hostInput;
  const p=ordered().find(r=>r.id===id);
  if(!p)return {throttle:0,steer:0,drift:false,descend:false,boost:false,reset:false};
  const data=inputs.get(id);
  if(!data||!Number.isFinite(data.receivedAt)||Date.now()-data.receivedAt>450)return {throttle:0,steer:0,drift:false,descend:false,boost:false,reset:false};
  return {throttle:data.throttle,steer:data.steer,drift:data.ascend,descend:data.descend,boost:data.boost,reset:false,cameraX:0,cameraY:0};
 }
 function snapshot(){
  const world=getWorld();
  const racing=phase!=='lobby'&&!!world;
  const cars=racing?world.cars:[];
  const racers=racing?cars.map(car=>{
   const p=ordered().find(r=>r.id===car.id);
   const position=car.entity.getPosition(),rotation=car.entity.getRotation();
   const state=world.race?.per?.[car.id];
   return {id:car.id,label:p?.label||car.label||car.id,vehicle:car.spec.type,
    isNpc:!!car.isNpc,ready:!!p?.ready,disconnected:!car.isNpc&&!p,
    x:+position.x.toFixed(3),y:+position.y.toFixed(3),z:+position.z.toFixed(3),
    yaw:car.yaw||0,rotation:[rotation.x,rotation.y,rotation.z,rotation.w],
    speed:Math.hypot(car.vx||0,car.vz||0),laps:state?.laps||0,next:state?.next||0};
  }):ordered().map(p=>({id:p.id,label:p.label,vehicle:p.vehicle,isNpc:false,ready:p.ready,
   disconnected:false,x:0,y:0,z:0,yaw:0,speed:0,laps:0,next:0}));
  const standings=world?.race?.per&&racing?
   racerResults(cars,world.race,c=>c.spec.type==='KART'?world.track.race.gates.length:world.track.race.airGates?.length||1):[];
  return {phase,tick:Math.round(world?.elapsed*60)||0,serverTime:Date.now(),raceClock:world?.elapsed||0,
   countdownMs:phase==='countdown'?3000:null,hostId:'p1',maxRacers:4,
   physics:'playcanvas-ammo-btRaycastVehicle',settings,racers,winner:world?.race?.winner||null,standings};
 }
 return {execute,leave,snapshot,phase:()=>phase,setPhase:p=>{phase=p;},
  roster,aiIds,humanCount:count,vehicleFor:id=>ordered().find(p=>p.id===id)?.vehicle||'KART',
  inputFor,settings:()=>({...settings}),playerList:ordered};
}
