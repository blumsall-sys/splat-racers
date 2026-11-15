/**
 * Contact-first kart road awareness. Ammo owns road support, gravity, wall
 * impacts and vehicle bumps. Four filtered raycasts adjust VISUAL wheels only
 * and measure grade; no duplicate suspension force is added to the rigidbody.
 * This is intentionally not a four-wheel physical suspension model.
 */
import {KART_CONTACT, wheelMountHeight, smoothWheelHeight, roadProximity} from './kart-contact.js';

// Retained for compatibility with older diagnostic imports; not used by the
// current kart controller or game. Keeping it here avoids breaking old scripts.
export const RIDE = Object.freeze({massKg:170,rideHeight:.68,axleOffset:.72,trackHalfWidth:.55,spring:18,damping:9,maxUpG:28,gradeLimit:.65});
export const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export function suspensionForce(roadHeight,chassisHeight,verticalVelocity,mass=RIDE.massKg){
 if(![roadHeight,chassisHeight,verticalVelocity,mass].every(Number.isFinite)||mass<=0)return 0;
 const error=roadHeight+RIDE.rideHeight-chassisHeight;
 if(error>1.05||error<-.92)return 0;
 return clamp(mass*(9.81+RIDE.spring*error-RIDE.damping*verticalVelocity),0,mass*RIDE.maxUpG);
}
export function isRoadCollider(entity){
 const name=String(entity?.name||'').toLowerCase();
 if(entity?.tags?.has?.('lab5-drivable-road'))return true;
 return /(?:road|tarmac|floor|ground|trackroad|track_surface)/.test(name)&&!/(?:wall|guard|barrier)/.test(name);
}
export function sampleRoadSupport(physics,car,Vec3){
 if(!physics?.raycastFirst||!car?.entity)return null;
 const p=car.entity.getPosition(),yaw=car.yaw||0;
 const f={x:Math.sin(yaw),z:Math.cos(yaw)};
 const right={x:Math.cos(yaw),z:-Math.sin(yaw)};
 const m=car.entity.getWorldTransform?.()?.data;
 const hits=[];
 for(const front of [-KART_CONTACT.wheelAxleZ,KART_CONTACT.wheelAxleZ]){
  for(const side of [-1,1]){
   const qx=side*KART_CONTACT.wheelTrackX;
   const x=m?m[12]+m[0]*qx+m[8]*front:p.x+front*f.x+qx*right.x;
   const z=m?m[14]+m[2]*qx+m[10]*front:p.z+front*f.z+qx*right.z;
   const hit=physics.raycastFirst(new Vec3(x,p.y+1.0,z),new Vec3(x,p.y-3.0,z),{filterCallback:isRoadCollider});
   if(hit?.point&&hit.normal?.y>.48&&Number.isFinite(hit.point.y))hits.push({height:hit.point.y,normal:{x:hit.normal.x,y:hit.normal.y,z:hit.normal.z},front,side});
  }
 }
 if(!hits.length)return null;
 const ordered=hits.map(h=>h.height).sort((a,b)=>a-b);
 const height=ordered.length>=3?ordered.slice(1,-1).reduce((a,b)=>a+b,0)/(ordered.length-2):ordered.reduce((a,b)=>a+b,0)/ordered.length;
 const back=hits.filter(h=>h.front<0),front=hits.filter(h=>h.front>0);
 const avg=a=>a.reduce((sum,pt)=>sum+pt.height,0)/a.length;
 const grade=back.length&&front.length?clamp((avg(front)-avg(back))/(KART_CONTACT.wheelAxleZ*2),-RIDE.gradeLimit,RIDE.gradeLimit):0;
 const rightSide=hits.filter(h=>h.side>0),leftSide=hits.filter(h=>h.side<0);
 const bank=rightSide.length&&leftSide.length?(avg(rightSide)-avg(leftSide))/(KART_CONTACT.wheelTrackX*2):0;
 const nx=-grade*f.x-bank*right.x,nz=-grade*f.z-bank*right.z;
 const inv=1/Math.hypot(nx,1,nz);
 return {height,grade,bank,normal:{x:nx*inv,y:inv,z:nz*inv},samples:hits.length,hits};
}
/** Purely visual wheel placement. The rigidbody is never teleported or lifted. */
export function updateWheelContacts(car,support,dt){
 if(!car?.entity?.getPosition||!Array.isArray(car.wheels))return {probes:0,avgGap:null};
 const y=car.entity.getPosition().y;
 const m=car.entity.getWorldTransform?.()?.data;
 let probes=0,totalGap=0;
 for(const wheel of car.wheels){
  const found=support?.hits?.find(h=>h.side===wheel.side && ((h.front>0)===wheel.front));
  const localX=wheel.side*KART_CONTACT.wheelTrackX, localZ=wheel.front?KART_CONTACT.wheelAxleZ:-KART_CONTACT.wheelAxleZ;
  // On a pitched or banked chassis, a local Y mount offset is not a world Y
  // offset. Solve the local wheel position from the parent transform matrix.
  const localOriginY=m?m[13]+m[1]*localX+m[9]*localZ:y;
  const localUpY=m?m[5]:1;
  const target=found&&Math.abs(localUpY)>.35
    ?clamp((found.height+KART_CONTACT.wheelRadius+KART_CONTACT.wheelGroundClearance-localOriginY)/localUpY,
         KART_CONTACT.wheelMountY-KART_CONTACT.wheelTravel,KART_CONTACT.wheelMountY+KART_CONTACT.wheelTravel)
    :wheelMountHeight(found?.height,y);
  const current=Number.isFinite(wheel.mountY)?wheel.mountY:KART_CONTACT.wheelMountY;
  const mountY=smoothWheelHeight(current,target,dt);
  wheel.mountY=mountY;
  wheel.mount.setLocalPosition(wheel.side*KART_CONTACT.wheelTrackX,mountY,wheel.front?KART_CONTACT.wheelAxleZ:-KART_CONTACT.wheelAxleZ);
  if(found){probes++;totalGap+=localOriginY+localUpY*mountY-KART_CONTACT.wheelRadius-found.height;}
 }
 const avgGap=probes?totalGap/probes:null;
 car.wheelDiagnostics={probes,avgGap};
 return car.wheelDiagnostics;
}
/** The default road-awareness update never applies a spring force. */
export function updateKartRoadState(physics,car,pc,dt){
 const support=sampleRoadSupport(physics,car,pc.Vec3);
 const p=car.entity.getPosition(),vy=car.entity.rigidbody.linearVelocity.y;
 car.roadGrade=support?.grade??0;
 car.roadNormal=support?.normal??null;
 car.grounded=!!support&&roadProximity(support.height,p.y,vy);
 car.supportHeight=support?.height;
 updateWheelContacts(car,support,dt);
 car.roadForce=0;
 return support;
}
/** Compatibility alias: old source/tests can still import this symbol.
 * NO extra upward force: Ammo now owns contact and gravity exclusively. */
export function applyRoadSupport(physics,car,pc,dt=1/60){
 return updateKartRoadState(physics,car,pc,dt);
}
