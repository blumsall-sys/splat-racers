/** Height-unbounded hovercraft propulsion. A short vertical impulse starts a
 * jump; a world-space altitude target supports it even after the ground ray
 * falls out of range. Repeated presses / holding the button climb in steps.
 * A speed/cooldown limit is deliberate; there is NO world-Y ceiling.
 */
export const HOVER_TUNING=Object.freeze({hopInterval:.78,hopStep:3.0,descendSpeed:4.5,groundClearance:.95});
const cap=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function hoverHopUpdate(car,{y,vy,groundY=null,ascend=false,descend=false,dt=1/60,authority=1,hopSpeed=null}={}){
 const spec=car.spec||{},h=spec.hoverHeight??2.45;
 const delta=cap(Number(dt)||0,0,.1);
 const cooldown=cap(Number(spec.hoverHopInterval??HOVER_TUNING.hopInterval),.35,2);
 const step=cap(Number(spec.hoverHopStep??HOVER_TUNING.hopStep),1,8);
 const speed=cap(Number(hopSpeed??spec.jumpSpeed??5.5),1,14);
 const surface=Number.isFinite(groundY)?groundY:null;
 if(!Number.isFinite(car.hoverWorldTarget))car.hoverWorldTarget=surface===null?y:surface+h;
 if(!car.hoverManualHeight&&surface!==null)car.hoverWorldTarget=surface+h;
 car.hoverHopCooldown=Math.max(0,(car.hoverHopCooldown||0)-delta);
 let impulseSpeed=0;
 // Each hop adds a bounded amount of vertical velocity and raises the stable
 // hover target. A held button repeats at the specified interval, so authored
 // rings are reachable even many meters above the road.
 if(ascend&&!descend&&authority>.55&&car.hoverHopCooldown<=0){
  const requestedSpeed=speed*(.45+.55*authority);
  impulseSpeed=Math.max(0,requestedSpeed-vy);
  car.hoverWorldTarget=Math.max(car.hoverWorldTarget,y)+step;
  car.hoverManualHeight=true;
  car.hoverHopCooldown=cooldown;
 }
 if(descend){
  car.hoverManualHeight=true;
  car.hoverWorldTarget-=HOVER_TUNING.descendSpeed*delta;
 }
 // Never command flight beneath the surface. When the player lands back in
 // the ordinary hover band, return to road-following mode on subsequent frames.
 if(surface!==null){
  car.hoverWorldTarget=Math.max(car.hoverWorldTarget,surface+HOVER_TUNING.groundClearance);
  if(!ascend&&!descend&&car.hoverManualHeight&&y<=surface+h+.28&&vy<.55){
   car.hoverManualHeight=false;
   car.hoverWorldTarget=surface+h;
  }
 }
 car.hoverTarget=car.hoverWorldTarget; // backwards-compatible diagnostics
 return {targetY:car.hoverWorldTarget,impulseSpeed,cooldownRemaining:car.hoverHopCooldown,
  manual:!!car.hoverManualHeight,hasGround:surface!==null};
}
