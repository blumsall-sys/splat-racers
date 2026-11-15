/**
 * LAB5 raycast-vehicle racing NPC. Pure control logic: no PlayCanvas import.
 * Input contract is identical to human input: positive steer = RIGHT,
 * negative steer = LEFT. The raycast vehicle module alone translates this
 * to Bullet's negative steering angle for right turns.
 *
 * Geometry is in world X/Z; car noses along local +Z, yaw=atan2(fwd.x,fwd.z).
 * State machine: FOLLOW -> BRAKE -> REVERSE -> REJOIN -> FOLLOW. A bounded
 * rescue occurs only after a genuine fall OR multiple failed escape attempts
 * in the same small area for a long time (not after one collision).
 */
import {AI_LEVELS} from './ai-driver.js';
import {raceSpeedMultiplier} from '../vehicles/race-speed.js';
import {navigationCorridor,routeTargetSpeed} from './npc-navigation.js';
import {planNpcTraffic} from './npc-traffic.js';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const EPS=1e-8;
/** Difficulty affects how safely the NPC *drives* (corner preview, speed,
 * throttle/brake, and recovery), not just a flat max-speed multiplier. */
export const NPC_SKILL=Object.freeze({
 easy:   {brakeDecel:5.5,lateralAccel:3.2,cornerFactor:.90,lookaheadFactor:1.22,throttleGain:.48,brakeGain:.72,avoidDistance:6.8,rejoinSpeed:3.0},
 medium: {brakeDecel:6.6,lateralAccel:4.9,cornerFactor:1.00,lookaheadFactor:1.00,throttleGain:.60,brakeGain:.90,avoidDistance:6.0,rejoinSpeed:4.0},
 hard:   {brakeDecel:7.5,lateralAccel:7.6,cornerFactor:1.05,lookaheadFactor:.90,throttleGain:.82,brakeGain:1.05,avoidDistance:5.2,rejoinSpeed:5.0}
});
/** The established v1.7.3 3D kart response is negative world-yaw per positive
 * human-style steer. Geometric target bearings are world-yaw errors. This
 * NPC-only mapping must not be applied again in raycast-kart.js. */
export const NPC_STEER_TO_YAW_SIGN=-1;
export function npcSteerForBearing(bearing,lookahead,skill=1){
 const delta=Math.atan2(2*1.5*Math.sin(bearing),Math.max(1,lookahead));
 return clamp(delta/.38*NPC_STEER_TO_YAW_SIGN*skill,-1,1);
}
const RECOVERY=Object.freeze({
  minimumProgress:0.12,stallSeconds:1.55,brakeSeconds:.35,
  reverseSeconds:2.0,reverseDistance:2.6,rejoinSeconds:3.6,
  // No rescue for a collision/stall. Falling off the drivable surface is the
  // ONLY automatic teleport condition. A brief hop or one missed wheel contact
  // must never trigger a rescue.
  offroadSeconds:2.1,rescueCooldown:10.0,
  onTrackStuckSeconds:12.0,onTrackZoneRadius:3.8,minFailedEscapes:2,
  obstacleLookahead:12.0,avoidHoldSeconds:3.2,avoidOffset:1.95
});

