/** Arcade kart dynamics, applied to the native Ammo chassis without
 * replacing btRaycastVehicle. Pure functions are covered by regression tests.
 * Keep real collisions, wheel suspension, jumping, and road banking intact.
 */
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export function kartSteeringScale(speedMps=0,pace=1,baseLimit=12.5){
 const ratio=clamp(Math.abs(speedMps)/Math.max(1,baseLimit*pace),0,1);
 // A kart capable of twice the speed must not keep the same steering angle:
 // turn-induced lateral acceleration rises with velocity squared.
 const paceTaper=1/Math.sqrt(Math.max(1,pace));
 const speedReduction=.50+.13*clamp((pace-1)/1.5,0,1);
 return clamp((1-speedReduction*ratio)*paceTaper,.16,1);
}
export function kartLaunchScale(speedMps=0,pace=1){
 return pace<=1.25?1:clamp(.78+.22*Math.abs(speedMps)/5,.78,1);
}
export function kartDownforce(mass=170,speedMps=0,pace=1,contacts=0,airborne=false){
 if(contacts<2||airborne)return 0;
 // Grounded-only mild aero assistance; not a global gravity modifier.
 const normal=Math.min(3.7,Math.pow(Math.abs(speedMps)/12.5,2));
 return mass*9.81*.27*normal;
}
export function kartUprightTorque({up={x:0,y:1,z:0},roadNormal=null,angular={x:0,z:0},mass=170,pace=1,contacts=0,airborne=false}={}){
 if(contacts<2||airborne)return {x:0,z:0};
 const target=roadNormal?.y>.45?roadNormal:{x:0,y:1,z:0};
 const ul=Math.hypot(up.x,up.y,up.z)||1,tl=Math.hypot(target.x,target.y,target.z)||1;
 const ux=up.x/ul,uy=up.y/ul,uz=up.z/ul;
 const tx=target.x/tl,ty=target.y/tl,tz=target.z/tl;
 // up x desiredUp (shortest path for small pitch/roll deviations)
 const k=4+Math.min(2.5,pace)*2,damper=3.4+Math.min(2.5,pace)*1.4;
 const limit=mass*38;
 return {x:clamp(mass*(k*(uy*tz-uz*ty)-damper*angular.x),-limit,limit),
         z:clamp(mass*(k*(ux*ty-uy*tx)-damper*angular.z),-limit,limit)};
}
