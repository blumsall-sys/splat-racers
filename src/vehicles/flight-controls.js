// Force-based hover/drone controls inside the SAME PlayCanvas/Ammo world as
// the kart. Three classes share a competitive speed envelope but differ in
// support, handling and vertical control. Scene gravity still owns props.
import {BOOST} from '../race/boost.js';
import {attitudeError,bankedFlightTorque,flightBankTarget,needsLocalRighting,limit} from './attitude-assist.js';
import {flightSpeedTuning} from './race-speed.js';
import {hoverHopUpdate} from './hover-drive.js';
export const EARTH_GRAVITY=9.81;
export const clamp=limit;
export const COMPETITIVE_SPEED_CAP=12.5; // m/s, kart baseline (45 km/h)
export function gravityCorrection(mass,gravityScale=1,g=EARTH_GRAVITY){
 return mass*g*(1-clamp(Number(gravityScale)||0,0,3));
}
export function jumpImpulseForSpeed(mass,currentVy,targetVy){
 return mass*Math.max(0,targetVy-Math.max(-3,currentVy));
}
export function hoverLift({mass=140,altitude=0,desired=2.45,vy=0,gravityScale=1}){
 const error=clamp(desired-altitude,-10,10);
 const feedback=mass*clamp(error*9.5-vy*4.8,-25,35);
 return clamp(mass*EARTH_GRAVITY*gravityScale+feedback,0,mass*EARTH_GRAVITY*4);
}
export function flightSpeedLimit(spec,boost=false,competitive=true,raceSpeed=1){
 const base=flightSpeedTuning(spec,spec.type,competitive,raceSpeed).speedLimitMps;
 return base*(boost?BOOST.speedMultiplier:1);
}
export function cappedFlightThrust({along,throttle,speedLimit,mass,boost=false,authority=1,acceleration=4.5}){
 const input=clamp(throttle,-1,1),speed=Math.max(0,speedLimit);
 const reverseLimit=speed*.55;
 // Preserve inertia / drifting but no free acceleration beyond speed budget.
 if(!authority||(!input))return 0;
 if(input>0 && along>=speed)return 0;
 if(input<0 && along<=-reverseLimit)return 0;
 return mass*clamp(acceleration,1,20)*input*(boost?BOOST.engineMultiplier:1)*authority;
}
function drivableHit(physics,pc,p,reach=45){
 if(!physics?.raycastFirst||!pc?.Vec3)return null;
 const start=new pc.Vec3(p.x,p.y+.5,p.z),end=new pc.Vec3(p.x,p.y-reach,p.z);
 return physics.raycastFirst(start,end,{filterCallback:e=>e?.tags?.has?.('lab5-drivable-road')});
}
/** Emergency anti-snag, only after real motor torque fails for several seconds.
 * Maintains local position and lap/checkpoint state; NEVER seeks a race spawn.
 * The road ray guards the lift from placing the craft under the track.
 */
