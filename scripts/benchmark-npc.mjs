/** Repeatable headless LAN AI benchmark. No browser/Ammo runtime implied. */
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {makeLanState,joinLan,setLanReady,startLanRace,stepLan,lanSnapshot} from '../src/network/host-core.js';
import {navigationCorridor} from '../src/race/npc-navigation.js';
const summary=[];
for(const npcs of [1,2,3])for(const difficulty of ['easy','medium','hard']){
 let now=0;const state=makeLanState(TRAINING_TRACK,{now:()=>now,makeId:()=>`bench-${npcs}-${difficulty}`});
 const host=joinLan(state,'Stationary host');setLanReady(state,host.token,true);
 startLanRace(state,host.token,{npcCount:npcs,laps:1,difficulty,pace:1});now=4000;
 let seconds=0,collisions=0;
 for(let i=0;i<60*180;i++){
  stepLan(state,1/60);seconds=(i+1)/60;
  if(state.phase==='results')break;
 }
 const snap=lanSnapshot(state),npcProgress=snap.racers.filter(r=>r.isNpc).map(r=>({id:r.id,laps:r.laps,nextCheckpoint:r.next}));
 summary.push({npcCount:npcs,difficulty,seconds:+seconds.toFixed(2),winner:snap.winner,finished:state.phase==='results',npcProgress});
}
console.log(JSON.stringify({benchmark:'LAN kinematic/analytic approximation (NOT PlayCanvas Ammo)',routeSamples:navigationCorridor(TRAINING_TRACK).points.length,summary},null,2));