export function nearestPathSegment(position,waypoints){
 if(!Array.isArray(waypoints)||waypoints.length<3)throw new Error('NPC requires at least three racing-line waypoints');
 let best=null;
 for(let i=0;i<waypoints.length;i++){
  const a=waypoints[i],b=waypoints[(i+1)%waypoints.length];
  const dx=b.x-a.x,dz=b.z-a.z,lengthSq=dx*dx+dz*dz;
  if(lengthSq<EPS)continue;
  const t=clamp(((position.x-a.x)*dx+(position.z-a.z)*dz)/lengthSq,0,1);
  const point={x:a.x+dx*t,z:a.z+dz*t};
  const d=dist(point,position);
  if(!best||d<best.distance)best={i,t,point,distance:d,tangent:{x:dx/Math.sqrt(lengthSq),z:dz/Math.sqrt(lengthSq)}};
 }
 if(!best)throw new Error('NPC racing line has no nonzero segments');
 return best;
}
export function aheadOnPath(waypoints,nearest,lookahead){
 let i=nearest.i;
 let remaining=Math.max(0,lookahead);
 let a=waypoints[i],b=waypoints[(i+1)%waypoints.length];
 let segLength=dist(a,b);
 remaining+=nearest.t*segLength;
 for(let n=0;n<=waypoints.length*2;n++){
  a=waypoints[i];b=waypoints[(i+1)%waypoints.length];segLength=dist(a,b);
  if(segLength>EPS&&remaining<=segLength)return {x:a.x+(b.x-a.x)*remaining/segLength,z:a.z+(b.z-a.z)*remaining/segLength,i};
  remaining-=segLength;i=(i+1)%waypoints.length;
 }
 return {...waypoints[i],i};
}
function relativeAngle(car,target){return wrap(Math.atan2(target.x-car.x,target.z-car.z)-car.yaw);}
function nearestCornerCurvature(points,nearest){
 const index=(nearest.i+1)%points.length;
 const a=points[nearest.i],b=points[index],c=points[(index+1)%points.length];
 const ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
 const la=Math.hypot(ax,az),lb=Math.hypot(bx,bz);
 if(la<EPS||lb<EPS)return 0;
 const angle=Math.abs(Math.atan2(ax*bz-az*bx,ax*bx+az*bz));
 return angle/Math.max(1,Math.min(la,lb));
}
function previewCurvature(points,nearest,lookahead){
 let best=nearestCornerCurvature(points,nearest);
 let covered=0,i=nearest.i;
 for(let j=0;j<points.length&&covered<lookahead*1.5;j++){
  covered+=dist(points[i],points[(i+1)%points.length]);
  i=(i+1)%points.length;
  best=Math.max(best,nearestCornerCurvature(points,{i}));
 }
 return best;
}
export function npcRacerState(){return {phase:'FOLLOW',age:0,stalledFor:0,offroadFor:0,totalStalled:0,
  recoveryAttempts:0,reverseSide:1,reverseOrigin:null,anchor:null,lastTarget:null,lastNearest:null,
  phaseChanges:0,phaseAge:0,lastRescueReason:null,avoidSide:0,avoidFor:0,
  rescueCooldown:0,lastSafe:null,groundedFor:0,
  trapZone:null,trapSeconds:0,congestionFor:0,trafficReason:'clear'};}

/** Pure side selection. The sensor uses road-facing physics raycasts, not
 * brittle waypoint index checks. A blocked side is never picked when the
 * other side is clear. Input steering remains RIGHT-positive for both cars. */
export function chooseAvoidanceSide(obstacle,previousSide=0){
 if(!obstacle || obstacle.type==='wall')return 0;
 if(obstacle.leftClear===false && obstacle.rightClear===false)return 0;
 if(obstacle.leftClear===false)return 1;
 if(obstacle.rightClear===false)return -1;
 if(previousSide)return previousSide;
 return Math.sign(obstacle.awaySide||0)||1;
}

/** The sampled road hit must be near the chassis, not 40 m below a fallen car.
 * Stability is hysteretic; a jump or momentary raycast miss is not off-track. */
export function updateNpcSurfaceState(s,car,surface,nearest,dt){
 s.rescueCooldown=Math.max(0,s.rescueCooldown-dt);
 const contacts=car.wheelDiagnostics?.probes;
 const genuinelySupported=surface?.valid===true && (contacts===undefined||contacts>=2);
 if(genuinelySupported){
  s.offroadFor=0;s.groundedFor+=dt;
  if(s.groundedFor>=.20 && nearest.distance<3.5 && Number.isFinite(surface.height)){
   // The racing line provides a safe lane-centred respawn near where the
   // car actually left the road, instead of skipping to a future waypoint.
   s.lastSafe={x:nearest.point.x,z:nearest.point.z,y:surface.height,
     yaw:Math.atan2(nearest.tangent.x,nearest.tangent.z),segment:nearest.i};
  }
 }else if(surface){
  s.groundedFor=0;
  const falling=(car.vy??0)<-.3;
  const belowLastSafe=!!s.lastSafe && Number.isFinite(car.y) && car.y<s.lastSafe.y-2.5;
  // Require both loss of drivable road and all four wheel contacts absent.
  const noContacts=contacts===0;
  if((!surface.valid&&noContacts&&(falling||belowLastSafe))||belowLastSafe)
   s.offroadFor+=dt;
  else s.offroadFor=Math.max(0,s.offroadFor-dt*2);
 }
 return s.rescueCooldown<=0 && s.offroadFor>RECOVERY.offroadSeconds && !!s.lastSafe;
}

