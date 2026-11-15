// Pure racing-line controller. Takes the exact same throttle/steer inputs as the human.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const AI_LEVELS=Object.freeze({
 easy:  {cruise:7.2,corner:4.7,lookahead:3.2,steerGain:1.45,brakeGain:1.0},
 medium:{cruise:9.7,corner:6.2,lookahead:4.3,steerGain:1.85,brakeGain:1.15},
 hard:  {cruise:12.3,corner:7.5,lookahead:5.2,steerGain:2.25,brakeGain:1.4}
});
function targetOnPath(position,points,distance){
 // Find closest point on a polyline (not merely the nearest node). Projecting
 // onto segments prevents losing the line following a sideways collision.
 let best={d2:Infinity,i:0,t:0};
 for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz;
   const t=clamp(((position.x-a.x)*dx+(position.z-a.z)*dz)/(L2||1),0,1);
   const ex=position.x-(a.x+dx*t),ez=position.z-(a.z+dz*t),d2=ex*ex+ez*ez;
   if(d2<best.d2)best={d2,i,t};
 }
 let i=best.i,a=points[i],b=points[(i+1)%points.length];
 let remainder=distance+(best.t*Math.hypot(b.x-a.x,b.z-a.z));
 for(let n=0;n<=points.length;n++){
   a=points[i];b=points[(i+1)%points.length];
   const L=Math.hypot(b.x-a.x,b.z-a.z);
   if(remainder<=L)return {x:a.x+(b.x-a.x)*remainder/L,z:a.z+(b.z-a.z)*remainder/L,segment:i};
   remainder-=L;i=(i+1)%points.length;
 }
 return {...points[i],segment:i};
}
export function npcInput(car,track,difficulty='medium'){
 const cfg=AI_LEVELS[difficulty]||AI_LEVELS.medium;
 const speed=Math.hypot(car.vx,car.vz),fwd=car.vx*Math.sin(car.yaw)+car.vz*Math.cos(car.yaw);
 const look=cfg.lookahead+speed*.15;
 const target=targetOnPath(car,track.race.waypoints,look);
 const desired=Math.atan2(target.x-car.x,target.z-car.z);
 const error=wrap(desired-car.yaw);
 // Our shared solver maps positive steering to negative yaw (screen-right).
 const turn=clamp((-error*cfg.steerGain+car.omega*.24),-1,1);
 const approach=Math.abs(error);
 const desiredSpeed=approach>.55?cfg.corner:cfg.cruise;
 let throttle=clamp((desiredSpeed-fwd)*.5,-.8,1);
 // Recover when a collision points the kart the wrong way. Drive forward and
 // steer toward the line rather than applying spin-in-place/angular teleport.
 if(approach>1.5&&speed<2.5)throttle=.45;
 return {throttle,steer:turn,reset:false,target};
}
