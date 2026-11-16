/**
 * Validated remote player intent, never state transforms. Bullet physics on
 * the host remains the only source of actual car position and lap progress.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function cleanInput(data={}){
 const finite=value=>Number.isFinite(Number(value))?Number(value):0;
 return {seq:clamp(Math.floor(finite(data.seq)),0,2147483647),
  throttle:clamp(finite(data.throttle),-1,1),steer:clamp(finite(data.steer),-1,1),
  ascend:!!data.ascend,descend:!!data.descend,boost:!!data.boost,
  receivedAt:Date.now()};
}
