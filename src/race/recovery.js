/** Recovery is race-state independent: never mutate laps or award checkpoints. */
export function closestLinePoint(points,x,z){
 if(!Array.isArray(points)||points.length<2)return null;
 let best=null;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  const dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz;
  if(len2<1e-8)continue;
  const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2));
  const px=a.x+dx*t,pz=a.z+dz*t,distance=Math.hypot(px-x,pz-z);
  if(!best||distance<best.distance)best={x:px,z:pz,yaw:Math.atan2(dx,dz),distance,index:i,t};
 }
 return best;
}
export function deathZone(track,pose,lastSafe=null){
 const line=track.race.waypoints;
 const nearest=closestLinePoint(line,pose.x,pose.z);
 const xs=line.map(p=>p.x),zs=line.map(p=>p.z);
 const minX=Math.min(...xs)-18,maxX=Math.max(...xs)+18,minZ=Math.min(...zs)-18,maxZ=Math.max(...zs)+18;
 const outside=pose.x<minX||pose.x>maxX||pose.z<minZ||pose.z>maxZ;
 const fell=!!lastSafe && Number.isFinite(lastSafe.roadY)&&Number.isFinite(pose.y)&&pose.y<lastSafe.roadY-7;
 // AABB fallback for very large drops; lateral corridor conservatively wide.
 const distant=!!nearest&&nearest.distance>Math.max(20,(track.race.roadWidth||8)*1.8+8);
 return {outside:outside||distant,fell,shouldRespawn:outside||distant||fell,distance:nearest?.distance??Infinity};
}
export function findRoadRespawn(track,physics,Vec3,pose,otherCar,lastSafe=null,clearance=.67){
 const anchor=lastSafe||pose;
 const line=track.race.waypoints;
 const points=[];
 const a=closestLinePoint(line,anchor.x,anchor.z);
 const b=closestLinePoint(line,pose.x,pose.z);
 // Prefer the actual loss location, then nearby track centreline segments.
 if(b&&(!lastSafe||Math.hypot(pose.x-anchor.x,pose.z-anchor.z)<8))points.push(b);
 if(a)points.push(a);
 if(a){for(let offset=1;offset<=3;offset++){
  for(const sign of [-1,1]){
   const k=(a.index+sign*offset+line.length)%line.length;
   const q=line[k],n=line[(k+1)%line.length];
   points.push({x:q.x,z:q.z,yaw:Math.atan2(n.x-q.x,n.z-q.z)});
  }
 }}
 const isRoad=e=>e?.tags?.has?.('lab5-drivable-road')||/roadcollision|road:/i.test(e?.name||'');
 for(const v of points){
  if(otherCar&&Math.hypot(v.x-otherCar.x,v.z-otherCar.z)<2.5)continue;
  const fromY=Math.max(Number(anchor.roadY??anchor.y??0)+18,Number(pose.y||0)+15);
  const hit=physics?.raycastFirst?.(new Vec3(v.x,fromY,v.z),new Vec3(v.x,fromY-75,v.z),{filterCallback:isRoad});
  if(!hit?.point||!Number.isFinite(hit.point.y)||hit.normal?.y<.45)continue;
  return {x:v.x,y:hit.point.y+clearance,z:v.z,yaw:v.yaw,roadY:hit.point.y};
 }
 return null;
}
