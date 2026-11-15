/** Shared renderer-independent navigation corridor for local AI and LAN host.
 * The Blender-exported samples are authoritative; legacy tracks are upgraded
 * in memory without changing the user's scene or gate markers. Units: metres.
 */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const length=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const angle=(a,b)=>Math.atan2(a.x*b.z-a.z*b.x,a.x*b.x+a.z*b.z);
const cache=new WeakMap();
export function navigationCorridor(track){
 if(cache.has(track))return cache.get(track);
 const authored=track.race?.navigation?.points;
 const base=Array.isArray(authored)&&authored.length>=8?authored:track.race.waypoints;
 const halfWidth=clamp((track.race?.roadWidth||6)*.5,1,100);
 const points=[];
 const maxSpacing=Array.isArray(authored)&&authored.length>=8?2:1.1;
 // Sample long straights more finely; retain every authored Bezier sample.
 for(let i=0;i<base.length;i++){
  const a=base[i],b=base[(i+1)%base.length],d=length(a,b),n=Math.max(1,Math.ceil(d/maxSpacing));
  for(let k=0;k<n;k++){
   const t=k/n;
   points.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,
    y:(a.y||0)+((b.y||0)-(a.y||0))*t,
    left:Math.max(.6,(a.left??halfWidth)),right:Math.max(.6,(a.right??halfWidth))});
  }
 }
 if(points.length>2400)throw new Error('Navigation corridor exceeds 2400 samples; simplify your track');
 // A predictable detour is better than an emergency steering twitch near
 // an authored movable crate. Treat authored obstacle locations as the *base*
 // racing line, with live sensors still responsible if the crate has moved.
 // Uses the road centreline frame, so both legs of a 90-degree corner remain
 // aligned to the designer's curve; nothing changes the actual collision mesh.
 if(track.race.navigationAvoidProps!==false){
  const obstacles=(track.collision?.obstacles||[]).filter(o=>Number.isFinite(o.x)&&Number.isFinite(o.z));
  if(obstacles.length){
   const source=points.map(p=>({x:p.x,z:p.z}));
   for(let i=0;i<points.length;i++){
    const before=source[(i-1+points.length)%points.length],next=source[(i+1)%points.length];
    const tangent={x:next.x-before.x,z:next.z-before.z};const L=Math.hypot(tangent.x,tangent.z)||1;
    const tx=tangent.x/L,tz=tangent.z/L,rx=tz,rz=-tx,p=points[i];
    let shift=0;
    for(const o of obstacles){
     const dx=o.x-p.x,dz=o.z-p.z,along=dx*tx+dz*tz,lateral=dx*rx+dz*rz;
     const influence=7+Math.max(o.hx||0,o.hz||0);
     if(Math.abs(along)>=influence||Math.abs(lateral)>1.3)continue;
     const radius=Math.max(.35,o.hx||0,o.hz||0);
     const desired=Math.min(Math.min(p.left,p.right)-.88,radius+1.28);
     if(desired<1.05)continue;
     const side=Math.abs(lateral)>.18?-Math.sign(lateral):1;
     const taper=.5*(1+Math.cos(Math.PI*along/influence));
     if(Math.abs(desired*taper)>Math.abs(shift))shift=side*desired*taper;
    }
    p.x+=rx*shift;p.z+=rz*shift;p.staticLineOffset=shift;
   }
  }
 }

 let distance=0;
 for(let i=0;i<points.length;i++){
  const p=points[i],n=points[(i+1)%points.length],prev=points[(i+points.length-1)%points.length];
  const forward={x:n.x-p.x,z:n.z-p.z},back={x:p.x-prev.x,z:p.z-prev.z};
  const before=length(p,prev),after=length(p,n);
  p.s=distance;p.heading=Math.atan2(forward.x,forward.z);
  p.curvature=Math.abs(angle(back,forward))/Math.max(.25,(before+after)*.5);
  distance+=after;
 }
 const route={points,totalLength:distance,halfWidth};
 cache.set(track,route);return route;
}
export function routeTargetSpeed(corridor,segmentIndex,offsetMetres,skill,pace=1){
 const points=corridor.points,start=points[segmentIndex%points.length];
 let covered=0,limit=Infinity,strongest=0;
 // Take into account braking DISTANCE to all imminent corners, not just
 // the turn immediately under the front axle.
 for(let k=0;k<points.length&&covered<Math.max(14,offsetMetres+14)*Math.sqrt(pace);k++){
  const i=(segmentIndex+k)%points.length,p=points[i],next=points[(i+1)%points.length];
  const curvature=Math.max(0,p.curvature);
  if(curvature>.018){
   const cornerSpeed=Math.sqrt(Math.max(.6,skill.lateralAccel*pace)/curvature)*skill.cornerFactor;
   const remaining=Math.max(0,covered-offsetMetres);
   const brake=skill.brakeDecel??5;
   const safe=Math.sqrt(cornerSpeed*cornerSpeed+2*brake*remaining);
   limit=Math.min(limit,safe);strongest=Math.max(strongest,curvature);
  }
  covered+=length(p,next);
 }
 return {speed:limit,curvature:strongest};
}
export function nearestCorridorSample(position,corridor){
 let nearest=null;
 for(let i=0;i<corridor.points.length;i++){
  const p=corridor.points[i],dx=p.x-position.x,dz=p.z-position.z,d=dx*dx+dz*dz;
  if(!nearest||d<nearest.d2)nearest={i,point:p,d2:d};
 }
 return {...nearest,distance:Math.sqrt(nearest.d2)};
}
export function validateDriveability(corridor,{vehicleWidth=1.6,minimumRadius=2.3}={}){
 const issues=[];
 for(let i=0;i<corridor.points.length;i++){
  const p=corridor.points[i];
  if(p.left+p.right<vehicleWidth+.7)issues.push({index:i,kind:'narrow',width:p.left+p.right});
  if(p.curvature>1/Math.max(.3,minimumRadius))issues.push({index:i,kind:'tight-turn',radius:1/p.curvature});
 }
 return issues.filter((v,i)=>i===0||v.index!==issues[i-1]?.index+1||v.kind!==issues[i-1]?.kind);
}
