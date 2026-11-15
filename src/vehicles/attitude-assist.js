/** Active *physical* upright assistance for hovercraft and drones.
 * Torque is applied through the existing Ammo body. Nothing touches the
 * renderer transform; contact, collisions and angular inertia remain real.
 */
export const limit=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const RAD=180/Math.PI;
const cosd=d=>Math.cos(d/RAD);
export function smoothstep(a,b,x){
 const t=limit((x-a)/(b-a),0,1);
 return t*t*(3-2*t);
}
export function attitudeError(up={x:0,y:1,z:0},right={x:1,y:0,z:0}){
 const u=up||{x:0,y:1,z:0};
 const inv=1/(Math.hypot(u.x||0,u.y??1,u.z||0)||1);
 const x=(u.x||0)*inv,y=(u.y??1)*inv,z=(u.z||0)*inv;
 const tiltRadians=Math.acos(limit(y,-1,1));
 // up x worldUp -> the axis that rotates the hull toward world vertical.
 // If perfectly inverted, their cross product is zero; the body right axis
 // is an unambiguous axis for an intentional half-turn recovery.
 let ax=-z,az=x;
 let mag=Math.hypot(ax,az);
 if(mag<1e-4 && y<-.99){
  ax=right?.x??1;az=right?.z??0;mag=Math.hypot(ax,az);
  if(mag<1e-4){ax=1;az=0;mag=1;}
 }
 if(mag>0){ax/=mag;az/=mag;}
 // No propulsion when rolled >70 degrees; full response by 25 degrees.
 const driveAuthority=smoothstep(cosd(70),cosd(25),y);
 return {upDot:y,tiltRadians,tiltDegrees:tiltRadians*RAD,
  axis:{x:ax,z:az},driveAuthority,gateEligible:y>=cosd(55)};
}
export function uprightTorque(up,right,angular,mass,kind='HOVER',assist=1){
 const state=attitudeError(up,right),strength=limit(assist,.5,2);
 const gain=(kind==='DRONE'?20:23)*strength;
 const damping=(kind==='DRONE'?8.8:9.5)*Math.sqrt(strength);
 const max=mass*70;
 // Smooth all the way to a 180-degree inversion (not sin(angle), which
 // would vanish at 180 degrees). Damping resists collision-induced spinning.
 const targetX=state.axis.x*state.tiltRadians;
 const targetZ=state.axis.z*state.tiltRadians;
 return {...state,torque:{
  x:limit(mass*(gain*targetX-damping*(angular?.x||0)),-max,max),
  z:limit(mass*(gain*targetZ-damping*(angular?.z||0)),-max,max)
 }};
}
export function needsLocalRighting(tiltDegrees,elapsed,delay=2.6){
 return tiltDegrees>65 && elapsed>=limit(delay,1.2,6);
}

/** Target tilt is a small deliberate bank into a turn, not a locked renderer pose.
 * Local +Z is nose, +X is right. Build target up in world coordinates from
 * heading, so stabilizing torque still works when the vehicle changes yaw.
 */
export function flightBankTarget(heading,steer=0,throttle=0,ascend=0,kind='HOVER'){
 const x=Number(heading?.x)||0,z=Number(heading?.z) || (x===0?1:0);
 const d=Math.hypot(x,z)||1,fx=x/d,fz=z/d,rx=fz,rz=-fx;
 // Existing flight yaw servo uses -steer; lean in the SAME actual yaw direction.
 const bank=limit(-Number(steer)||0,-1,1)*(kind==='DRONE'?27:21)*Math.PI/180;
 const pitch=limit((Number(throttle)||0)*(kind==='DRONE'?13:10) - (Number(ascend)||0)*(kind==='DRONE'?10:7),-16,16)*Math.PI/180;
 const b=Math.sin(bank),p=Math.sin(pitch);
 const target={x:rx*b+fx*p,y:Math.cos(bank)*Math.cos(pitch),z:rz*b+fz*p};
 const len=Math.hypot(target.x,target.y,target.z)||1;
 return {up:{x:target.x/len,y:target.y/len,z:target.z/len},bankDegrees:bank*RAD,pitchDegrees:pitch*RAD};
}
export function bankedFlightTorque(up,right,angular,mass,kind='HOVER',assist=1,desiredUp={x:0,y:1,z:0}){
 const state=attitudeError(up,right);
 const ax=(up?.x||0),ay=(up?.y??1),az=(up?.z||0),al=Math.hypot(ax,ay,az)||1;
 const ux=ax/al,uy=ay/al,uz=az/al;
 const tx=desiredUp.x,ty=desiredUp.y,tz=desiredUp.z;
 const dot=limit(ux*tx+uy*ty+uz*tz,-1,1);
 const angle=Math.acos(dot);
 let cx=uy*tz-uz*ty,cz=ux*ty-uy*tx;
 const cm=Math.hypot(cx,cz);
 if(cm>1e-5){cx=cx/cm*angle;cz=cz/cm*angle;}
 else if(dot<-.99){cx=state.axis.x*Math.PI;cz=state.axis.z*Math.PI;}
 else {cx=0;cz=0;}
 const strength=limit(assist,.5,2),gain=(kind==='DRONE'?20:23)*strength;
 const damping=(kind==='DRONE'?8.8:9.5)*Math.sqrt(strength),max=mass*70;
 return {...state,torque:{
  x:limit(mass*(gain*cx-damping*(angular?.x||0)),-max,max),
  z:limit(mass*(gain*cz-damping*(angular?.z||0)),-max,max)
 }};
}
