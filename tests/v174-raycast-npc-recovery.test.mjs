import test from 'node:test';
import assert from 'node:assert/strict';
import {npcRacerState,nearestPathSegment,aheadOnPath,stepRaycastNpc} from '../src/race/raycast-npc.js';
import {raycastCommands} from '../src/v17/raycast-kart.js';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';

const step=(c,s,dt=1/60,obs=null,level='medium')=>stepRaycastNpc(c,TRAINING_TRACK,level,dt,s,obs);
const car=(x=0,z=-8.25,yaw=Math.PI/2)=>({x,z,yaw,vx:0,vz:0,wheelDiagnostics:{probes:4}});

test('waypoint projection and lookahead wrap without teleporting or changing checkpoints',()=>{
 const c=car(-1,-8.25),p=TRAINING_TRACK.race.waypoints;
 const nearest=nearestPathSegment(c,p);
 assert.ok(nearest.distance<.1);
 const target=aheadOnPath(p,nearest,4);
 assert(target.x>c.x && Math.abs(target.z+8.25)<1e-9);
 assert.equal(typeof c.race,'undefined');
});
test('NPC native input follows human right-positive steering convention',()=>{
 const line={race:{waypoints:[{x:0,z:0},{x:0,z:10},{x:10,z:10},{x:10,z:0}]}};
 const c={x:0,z:0,yaw:0,vx:0,vz:0};
 const targetRight=stepRaycastNpc(c,line,'medium',1/60,npcRacerState());
 // Facing +Z, nearest path is +Z: no steering command.
 assert(Math.abs(targetRight.input.steer)<.05);
 const offLeft={...c,x:4,z:2};
 const turnLeft=stepRaycastNpc(offLeft,line,'medium',1/60,npcRacerState());
 assert(turnLeft.input.steer>0,'destination at negative world yaw must request positive human-style steer because native kart yaw decreases');
 // Bullet angle still inverted at one and only one boundary.
 assert(raycastCommands({throttle:1,steer:1},2,0,1/60).steeringValue<0);
});
test('NPC reduces target speed entering sharp corners and levels retain increasing cruise values',()=>{
 const c=car(7,-8.25,Math.PI/2);
 const easy=step(c,npcRacerState(),1/60,null,'easy');
 const hard=step(c,npcRacerState(),1/60,null,'hard');
 assert(easy.diagnostics.targetSpeed<=7.2);
 assert(hard.diagnostics.targetSpeed<=12.3);
 assert(hard.diagnostics.cornerSpeed>0);
});
test('slow corner crash triggers reverse, then rejoin, without teleporting',()=>{
 const c=car(),s=npcRacerState(),phases=[];
 for(let i=0;i<420;i++){
  const o=step(c,s);
  if(!phases.includes(o.state.phase))phases.push(o.state.phase);
  assert.equal(o.rescue,false,'no early teleport during first recovery');
  if(o.state.phase==='REVERSE'){assert(o.input.throttle<0);assert(Math.abs(o.input.steer)>.1);}
 }
 assert(phases.includes('REVERSE'));
 assert(phases.includes('REJOIN'));
 assert.equal(c.x,0);assert.equal(c.z,-8.25);
});
test('wall sensor causes early deceleration and counts stalls even when it orders braking',()=>{
 const c=car();const s=npcRacerState();const obstacle={distance:1.0,awaySide:1};
 const first=step(c,s,1/60,obstacle);
 assert(first.input.throttle<0.1);
 let phase='FOLLOW';
 for(let i=0;i<180;i++) phase=step(c,s,1/60,obstacle).state.phase;
 assert.notEqual(phase,'FOLLOW');
});
test('on-road stall requests a local rescue only after repeated failed maneuvers and long delay',()=>{
 const c=car(),s=npcRacerState();let last,at=-1;
 for(let i=0;i<60*40;i++){
  last=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,{type:'wall',distance:.6},{valid:true,height:0});
  if(last.rescue){at=i/60;break;}
 }
 assert(at>=12,`stuck rescue too early at ${at}s`);
 assert(at<40,'NPC remains stuck forever instead of requesting a local recovery');
 assert.equal(last.state.lastRescueReason,'stuck-on-track');
 assert(last.state.lastSafe,'must have a validated racing-line location');
 assert(last.state.recoveryAttempts>=2,'the NPC must have physically reversed more than once');
});
test('loss of wheel contact on a jump does not rescue unless there is a confirmed fall',()=>{
 const c={...car(),y:.8,vy:0},s=npcRacerState();
 for(let i=0;i<60;i++)stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,null,{valid:true,height:0});
 assert(s.lastSafe,'valid road sample should establish a safe recovery point');
 c.wheelDiagnostics.probes=0;
 let o;
 for(let i=0;i<60*5;i++)o=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,null,{valid:false,height:null});
 assert.equal(o.rescue,false,'brief airborne events with no descent must not teleport');
 c.y=-4;c.vy=-5;
 for(let i=0;i<60*3;i++)o=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,null,{valid:false,height:null});
 assert.equal(o.rescue,true,'sustained fall off road must rescue');
 assert.equal(s.lastRescueReason,'off-track');
 assert(Math.abs(s.lastSafe.x)<1,'saved recovery point must stay near the fall location');
});
test('respawn cooldown prevents a repeated immediate teleport',()=>{
 const c={...car(),y:-5,vy:-6},s=npcRacerState();
 s.lastSafe={x:0,z:-8.25,y:0,yaw:Math.PI/2};
 s.rescueCooldown=6;
 let o;
 for(let i=0;i<60*4;i++)o=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,null,{valid:false});
 assert.equal(o.rescue,false);assert(s.rescueCooldown>1.8);
});
test('dynamic crate gets path offset while walls never become bypass targets',()=>{
 const c=car(-5,-8.25,Math.PI/2),s=npcRacerState();
 const crate={type:'dynamic',name:'Dynamic: crate',distance:4,leftClear:true,rightClear:true,awaySide:1};
 const avoid=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,s,crate,{valid:true,height:0});
 assert.equal(avoid.state.avoidSide,1);
 assert(avoid.input.target.z< -8.25,'passing on right shifts target toward local right (-Z)');
 const w=stepRaycastNpc(c,TRAINING_TRACK,'medium',1/60,npcRacerState(),{type:'wall',distance:4,leftClear:true,rightClear:true,awaySide:1},{valid:true,height:0});
 assert.equal(w.state.avoidSide,0);
});
test('blocked passing lane selects other side and neither lane blocks passing',async()=>{
 const {chooseAvoidanceSide}=await import('../src/race/raycast-npc.js');
 assert.equal(chooseAvoidanceSide({type:'dynamic',leftClear:false,rightClear:true,awaySide:-1}),1);
 assert.equal(chooseAvoidanceSide({type:'dynamic',leftClear:true,rightClear:false,awaySide:1}),-1);
 assert.equal(chooseAvoidanceSide({type:'dynamic',leftClear:false,rightClear:false,awaySide:1}),0);
});
test('pure NPC path follower completes sample laps in a lightweight kinematic steering test',()=>{
 const c=car(-12.8,-8.25,Math.PI/2),s=npcRacerState(),dt=1/60;
 let maxError=0,travel=0,turns=0,lastYaw=c.yaw;
 for(let i=0;i<110*60;i++){
  const o=step(c,s);const f={x:Math.sin(c.yaw),z:Math.cos(c.yaw)};
  let speed=c.vx*f.x+c.vz*f.z;
  speed=Math.max(-4,Math.min(10,speed+o.input.throttle*6*dt));
  c.yaw-=(speed/1.5)*Math.tan(o.input.steer*.38*(1-.5*Math.abs(speed)/12.5))*dt;
  c.vx=Math.sin(c.yaw)*speed;c.vz=Math.cos(c.yaw)*speed;
  const dx=c.vx*dt,dz=c.vz*dt;c.x+=dx;c.z+=dz;travel+=Math.hypot(dx,dz);
  turns+=Math.abs(c.yaw-lastYaw);lastYaw=c.yaw;
  maxError=Math.max(maxError,o.diagnostics.nearest);
  assert.equal(o.rescue,false);
 }
 assert(travel>350,`NPC travelled ${travel.toFixed(1)}m`);
 assert(turns>10,'NPC completed bends');
 assert(maxError<2.5,`track error ${maxError.toFixed(2)}m`);
});
