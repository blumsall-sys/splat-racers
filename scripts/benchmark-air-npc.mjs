/** Lightweight 3D steering/altitude decision smoke test. Not Ammo physics. */
import {npcAirState,stepAirNpc} from '../src/race/air-npc.js';
import {advanceAirLap} from '../src/vehicles/air-race.js';
const gates=[
 {id:'AIR_00',position:[0,8,10],normal:[0,0,1],radius:3.7},
 {id:'AIR_01',position:[12,12,25],normal:[1,0,0],radius:3.7},
 {id:'AIR_02',position:[12,5,40],normal:[0,0,1],radius:3.7}
];
const outcomes=[];
for(const type of ['DRONE','HOVER']){
 for(const difficulty of ['easy','medium','hard']){
  const car={id:'p2',spec:{type},x:0,y:3,z:0,vx:0,vz:0,yaw:0};
  const progress={next:0,launched:false,laps:0};
  let state=npcAirState(),speed=0;const cleared=[];
  for(let tick=0;tick<2400&&cleared.length<3;tick++){
   const {state:next,input}=stepAirNpc(car,gates,progress,state,1/60,{difficulty});
   state=next;const before={x:car.x,y:car.y,z:car.z};
   car.yaw-=input.steer*1.65/60;
   speed=Math.max(-4,Math.min(9,speed+(input.throttle*4-speed*.05)/60));
   car.vx=Math.sin(car.yaw)*speed;car.vz=Math.cos(car.yaw)*speed;
   car.x+=car.vx/60;car.z+=car.vz/60;
   car.y+=(input.drift?4.6:input.descend?-4.6:0)/60;
   const passage=advanceAirLap(progress,before,car,gates,1);
   if(passage.crossed)cleared.push(passage.gate);
  }
  outcomes.push({type,difficulty,cleared,complete:cleared.length===3});
 }
}
console.log(JSON.stringify(outcomes,null,2));
if(outcomes.some(x=>!x.complete))process.exitCode=1;
