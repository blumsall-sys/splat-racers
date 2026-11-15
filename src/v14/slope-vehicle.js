/** Grade-aware force application without a second suspension solver.
 * The roadway's Ammo static collider is the ONLY authority for height.
 * Pure functions for source-level regression tests.
 */
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export function projectForceToRoad(x,z,normal,grounded,limit=0.55){
 if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('Non-finite drive force');
 if(!grounded||!normal||normal.y<0.5)return {x:x*0.12,y:0,z:z*0.12};
 // n . F = 0 => force tangent to incline/bank; avoids pushing INTO road.
 const tilt=-(normal.x*x+normal.z*z)/normal.y;
 const y=clamp(tilt,-Math.hypot(x,z)*limit,Math.hypot(x,z)*limit);
 return {x,y,z};
}
export function preserveAngularSlopeAxes(previous,yaw,limit=3.5){
 const safe=v=>Number.isFinite(v)?clamp(v,-limit,limit):0;
 return {x:safe(previous?.x),y:Number.isFinite(yaw)?yaw:0,z:safe(previous?.z)};
}
export function safeSlopeDynamics(speed,dt,angularFactor){
 return Number.isFinite(speed)&&dt>0&&dt<.15&&angularFactor?.x>0&&angularFactor?.z>0;
}
