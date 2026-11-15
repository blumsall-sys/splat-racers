/** Race roster / starting grid shared by the browser and Blender exports. */
export const RACER_IDS=Object.freeze(['p1','p2','p3','p4']);
export function raceRoster(humans=1,npcs=1){
 if(![1,2].includes(humans)||!Number.isInteger(npcs)||npcs<0||humans+npcs>4)throw new Error('Race supports 1–2 local players and 0–3 NPCs, 4 racers maximum');
 return RACER_IDS.slice(0,humans+npcs).map((id,index)=>({id,human:index<humans,label:index<humans?`PLAYER ${index+1}`:`NPC ${index-humans+1}`}));
}
export function ensureGridSpawns(spawns){
 if(!spawns?.p1||!spawns?.p2)throw new Error('Missing original P1/P2 Blender grid positions');
 const result={...spawns};
 for(const [key,lead] of [['p3','p1'],['p4','p2']]){
  if(result[key])continue;
  const ref=result[lead],yaw=ref.yaw||0;
  result[key]={...ref,x:ref.x-Math.sin(yaw)*3,z:ref.z-Math.cos(yaw)*3};
 }
 return result;
}
export function racerResults(cars,race,gateCounts){
 const entries=cars.map(car=>{
  const state=race.per[car.id]||{laps:0,next:0,launched:false};
  const gates=Math.max(1,gateCounts(car));
  const partial=!state.launched?0:state.next===0?1:state.next/gates;
  return {id:car.id,label:car.label||(car.isNpc?'NPC':car.id.toUpperCase()),isNpc:!!car.isNpc,laps:state.laps,next:state.next,progress:state.laps+partial};
 });
 entries.sort((a,b)=>a.id===race.winner?-1:b.id===race.winner?1:b.progress-a.progress||a.id.localeCompare(b.id));
 return entries.map((x,i)=>({...x,place:i+1}));
}
