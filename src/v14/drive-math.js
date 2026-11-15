// LAB5 v1.5 -- one shared +Z-forward vehicle convention.
// In the chase camera, screen-right is local -X; steering right therefore
// DECREASES world yaw. These conventions are also used by AI and tire visuals.
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const VEHICLE={mass:170,wheelRadius:.30,maxSteerRad:.44,maxYawRate:1.45,maxSpeed:14};
export function axesForYaw(yaw){return {forward:{x:Math.sin(yaw),z:Math.cos(yaw)},right:{x:-Math.cos(yaw),z:Math.sin(yaw)}};}
export function signedForwardSpeed({yaw,vx,vz}){const f=axesForYaw(yaw).forward;return vx*f.x+vz*f.z;}
/** Pure force/torque solver. Never teleport or overwrite planar velocity in normal driving. */
export function driveForces({yaw=0,vx=0,vz=0,omega=0,throttle=0,steer=0,mass=VEHICLE.mass,maxSpeed=VEHICLE.maxSpeed}){
 if(![yaw,vx,vz,omega,throttle,steer].every(Number.isFinite))throw new Error('Invalid vehicle physics state');
 const {forward:f,right:r}=axesForYaw(yaw);
 const along=vx*f.x+vz*f.z,side=vx*r.x+vz*r.z;
 const gas=clamp(throttle,-1,1),wheel=clamp(steer,-1,1);
 const changingDirection=gas!==0&&gas*along<-.25;
 let thrust=gas*mass*(changingDirection?23.0:18.5);
 if(gas*along>0&&Math.abs(along)>=maxSpeed)thrust=0;
 // Lateral grip is force based; it doesn't cancel impulses from an actual bump.
 const grip=Math.abs(wheel)>.6&&Math.abs(along)>7.5?4.0:8.0;
 const sideForce=clamp(-side*mass*grip,-mass*35,mass*35);
 // P1: D=+1 => -yaw (right on chase camera); A=-1 => +yaw.
 // Reversing gives the expected backwards steering response.
 const direction=Math.abs(along)>.30?Math.sign(along):(gas<0?-1:1);
 const steerAuthority=clamp(Math.abs(along)/3.2,0,1);
 const desiredYawRate=-wheel*direction*steerAuthority*VEHICLE.maxYawRate;
 // Clamp overspeed from collision impulses and actively damp uncommanded spins.
 const torque=clamp((desiredYawRate-omega)*850,-2600,2600);
 return {fx:f.x*thrust+r.x*sideForce,fz:f.z*thrust+r.z*sideForce,torque,speed:along,desiredYawRate,steerAngle:-wheel*VEHICLE.maxSteerRad};
}
export function physicsState(entity){
 if(!entity?.rigidbody)throw new Error('Kart rigidbody not initialized');
 const p=entity.getPosition(),f=entity.forward,v=entity.rigidbody.linearVelocity,av=entity.rigidbody.angularVelocity;
 return {x:p.x,z:p.z,y:p.y,yaw:Math.atan2(-f.x,-f.z),vx:v.x,vz:v.z,omega:av.y};
}
/** World axle is local +/-X. Positive signed forward speed spins tire around +X. */
export function wheelSpinStep(signedSpeed,dt,radius=VEHICLE.wheelRadius){return signedSpeed*dt/radius;}
export function wheelSteerDegrees(input){return -clamp(input,-1,1)*VEHICLE.maxSteerRad*180/Math.PI;}
