/** Predictive, renderer-independent four-racer traffic decisions.
 * Vehicles are approximated by padded circles for low-cost planning. Actual
 * contacts always belong to Ammo/Bullet; this planner never teleports cars.
 */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function planNpcTraffic(car,others=[],{lookahead=8,roadWidth=6,roadOffset=0,obstacle=null,previousSide=0}={}){
 const yaw=car.yaw||0,fx=Math.sin(yaw),fz=Math.cos(yaw),rx=fz,rz=-fx;
 const vx=car.vx||0,vz=car.vz||0;
 const relative=[];
 for(const other of others){
  if(!other||other.id===car.id||(car.entity && other.entity===car.entity))continue;
  const dx=other.x-car.x,dz=other.z-car.z;
  const longitudinal=dx*fx+dz*fz,lateral=dx*rx+dz*rz;
  const closing=Math.max(0,((vx-(other.vx||0))*fx+(vz-(other.vz||0))*fz));
  const horizon=clamp((longitudinal-1.8)/Math.max(.6,closing),0,1.25);
  const predictedSide=lateral+(((other.vx||0)-vx)*rx+((other.vz||0)-vz)*rz)*horizon;
  if(longitudinal>-2.5&&longitudinal<Math.max(12,lookahead+3)&&Math.abs(predictedSide)<3.8)
   relative.push({id:other.id,distance:longitudinal,lateral:predictedSide,closing,horizon});
 }
 relative.sort((a,b)=>a.distance-b.distance);
 const leader=relative.find(c=>c.distance>-.5&&Math.abs(c.lateral)<2.2)||null;
 const sideMargin=Math.max(0,roadWidth*.5-1.05-Math.abs(roadOffset));
 // Side change must be both physically possible AND cleared by raycast road
 // probes; never use a fake opening beyond the guardrail.
 const leftOk=sideMargin>=1.55 && obstacle?.leftClear!==false;
 const rightOk=sideMargin>=1.55 && obstacle?.rightClear!==false;
 let side=0,reason='clear',desiredSpeed=Infinity;
 if(leader){
  const gap=Math.max(.5,leader.distance-1.8);
  desiredSpeed=clamp((gap-1.2)*1.8,0,20);
  if(leader.distance<lookahead+2){
   const prefer=previousSide||(leader.lateral>=0?-1:1);
   const candidate=[prefer,-prefer].find(s=>s<0?leftOk:rightOk);
   // Don't overtake near a close obstacle or a tight corner. Following and
   // braking is a valid deliberate action, not a stalled/reverse state.
   if(candidate&&leader.distance>2.5&&obstacle?.type!=='wall'){
    side=candidate;reason='pass';desiredSpeed=Infinity;
   }else reason='follow';
  }
 }
 if(obstacle && obstacle.distance<2.1 && obstacle.type==='wall'){
  desiredSpeed=Math.min(desiredSpeed,1);side=0;reason='barrier';
 }
 return {side,reason,desiredSpeed,leader,neighbors:relative.length,blocked:!!leader&&side===0};
}
/** Server-side sensor for the LAN sandbox where PlayCanvas raycasts do not
 * exist. The browser continues to use real Ammo raycasts. Never confuse the
 * two: this is conservative analytic footprint testing, not mesh collision.
 */
export function scanNpcWorldObstacles(car,track,others=[]){
 const yaw=car.yaw||0,fx=Math.sin(yaw),fz=Math.cos(yaw),rx=fz,rz=-fx;
 const obstacles=[...(track.collision?.obstacles||[]).map(o=>({...o,type:'dynamic'})),
  ...(track.collision?.walls||[]).map(w=>({...w,type:'wall'}))];
 const nearby=[];
 const clearance=(x,z,o,pad=.6)=>{
  const yaw=o.yaw||0,c=Math.cos(yaw),si=Math.sin(yaw),dx=x-o.x,dz=z-o.z;
  const lx=c*dx-si*dz,lz=si*dx+c*dz;
  const hx=(o.hx??.5)+pad,hz=(o.hz??.5)+pad;
  return Math.max(Math.abs(lx)-hx,Math.abs(lz)-hz);
 };
 for(const o of obstacles){
  // Sweep a narrow corridor along the FRONT direction. The previous version
  // treated an entire long guardrail as a giant circle, mistakenly reporting
  // a collision even when the wall was 5 m to the side of the roadway.
  let at=Infinity;
  for(let t=.7;t<=13;t+=.35){
   if(clearance(car.x+fx*t,car.z+fz*t,o,.66)<0){at=t;break;}
  }
  if(at!==Infinity)nearby.push({distance:at,type:o.type,name:o.id||o.type,
   side:(o.x-car.x)*rx+(o.z-car.z)*rz,point:o});
 }
 for(const o of others){if(o===car||o.id===car.id)continue;
  const dx=o.x-car.x,dz=o.z-car.z,along=dx*fx+dz*fz,side=dx*rx+dz*rz;
  if(along>0&&along<9&&Math.abs(side)<2.3)nearby.push({distance:Math.max(0,along-1),type:'car',name:o.id,side,point:o});
 }
 if(!nearby.length)return null;nearby.sort((a,b)=>a.distance-b.distance);
 const target=nearby[0];
 const roadWidth=track.race.roadWidth||6;
 const laneCanPass=offset=>{
  const x=car.x+fx*4+rx*offset,z=car.z+fz*4+rz*offset;
  // Estimate road clearance from closest authored waypoint segments.
  const points=track.race.navigation?.points||track.race.waypoints;
  let best=Infinity;
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
   if(l2<1e-8)continue;const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1);
   best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
  }
  if(best>roadWidth*.5-.85)return false;
  for(const o of obstacles){
   if(clearance(x,z,o,.85)<0)return false;
  }
  return true;
 };
 return {distance:target.distance,name:target.name,type:target.type,
  leftClear:laneCanPass(-1.9),rightClear:laneCanPass(1.9),
  awaySide:Math.abs(target.side)>.2?-Math.sign(target.side):0};
}
