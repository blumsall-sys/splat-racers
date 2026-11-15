// Ordered directional checkpoint crossings. Start line alone never awards laps.
const cross=(a,b)=>a.x*b.z-a.z*b.x;
const diff=(a,b)=>({x:a.x-b.x,z:a.z-b.z});
export function gateCrossing(before,after,gate){
 const v=diff(gate.b,gate.a);
 const s0=cross(diff(before,gate.a),v),s1=cross(diff(after,gate.a),v);
 if(s0>=-1e-8||s1<0||s1-s0<1e-8)return false;
 const t=-s0/(s1-s0);if(t<0||t>1)return false;
 const p={x:before.x+(after.x-before.x)*t,z:before.z+(after.z-before.z)*t};
 const u=((p.x-gate.a.x)*v.x+(p.z-gate.a.z)*v.z)/(v.x*v.x+v.z*v.z);
 return u>=-.03&&u<=1.03;
}
export function makeLapState(track,lapsToWin=track.race.lapsToWin,ids=['p1','p2']){
 if(!Number.isInteger(lapsToWin)||lapsToWin<1||lapsToWin>100)throw new Error('Invalid race lap target');
 return {winner:null,finished:false,per:Object.fromEntries(ids.map(id=>[id,{laps:0,next:0,launched:false}])),lapsToWin};
}
export function updateLaps(world,previous){
 if(world.race.finished)return [];
 const events=[];
 const gates=world.track.race.gates;
 for(const id of world.bodies.map(b=>b.id)){
   const body=world.bodies.find(b=>b.id===id),before=previous[id];
   const state=world.race.per[id];
   if(!before||!body||!state||body.spec?.type&&body.spec.type!=='KART')continue;
   // Large displacements such as reset or teleports may not earn checkpoints.
   if(Math.hypot(body.x-before.x,body.z-before.z)>3)continue;
   const gate=gates[state.next];
   if(gateCrossing(before,body,gate)){
     const cleared=state.next;
     state.lastGateIndex=cleared;
     if(state.next===0){if(state.launched)state.laps++;
       else state.launched=true;
     }
     state.next=(state.next+1)%gates.length;
     events.push({id,gate:gate.id,index:cleared,next:state.next,laps:state.laps});
     if(state.laps>=world.race.lapsToWin){world.race.finished=true;world.race.winner=id;break;}
   }
 }
 return events;
}
export function resetLap(world,id){
 if(!world.race)return;
 world.race.per[id]={laps:0,next:0,launched:false};
}