export function locallyRightFlightVehicle(car,pc,hit){
 const e=car.entity,rb=e.rigidbody,p=e.getPosition(),v=rb.linearVelocity;
 const kind=car.spec.type;
 const minClear=kind==='HOVER'?1.15:1.05;
 const lift=Math.max(p.y+.50,(hit?.point?.y??(p.y-2))+minClear);
 const yaw=(car.stableFlightYaw??car.yaw??0)*180/Math.PI;
 rb.linearVelocity=new pc.Vec3(v.x*.20,Math.max(0,v.y),v.z*.20);
 rb.angularVelocity=new pc.Vec3(0,0,0);
 rb.teleport(new pc.Vec3(p.x,lift,p.z),new pc.Vec3(0,yaw,0));
 rb.activate();
 car.tippedSeconds=0;
 car.flightLocalRightings=(car.flightLocalRightings||0)+1;
 return {x:p.x,y:lift,z:p.z};
}
export function driveFlyingVehicle(car,input,dt,physics,pc,{gravityScale=1,competitive=true,hoverHopSpeed=null,raceSpeed=1}={}){
 const rb=car.entity.rigidbody,p=car.entity.getPosition(),vel=rb.linearVelocity;
 const mass=car.spec.mass,kind=car.spec.type,boost=!!input.boostActive;
 const forward=car.entity.forward; // PlayCanvas forward = -Z, nose = +Z.
 const rawX=-forward.x,rawZ=-forward.z,len=Math.hypot(rawX,rawZ);
 const dir=len>.1?{x:rawX/len,z:rawZ/len}:{x:Math.sin(car.stableFlightYaw||0),z:Math.cos(car.stableFlightYaw||0)};
 const climb=(input.drift&&!input.descend?1:0)-(input.descend?1:0);
 const longitudinal=vel.x*dir.x+vel.z*dir.z;
 const measured=(longitudinal-(car.previousFlightSpeed??longitudinal))/Math.max(.008,dt);
 car.previousFlightSpeed=longitudinal;
 const response=1-Math.exp(-5*Math.min(dt,.1));
 car.pitchLoad=(car.pitchLoad||0)+response*(clamp(.45*input.throttle+.13*measured,-1,1)-(car.pitchLoad||0));
 const targetBank=flightBankTarget(dir,input.steer,car.pitchLoad,climb,kind);
 const att=bankedFlightTorque(car.entity.up,car.entity.right,rb.angularVelocity,mass,kind,car.spec.stabilityAssist??1,targetBank.up);
 // Body actually banks and pitches through Ammo; collision and orientation
 // are physical, while the existing self-righting authority is preserved.
 rb.applyTorque(att.torque.x,0,att.torque.z);
 if(att.upDot>.85&&len>.45)car.stableFlightYaw=Math.atan2(dir.x,dir.z);
 const along=vel.x*dir.x+vel.z*dir.z;
 const pace=flightSpeedTuning(car.spec,kind,competitive,raceSpeed);
 const top=pace.speedLimitMps*(boost?BOOST.speedMultiplier:1);
 const acceleration=pace.accelerationMps2;
 const aim=car.isNpc?0:(car.cameraYaw||0);
 const thrustX=dir.x*Math.cos(aim)+dir.z*Math.sin(aim);
 const thrustZ=dir.z*Math.cos(aim)-dir.x*Math.sin(aim);
 const thrust=cappedFlightThrust({along:vel.x*thrustX+vel.z*thrustZ,throttle:input.throttle,speedLimit:top,mass,boost,authority:att.driveAuthority,acceleration});
 rb.applyForce(thrustX*thrust,0,thrustZ*thrust);
 // Yaw is slowed automatically when rolled sideways; no phantom cornering.
 const angular=rb.angularVelocity;
 // Expert NPCs track heading with slightly faster physical yaw response;
 // collision torque, upright authority and human steering remain unchanged.
 const yawScale=car.isNpc?clamp(Number(input.npcYawRateScale)||1,.9,1.20):1;
 const targetYaw=-clamp(Number(input.steer)||0,-1,1)*1.65*yawScale*att.driveAuthority;
 rb.applyTorque(0,clamp((targetYaw-angular.y)*mass*11,-mass*30,mass*30),0);
 // Lateral damping yields recognisable hover drift, stronger drone control.
 const lateralX=vel.x-dir.x*along,lateralZ=vel.z-dir.z*along;
 const damp=kind==='DRONE'?3.2:2.5;
 rb.applyForce(-lateralX*mass*damp,0,-lateralZ*mass*damp);
 // Soft speed ceiling: counterforce, not velocity snap. Applies to the
 // actual horizontal speed so wall-bouncing/diagonal strafing cannot cheat.
 const planarSpeed=Math.hypot(vel.x,vel.z);
 if(planarSpeed>top){const strength=mass*clamp((planarSpeed-top)*7,0,26);
  rb.applyForce(-vel.x/planarSpeed*strength,0,-vel.z/planarSpeed*strength);
 }
 if(Math.abs(Number(input.throttle)||0)<.05){
  rb.applyForce(-vel.x*mass*.85,0,-vel.z*mass*.85);
 }
 if(att.driveAuthority<.5){
  // Sideways craft has no full throttle and cannot skim the road indefinitely.
  rb.applyForce(-vel.x*mass*3.5,0,-vel.z*mass*3.5);
 }
 rb.applyForce(0,gravityCorrection(mass,gravityScale),0);
 const hit=drivableHit(physics,pc,p,kind==='HOVER'?300:55);
 // NPC altitude guidance uses the same rigid-body forces as the player,
 // but a continuous target avoids repeating the human hop impulse when a
 // ring is only a few metres higher. Never set position/velocity here.
 const npcAltitude=car.isNpc&&Number.isFinite(input.npcAltitudeTarget)
  ?clamp(input.npcAltitudeTarget,-500,5000):null;
 let altitude=null;
 if(kind==='HOVER'){
  altitude=hit?.point?p.y-hit.point.y:null;
  if(npcAltitude!==null){car.hoverManualHeight=true;car.hoverWorldTarget=npcAltitude;}
  const hop=hoverHopUpdate(car,{y:p.y,vy:vel.y,groundY:hit?.point?.y,
   ascend:npcAltitude===null&&!!input.drift,descend:npcAltitude===null&&!!input.descend,
   dt,authority:att.driveAuthority,hopSpeed:hoverHopSpeed});
  if(hop.impulseSpeed>0){
   // Mass-scaled vertical *impulse*, not a small horizontal force or a
   // ground-spring target capped at 3.45m. This is the same Bullet body.
   rb.applyImpulse(0,mass*hop.impulseSpeed,0);
  }
  // Absolute world-space hold is maintained even with no ground ray hit.
  // Hovercrafts can therefore climb towards high artist-authored air rings.
  const lift=hoverLift({mass,altitude:p.y,desired:hop.targetY,vy:vel.y,gravityScale});
  rb.applyForce(0,lift*(.18+.82*att.driveAuthority),0);
  car.hoverHopDiagnostics=hop;
 }else{
  const ascend=(input.drift&&!input.descend?1:0)-(input.descend?1:0);
  const targetVy=npcAltitude!==null
   ?clamp((npcAltitude-p.y)*1.55,-4.8,4.8)*(.35+.65*att.driveAuthority)
   :ascend*4.6*(.35+.65*att.driveAuthority);
  // Drone world-up stabiliser preserves altitude during collision recovery.
  rb.applyForce(0,mass*EARTH_GRAVITY*gravityScale+clamp((targetVy-vel.y)*mass*3.3,-mass*28,mass*28),0);
  altitude=hit?.point?p.y-hit.point.y:null;
 }
 const dtSafe=clamp(Number(dt)||0,0,.1);
 car.tippedSeconds=(att.tiltDegrees>65)?(car.tippedSeconds||0)+dtSafe:Math.max(0,(car.tippedSeconds||0)-dtSafe*2);
 let autoLeveled=false;
 if(needsLocalRighting(att.tiltDegrees,car.tippedSeconds,car.spec.autoRightSeconds??2.6)){
  // Preserve checkpoint progress; if the vehicle is trapped against a barrier,
  // restore the hull locally rather than invoking a full track respawn.
  locallyRightFlightVehicle(car,pc,hit);
  autoLeveled=true;
 }
 rb.activate();
 const state={tiltDegrees:att.tiltDegrees,upDot:att.upDot,
  uprightFactor:att.driveAuthority,gateEligible:att.gateEligible&&!autoLeveled,
  recovering:!att.gateEligible,autoLeveled,localRightings:car.flightLocalRightings||0,
  altitude,hoverTarget:car.hoverTarget,hoverHopCooldown:car.hoverHopCooldown??0,hoverManualHeight:!!car.hoverManualHeight,hasSurface:!!hit?.point,
  speedLimitMps:top,accelerationMps2:acceleration,npcAltitudeTarget:npcAltitude,bankTargetDegrees:targetBank.bankDegrees,pitchTargetDegrees:targetBank.pitchDegrees,raceSpeedMultiplier:raceSpeed};
 car.flightDiagnostics=state;
 car.wheelDiagnostics={probes:0,speedKmh:planarSpeed*3.6,source:kind};
 car.driverDiagnostics={engine:thrust,steeringRadians:targetYaw,brake:0,drifting:false,hopped:false};
 return state;
}