/** A local anti-grief stuck detector. Never rescue on first contact or on
 * a slow corner. Rescue only if the car has already attempted to reverse
 * multiple times but stays in the same radius for 12 consecutive seconds. */
export function npcTrappedOnRoad(state,car,roadValid,dt){
 const s=state;
 if(!roadValid || s.rescueCooldown>0 || s.recoveryAttempts<=0){
  if(s.recoveryAttempts<=0){s.trapZone=null;s.trapSeconds=0;}
  return false;
 }
 if(!s.trapZone){s.trapZone={x:car.x,z:car.z};s.trapSeconds=0;}
 if(dist(car,s.trapZone)>RECOVERY.onTrackZoneRadius){
  // The vehicle physically escaped the corner; do not teleport it.
  s.trapZone=null;s.trapSeconds=0;s.recoveryAttempts=0;s.stalledFor=0;
  return false;
 }
 s.trapSeconds+=clamp(dt,0,.1);
 return s.trapSeconds>=RECOVERY.onTrackStuckSeconds &&
  s.recoveryAttempts>=RECOVERY.minFailedEscapes && !!s.lastSafe;
}

export function stepRaycastNpc(car,track,difficulty='medium',dt=1/60,previous=null,obstacle=null,surface=null,raceSpeed=1,otherRacers=[]){
 const cfg=AI_LEVELS[difficulty]||AI_LEVELS.medium;
 const pace=raceSpeedMultiplier(raceSpeed);
 const skill=NPC_SKILL[difficulty]||NPC_SKILL.medium;
 const s=previous||npcRacerState(),corridor=navigationCorridor(track),waypoints=corridor.points;
 dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
 const nearest=nearestPathSegment(car,waypoints);
 const speed=Math.hypot(car.vx||0,car.vz||0);
 const forward={x:Math.sin(car.yaw||0),z:Math.cos(car.yaw||0)};
 const signedSpeed=(car.vx||0)*forward.x+(car.vz||0)*forward.z;
 const lookahead=clamp((cfg.lookahead*.75+speed*.27)*skill.lookaheadFactor*Math.sqrt(pace),2.7,8.4*pace);
 const baseTarget=aheadOnPath(waypoints,nearest,lookahead);
 const curvature=previewCurvature(waypoints,nearest,lookahead);
 const safeCorner=routeTargetSpeed(corridor,nearest.i,nearest.t*dist(waypoints[nearest.i],waypoints[(nearest.i+1)%waypoints.length]),skill,pace);
 const cornerSpeed=Math.max(2.4,Math.min(Math.sqrt((skill.lateralAccel*pace)/Math.max(curvature,.012)),safeCorner.speed));
 const cruise=cfg.cruise*pace*1.12;
 const targetSpeed=clamp(Math.min(cruise,cornerSpeed*skill.cornerFactor),2.0,cruise);
 const traffic=planNpcTraffic(car,otherRacers,{lookahead,roadWidth:track.race.roadWidth||6,roadOffset:nearest.distance,obstacle,previousSide:s.avoidSide});
 s.trafficReason=traffic.reason;
 const transition=(next)=>{if(s.phase!==next){s.phase=next;s.phaseAge=0;s.phaseChanges++;}};
 s.phaseAge=(s.phaseAge||0)+dt;
 const needsRescue=updateNpcSurfaceState(s,car,surface,nearest,dt);
 if(needsRescue){s.lastRescueReason='off-track';transition('RESCUE');}

 // A temporary lateral waypoint deviation avoids moving crates and P1. The
 // guardrails are NEVER treated as bypassable obstacles (no driving off-road).
 if(s.phase==='FOLLOW' || s.phase==='REJOIN'){
  const clearSide=traffic.side||chooseAvoidanceSide(obstacle,s.avoidSide);
  if((traffic.side|| (obstacle?.type!=='wall'&&obstacle?.distance<skill.avoidDistance))&&clearSide){
   s.avoidSide=clearSide;s.avoidFor=RECOVERY.avoidHoldSeconds;
  }else{s.avoidFor=Math.max(0,s.avoidFor-dt);if(!s.avoidFor)s.avoidSide=0;}
 }else{s.avoidFor=0;s.avoidSide=0;}
 const target={...baseTarget};
 if(s.avoidFor>0){
  // Never keep an evasive offset after already drifting toward the track edge.
  if(nearest.distance>2.3){s.avoidFor=0;s.avoidSide=0;}
 }
 if(s.avoidFor>0){
  const next=waypoints[(baseTarget.i+1)%waypoints.length],prev=waypoints[baseTarget.i];
  const vx=next.x-prev.x,vz=next.z-prev.z,L=Math.hypot(vx,vz)||1;
  // Lateral world-right for a +Z-forward waypoint tangent is (+z,-x).
  target.x+=(vz/L)*s.avoidSide*RECOVERY.avoidOffset;
  target.z-=(vx/L)*s.avoidSide*RECOVERY.avoidOffset;
 }
 let bearing=relativeAngle(car,target);
 let steer=npcSteerForBearing(bearing,lookahead);
 if(Math.abs(bearing)>.7)steer=clamp(steer*1.6,-1,1);
 const wantSpeed=targetSpeed*clamp(1-Math.abs(bearing)*.4,.36,1);
 const speedError=wantSpeed-signedSpeed;
 let throttle=clamp(speedError*(speedError<0?skill.brakeGain:skill.throttleGain),-.9,1);
 if(s.avoidFor>0){
  const needsLateral=obstacle&&obstacle.distance<6&&nearest.distance<1.8;
  const approachSpeed=needsLateral?1.9:4.5;
  throttle=Math.min(throttle,clamp((approachSpeed-signedSpeed)*.5,-.55,.52));
 }
 if(traffic.desiredSpeed<Infinity&&s.avoidSide===0){throttle=Math.min(throttle,clamp((traffic.desiredSpeed-signedSpeed)*.45,-.95,.15));}
 if(obstacle&&(obstacle.type||'wall')==='wall'&&obstacle.distance<3.2)throttle=Math.min(throttle,obstacle.distance<1.5?-.4:.18);
 // If neither side has road/clearance, slow *before* reaching a crate.
 // Trying to dodge into a guardrail is worse than stopping behind it.
 if(obstacle && obstacle.type!=='wall' && obstacle.distance<skill.avoidDistance && !s.avoidSide){
  throttle=Math.min(throttle,obstacle.distance>3.2?.12:-.55);
 }

 // Movement over a short interval distinguishes real stalls from normal
 // slowing at corners. Stalls ONLY invoke reverse/rejoin, never teleport.
 if(!s.anchor){s.anchor={x:car.x,z:car.z};s.age=0;}
 s.age+=dt;
 if(s.age>=.55){
  const progress=dist(car,s.anchor);
  if(s.phase==='FOLLOW'||s.phase==='REJOIN'){
   // A physical jam may have zero throttle because the avoidance planner
   // is braking behind a crate; that is still a deadlock if no one moves.
   // Wait longer during deliberate traffic following before attempting a
   // multi-point escape, but do not exempt blocked NPCs forever.
   const deadlocked=progress<RECOVERY.minimumProgress&&Math.abs(signedSpeed)<.65;
   if(deadlocked&&(!traffic.blocked||s.congestionFor>5)){
    s.stalledFor+=s.age;s.totalStalled+=s.age;
   }else{s.stalledFor=Math.max(0,s.stalledFor-.4);s.totalStalled=Math.max(0,s.totalStalled-1.0);}
  if(traffic.blocked)s.congestionFor+=s.age;else s.congestionFor=0;
  }
  s.age=0;s.anchor={x:car.x,z:car.z};
 }
 // A kart can rock or spin against a rail without advancing down the road.
 // Track net displacement across short sampling windows as well as wheel speed.
 if(!s.jamOrigin||dist(car,s.jamOrigin)>2.2){
  s.jamOrigin={x:car.x,z:car.z};s.jamTime=0;
 }
 s.jamTime+=dt;
 if(s.jamTime>3.2 && !traffic.blocked && s.phase==='FOLLOW')s.stalledFor=RECOVERY.stallSeconds+.1;
 if(s.jamTime>12.1 && s.recoveryAttempts>=2 && s.lastSafe && s.rescueCooldown<=0){
  s.lastRescueReason='stuck-on-track';transition('RESCUE');
 }
 if(s.phase==='FOLLOW'&&s.stalledFor>RECOVERY.stallSeconds){
  s.recoveryAttempts++;s.stalledFor=0;
  s.reverseSide=(obstacle?.type!=='wall'&&s.avoidSide)||Math.sign(bearing)||Math.sign(steer)||1;
  // Alternate when repeated attempts failed to create a viable escape.
  if(s.recoveryAttempts>1)s.reverseSide*=(s.recoveryAttempts%2===0?-1:1);
  s.reverseOrigin={x:car.x,z:car.z};transition('BRAKE');
 }
 if(s.phase==='BRAKE'){
  throttle=-1;steer=0;
  if(s.phaseAge>=RECOVERY.brakeSeconds||Math.abs(signedSpeed)<.35)transition('REVERSE');
 }
 if(s.phase==='REVERSE'){
  throttle=-.8;steer=-s.reverseSide*.85;
  if(s.phaseAge>RECOVERY.reverseSeconds||(s.reverseOrigin&&dist(car,s.reverseOrigin)>RECOVERY.reverseDistance)){
   s.stalledFor=0;s.anchor={x:car.x,z:car.z};s.age=0;
   transition('REJOIN');
  }
 }
 if(s.phase==='REJOIN'){
  const merge=aheadOnPath(waypoints,nearest,clamp(2.3+speed*.2,2.3,4));
  const a=relativeAngle(car,merge);
  const directed=npcSteerForBearing(a,3);
  steer=Math.abs(a)>.7?clamp(directed*1.5,-1,1):directed;
  throttle=clamp((Math.min(cfg.corner,skill.rejoinSpeed)*pace-signedSpeed)*.36,-.3,.55);
  // A timer alone must not claim recovery succeeded while still in a wall.
  if(Math.abs(a)<.55&&nearest.distance<2.1&&signedSpeed>.8){
   transition('FOLLOW');s.stalledFor=0;s.recoveryAttempts=0;
   s.trapZone=null;s.trapSeconds=0;
  }else if(s.phaseAge>RECOVERY.rejoinSeconds){
   // A timed-out REJOIN is another unsuccessful *physical* escape. Count it
   // toward the long-stuck safeguard without teleporting on a single hit.
   s.recoveryAttempts++;
   s.reverseSide*=-1;s.reverseOrigin={x:car.x,z:car.z};transition('BRAKE');
  }
 }
 if(s.phase!=='RESCUE' && npcTrappedOnRoad(s,car,surface?.valid===true,dt)){
  s.lastRescueReason='stuck-on-track';transition('RESCUE');
 }
 if(s.phase==='RESCUE'){throttle=0;steer=0;}
 s.lastTarget=target;s.lastNearest=nearest;
 return {input:{throttle:clamp(throttle,-1,1),steer:clamp(steer,-1,1),drift:false,reset:false,target},
  state:s,diagnostics:{phase:s.phase,stuck:s.stalledFor,offroad:s.offroadFor,attempts:s.recoveryAttempts,
   bearing,cornerSpeed,targetSpeed,raceSpeedMultiplier:pace,nearest:nearest.distance,lookahead,steeringConvention:NPC_STEER_TO_YAW_SIGN,obstacle:obstacle?.distance??null,
   avoidance:s.avoidSide,traffic:traffic.reason,trafficLeader:traffic.leader?.id??null,trafficNearby:traffic.neighbors,congestion:s.congestionFor,grounded:s.groundedFor,respawnCooldown:s.rescueCooldown,
   trappedFor:s.trapSeconds,reason:s.lastRescueReason},
  rescue:s.phase==='RESCUE'};
}
