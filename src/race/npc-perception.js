/** Raycast-only environmental awareness and nearest-on-road rescue for
 * the solo NPC. No player control, physics tuning, or asset export code. */
import {isRoadCollider} from '../v14/road-support.js';
import {RAYCAST_TUNING} from '../v17/raycast-kart.js';

/** These raycasts ONLY steer the NPC; they never create physics objects or
 * affect the player. PlayCanvas options.filterCallback receives an Entity. */
export function isNpcObstacleEntity(entity){
 const name=String(entity?.name||'');
 return /^p[1-4](?:\s+(?:HOVER|DRONE))?$/.test(name)||/^(?:Wall:|Dynamic:|Proxy:)/.test(name)||/(?:wall|guardrail|barrier)/i.test(name);
}
export function scanNpcObstacle(physics,car,Vec3){
 if(!physics?.raycastFirst)return null;
 const pos=car.entity.getPosition(),f={x:Math.sin(car.yaw),z:Math.cos(car.yaw)};
 const right={x:Math.cos(car.yaw),z:-Math.sin(car.yaw)};
 const obstacleFilter=e=>e!==car.entity&&isNpcObstacleEntity(e);
 const cast=(side=0,forward=5.5,spread=0)=>{
  const from=new Vec3(pos.x+f.x*.85+right.x*side,pos.y+.10,pos.z+f.z*.85+right.z*side);
  const to=new Vec3(from.x+f.x*forward+right.x*spread,from.y,from.z+f.z*forward+right.z*spread);
  const hit=physics.raycastFirst(from,to,{filterCallback:obstacleFilter});
  if(!hit?.point)return null;
  return {hit,distance:Math.hypot(hit.point.x-from.x,hit.point.z-from.z),from};
 };
 const rays=[cast(0,12),cast(-.64,10.0,-.35),cast(.64,10.0,.35)].filter(Boolean);
 if(!rays.length)return null;
 rays.sort((a,b)=>a.distance-b.distance);
 const selected=rays[0],name=selected.hit.entity?.name||'obstacle';
 const type=/^p[1-4](?:\s+(?:HOVER|DRONE))?$/.test(name)?'car':/^(?:Dynamic:|Proxy:)/.test(name)?'dynamic':'wall';
 const dx=selected.hit.point.x-pos.x,dz=selected.hit.point.z-pos.z;
 const side=dx*right.x+dz*right.z;
 // Check usable passing lanes separately, including static guardrails.
 const leftBlocked=cast(-1.30,4.4,-.25),rightBlocked=cast(1.30,4.4,.25);
 // A passing lane must also contain actual drivable ROAD beneath the tyres.
 // A horizontal ray alone can say "clear" even when it points off a cliff.
 const laneHasRoad=(side)=>{
  for(const forward of [2.2,4.1]){
   const x=pos.x+f.x*forward+right.x*side*1.8;
   const z=pos.z+f.z*forward+right.z*side*1.8;
   const hit=physics.raycastFirst(new Vec3(x,pos.y+1.4,z),new Vec3(x,pos.y-2.6,z),
      {filterCallback:isRoadCollider});
   if(!hit?.point||!Number.isFinite(hit.point.y)||hit.normal?.y<.42||Math.abs(hit.point.y-pos.y)>1.5)return false;
  }
  return true;
 };
 const leftClear=(!leftBlocked||leftBlocked.distance>3.0)&&laneHasRoad(-1);
 const rightClear=(!rightBlocked||rightBlocked.distance>3.0)&&laneHasRoad(1);
 return {distance:selected.distance,name,type,leftClear,rightClear,
  awaySide:Math.abs(side)>.25?-Math.sign(side):0};
}
/** On-track validation cannot use wheel contacts alone; raycast wheels can
 * briefly leave the ground while jumping, and a fall may be above lower road. */
export function observeNpcSurface(physics,car,Vec3){
 const pos=car.entity.getPosition();
 const above=new Vec3(pos.x,pos.y+.7,pos.z);
 const below=new Vec3(pos.x,pos.y-2.3,pos.z);
 const hit=physics.raycastFirst(above,below,{filterCallback:isRoadCollider});
 const valid=!!hit?.point&&Number.isFinite(hit.point.y)&&hit.normal?.y>.45 && hit.point.y<pos.y+.8;
 return {valid,height:valid?hit.point.y:null};
}
/** Recover to the lane centre nearest the last verified grounded location,
 * not a future waypoint. A very long, failed on-road recovery also qualifies
 * (after the NPC controller exhausts its physical maneuvers). */
export function rescueNpcToRoad(car,track,physics,Vec3,otherCar,lastSafe,reason='off-track'){
 if(!lastSafe)return null; // no confirmed road position: never guess a spawn
 const t={x:Math.sin(lastSafe.yaw),z:Math.cos(lastSafe.yaw)};
 const options=[0,-1.1,1.1,-2.3,2.3,-3.2,3.2];
 for(const offset of options){
  const x=lastSafe.x+t.x*offset,z=lastSafe.z+t.z*offset;
  const occupied=Array.isArray(otherCar)?otherCar:[otherCar];
  if(occupied.some(o=>o&&o!==car&&Math.hypot(x-o.x,z-o.z)<2.8))continue;
  const startY=Math.max(lastSafe.y+12,car.entity.getPosition().y+3);
  const hit=physics.raycastFirst(new Vec3(x,startY,z),new Vec3(x,startY-40,z),{filterCallback:isRoadCollider});
  if(!hit?.point||hit.normal?.y<.5||!Number.isFinite(hit.point.y))continue;
  // Avoid putting a rescued car inside a guardrail or a dynamic obstacle.
  const sampleY=hit.point.y+.55;
  const radius=1.10;
  let clear=true;
  for(const [dx,dz] of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){
   const obstacle=physics.raycastFirst(
    new Vec3(x,sampleY,z),new Vec3(x+dx,sampleY,z+dz),
    {filterCallback:e=>e!==car.entity&&isNpcObstacleEntity(e)});
   if(obstacle?.point){clear=false;break;}
  }
  if(!clear)continue;
  const y=hit.point.y+RAYCAST_TUNING.startHeightAboveRoad;
  car.entity.rigidbody.teleport(new Vec3(x,y,z),new Vec3(0,lastSafe.yaw*180/Math.PI,0));
  car.entity.rigidbody.linearVelocity=new Vec3(0,0,0);
  car.entity.rigidbody.angularVelocity=new Vec3(0,0,0);
  car.entity.rigidbody.activate();
  console.info('[LAB5 NPC] Local rescue:',reason,'nearest safe road point',x,z);
  return {...lastSafe,x,y:hit.point.y,z};
 }
 console.warn('[LAB5 NPC] No safe road near fall location; recovery postponed.');return null;
}
