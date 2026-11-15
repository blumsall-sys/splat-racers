/** Five-second nitro recharge shared by solo and local human drivers. */
export const BOOST={duration:1.0,cooldown:5.0,engineMultiplier:1.7,speedMultiplier:1.35};
export function makeBoostState(){return {active:0,cooldown:0,held:false};}
export function stepBoost(state,pressed,dt){
 const s=state||makeBoostState(),step=Math.max(0,Math.min(.1,Number(dt)||0));
 const triggered=!!pressed&&!s.held&&s.cooldown<=0;
 s.held=!!pressed;
 if(triggered){s.cooldown=BOOST.cooldown;s.active=BOOST.duration;}
 else {s.cooldown=Math.max(0,s.cooldown-step);s.active=Math.max(0,s.active-step);}
 return {state:s,triggered,active:s.active>0,remaining:s.cooldown};
}
export function boostLabel(state){return state?.active>0?'NITRO ACTIVE':state?.cooldown>0?`NITRO ${state.cooldown.toFixed(1)}s`:'NITRO READY';}
