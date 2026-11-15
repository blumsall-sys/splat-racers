/** Repeatable physical-response flight-NPC benchmark.  Not a replacement
 * for running PlayCanvas/Ammo in Chrome: uses first-order yaw and vertical
 * force dynamics matching the game's control limits and acceleration caps.
 */
import {npcAirState,stepAirNpc} from '../src/race/air-npc.js';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {flightSpeedTuning} from '../src/vehicles/race-speed.js';
import {advanceAirLap} from '../src/vehicles/air-race.js';
const gates=[
 {id:'G0',position:[0,7,15],normal:[0,0,1],radius:3.7},
 {id:'G1',position:[10,10,32],normal:[1,0,0],radius:3.7},
 {id:'G2',position:[27,8,39],normal:[0,0,1],radius:4.6},
 {id:'G3',position:[39,13,55],normal:[0,0,1],radius:4.6},
 {id:'G4',position:[47,9,71],normal:[1,0,0],radius:4.2},
 {id:'G5',position:[61,6,78],normal:[0,0,1],radius:4.2},
 {id:'G6',position:[67,11,94],normal:[0,0,1],radius:4.0},
 {id:'G7',position:[76,7,111],normal:[1,0,0],radius:4.0},
];
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
export function runForceResponseFlight(type='DRONE',difficulty='medium',pace=1,config={}){
 const dt=1/60,limit=config.limit??(360*60);
 const car={id:config.id||'p3',spec:{type,mass:type==='HOVER'?140:70,maxSpeed:12.5,acceleration:type==='HOVER'?4.5:4},
  x:config.x??0,y:config.y??3,z:config.z??0,yaw:config.yaw??0,vx:0,vy:0,vz:0};
 const progress={next:0,laps:0,launched:false,lastGateIndex:null};
 let state=npcAirState(),yawRate=0,completed=[],time=0;
 let first=Infinity,maxGap=0,stalled=0,wrongSide=0,maxInput=0;
 const course=config.gates||gates;
 for(let tick=0;tick<limit&&completed.length<course.length;tick++){
  time=tick*dt;
  const decision=stepAirNpc(car,course,progress,state,dt,{difficulty,pace});
  state=decision.state;
  const input=decision.input;
  if(decision.rescue){stalled++; /* Log only: benchmark does NOT give free teleports */}
  if(decision.diagnostics.wrongSide)wrongSide++;
  if(input.throttle>maxInput)maxInput=input.throttle;
  const prev={x:car.x,y:car.y,z:car.z};
  // Flight controller's yaw: targetYaw=-steer*1.65*skill and torque servo.
  const targetYaw=-input.steer*1.65*(input.npcYawRateScale||1);
  yawRate+=(targetYaw-yawRate)*clamp(dt*8,0,1);
  car.yaw+=yawRate*dt;
  const f={x:Math.sin(car.yaw),z:Math.cos(car.yaw)};
  const along=car.vx*f.x+car.vz*f.z;
  const speed=Math.hypot(car.vx,car.vz);
  const {accelerationMps2,speedLimitMps}=flightSpeedTuning(car.spec,type,true,pace);
  const authority=1;
  const engine=along<speedLimitMps&&input.throttle>0 || input.throttle<0 ? accelerationMps2*input.throttle*authority:0;
  const slipX=car.vx-f.x*along,slipZ=car.vz-f.z*along;
  const damp=type==='DRONE'?3.2:2.5;
  const capDrag=speed>speedLimitMps?Math.min(26,(speed-speedLimitMps)*7):0;
  car.vx+=(f.x*engine-slipX*damp-(speed>0?car.vx/speed*capDrag:0))*dt;
  car.vz+=(f.z*engine-slipZ*damp-(speed>0?car.vz/speed*capDrag:0))*dt;
  if(Math.abs(input.throttle)<.05){car.vx-=car.vx*.85*dt;car.vz-=car.vz*.85*dt;}
  const elevation=input.npcAltitudeTarget-car.y;
  if(type==='DRONE'){
   const targetVy=clamp(elevation*1.55,-4.8,4.8);
   car.vy+=clamp((targetVy-car.vy)*3.3,-28,28)*dt;
  }else{
   car.vy+=clamp(elevation*9.5-car.vy*4.8,-25,35)*dt;
  }
  car.x+=car.vx*dt;car.z+=car.vz*dt;car.y+=car.vy*dt;
  const pass=advanceAirLap(progress,prev,car,course,1);
  if(pass.crossed){completed.push({id:pass.gate,t:time});if(first===Infinity)first=time;}
  const g=course[progress.next];
  const gap=Math.hypot(car.x-g.position[0],car.y-g.position[1],car.z-g.position[2]);
  maxGap=Math.max(maxGap,gap);
 }
 return {type,difficulty,pace,completed:completed.map(x=>x.id),times:completed.map(x=>+x.t.toFixed(1)),
  seconds:+time.toFixed(1),success:completed.length===course.length,
  stuckRescueRequests:stalled,wrongSideFrames:wrongSide,maxGap:+maxGap.toFixed(1),maxInput:+maxInput.toFixed(2)};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const results=[];
 for(const pace of [1,2])for(const type of ['HOVER','DRONE'])for(const difficulty of ['easy','medium','hard'])
  results.push(runForceResponseFlight(type,difficulty,pace));
 console.log(JSON.stringify(results,null,2));
 if(results.some(r=>!r.success))process.exitCode=1;
}
