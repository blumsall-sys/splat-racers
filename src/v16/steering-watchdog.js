/** Observes ACTUAL PlayCanvas chassis heading between physics frames.
 * Diagnostic first. The normal path NEVER teleports: Ammo remains authoritative.
 * If Ammo repeatedly discards commanded yaw while the car is moving, optionally
 * use bounded arcade-heading assist, rotating the body's collision transform in
 * place while preserving translational velocity. Intended only as a last resort.
 */
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const wrappedDelta = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));

export function resetSteeringWatchdog(car){
 car.steeringWatchdog={lastYaw:undefined,expectedYawRate:0,stalledFor:0,assisted:false,warning:false,measuredYawRate:0};
}
export function observeKartSteering(car,dt,pc,{allowAssist=true}={}){
 const d=clamp(dt||1/60,1/240,.12);
 const wd=car.steeringWatchdog||(car.steeringWatchdog={lastYaw:undefined,expectedYawRate:0,stalledFor:0,assisted:false,warning:false,measuredYawRate:0});
 if(wd.lastYaw===undefined){wd.lastYaw=car.yaw;return wd;}
 const changed=wrappedDelta(car.yaw,wd.lastYaw);
 wd.measuredYawRate=changed/d;
 const speed=Math.hypot(car.vx||0,car.vz||0);
 const commanded=wd.expectedYawRate;
 const qualifies=speed>.7&&Math.abs(commanded)>.35&&Math.abs(car.input?.steer||0)>.4;
 // 1/60s expected ~0.02 radians: request sustained mismatch before intervention.
 if(qualifies&&Math.abs(changed)<Math.abs(commanded)*d*.17) wd.stalledFor+=d;
 else wd.stalledFor=Math.max(0,wd.stalledFor-d*2);
 if(wd.stalledFor>.20){wd.warning=true;if(allowAssist)wd.assisted=true;}
 if(wd.assisted&&qualifies&&allowAssist){
  const rb=car.entity?.rigidbody;
  if(rb&&typeof rb.teleport==='function'){
   const pos=car.entity.getPosition();const v=rb.linearVelocity;
   const heading=car.yaw+clamp(commanded*d,-.045,.045);
   rb.teleport(pos,new pc.Vec3(0,heading*180/Math.PI,0));
   if(v)rb.linearVelocity=new pc.Vec3(v.x,v.y,v.z);
   rb.angularVelocity=new pc.Vec3(0,commanded,0);
   rb.activate();
   car.yaw=heading;
  }
 }
 wd.lastYaw=car.yaw;
 return wd;
}
export function trackKartYawCommand(car,rate){
 if(!car.steeringWatchdog)resetSteeringWatchdog(car);
 car.steeringWatchdog.expectedYawRate=Number.isFinite(rate)?rate:0;
}
