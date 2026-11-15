/** Shared race pace: applies to every player and NPC and all three rig types.
 * No mutation of catalog templates, no cumulative speed multiplying on restart.
 */
export const RACE_SPEED_OPTIONS=Object.freeze([0.75,1,1.25,1.5,2,2.5]);
export function raceSpeedMultiplier(raw){
 const value=Number(raw);
 return RACE_SPEED_OPTIONS.includes(value)?value:1;
}
export function kartSpeedTuning(spec={},competitive=true,multiplier=1){
 const pace=raceSpeedMultiplier(multiplier);
 const raw=Number.isFinite(spec.maxSpeed)?spec.maxSpeed:12.5;
 const base=competitive?Math.min(12.5,raw):raw;
 return {racePace:pace,baseSpeedMps:base,speedLimitMps:base*pace,engineForcePerRearWheel:340*pace,
  reverseForcePerRearWheel:240*pace,brakingForcePerWheel:20*pace*Math.sqrt(pace)};
}
export function flightSpeedTuning(spec={},type='DRONE',competitive=true,multiplier=1){
 const pace=raceSpeedMultiplier(multiplier);
 const nominal=type==='HOVER'?4.5:4.0;
 const authored=Number.isFinite(spec.acceleration)?spec.acceleration:nominal;
 return {speedLimitMps:(competitive?Math.min(12.5,spec.maxSpeed??12.5):(spec.maxSpeed??12.5))*pace*(competitive?.87:1),
  accelerationMps2:(competitive?Math.min(authored,nominal):authored)*pace*(competitive?.87:1)};
}
