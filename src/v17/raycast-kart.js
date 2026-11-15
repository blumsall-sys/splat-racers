/**
 * Splat Racers v1.7 — native Bullet raycast vehicle.
 * The only physical chassis is the existing PlayCanvas dynamic rigidbody.
 * A btRaycastVehicle action in the SAME PlayCanvas Ammo world owns four wheel
 * contacts, springs, steering and tire friction. No separate wheel rigidbodies,
 * road-probe springs, planar grip forces, or yaw-velocity servo are active.
 *
 * Chassis convention: local +Z forward, local +X right, +Y up.
 * Player input convention: D/right => +1, A/left => -1.
 * Steering polarity is inverted ONLY at the btRaycastVehicle boundary.
 * The observed native vehicle response on the current runtime was reversed
 * with a positive steering command. Keep keyboard/gamepad/AI input unchanged.
 * See tests/v173-steering-polarity.test.mjs for the input-to-Bullet contract.
 * Wheel order: rear-left, rear-right, front-left, front-right (matching the
 * existing visual rig). Unlike renderer camera axes, Bullet uses world axes.
 * This follows the official PlayCanvas vehicle example: Bullet coordinates
 * 0/1/2, rear-wheel drive/braking, front-wheel steering and native wheel
 * transforms. Total braking authority is conserved when routed rear-only.
 */
import {emptyDrift,nextDrift} from '../v16/kart64.js';
import {gravityCorrection,jumpImpulseForSpeed} from '../vehicles/flight-controls.js';
import {kartSteeringScale,kartLaunchScale,kartDownforce,kartUprightTorque} from '../vehicles/kart-stability.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Do not negate input in controls.js: all players and NPCs share this mapping.
export const BULLET_STEERING_POLARITY = -1;
export const RAYCAST_TUNING=Object.freeze({
  massKg:170,
  chassisHalfWidth:1.00,chassisHalfHeight:.24,chassisHalfLength:.96,
  wheelTrack:.79,wheelAxle:.75,wheelRadius:.30,
  suspensionConnectionY:-.08, suspensionRestLength:.23,
  suspensionStiffness:22, dampingCompression:3.1,dampingRelaxation:4.0,
  maxSuspensionTravelCm:22,maxSuspensionForce:3200,
  tireGrip:5.0,driftGrip:3.2,rollInfluence:.08,
  maxSteeringRadians:.38,steeringSpeed:4.5,
  engineForcePerRearWheel:340, reverseForcePerRearWheel:240,
  brakingForcePerWheel:20, // baseline all-wheel-equivalent; 2x on each rear wheel
  speedLimitMps:12.5, dragBrake:1.5,
  startHeightAboveRoad:.67, jumpImpulse:220, jumpSpeed:5.5,hopReleaseSeconds:.28
});

/**
 * The shared NPC racing-line algorithm was tuned for the old 2.5D solver,
 * which uses the opposite steer-to-yaw convention. Player inputs already use
 * right = +1, so only adapt NPC output when driving Bullet raycast karts.
 * Keep throttle, drift and waypoint target untouched.
 */
export function adaptLegacyNpcSteering(input){
 return {...input, steer: -clamp(Number(input?.steer)||0,-1,1)};
}

export function wheelLayout(t=RAYCAST_TUNING){
 return [
  {front:false,side:-1,x:-t.wheelTrack,y:t.suspensionConnectionY,z:-t.wheelAxle},
  {front:false,side: 1,x: t.wheelTrack,y:t.suspensionConnectionY,z:-t.wheelAxle},
  {front:true, side:-1,x:-t.wheelTrack,y:t.suspensionConnectionY,z: t.wheelAxle},
  {front:true, side: 1,x: t.wheelTrack,y:t.suspensionConnectionY,z: t.wheelAxle}
 ];
}

/** Pure input map, useful for repeatable tests independent of WASM. */
export function raycastCommands(input={},speedMps=0,steering=0,dt=1/60,drift=emptyDrift(),t=RAYCAST_TUNING){
 const gas=clamp(Number(input.throttle)||0,-1,1);
 const requestedSteer=clamp(Number(input.steer)||0,-1,1);
 const speed=Number.isFinite(speedMps)?speedMps:0;
 const next=nextDrift(drift,input,speed,clamp(dt,0,.1));
 // Convert game controls (+1 = player RIGHT) to native Bullet steering.
 // v1.7.2's direct +1 -> +angle mapping produced LEFT turns on desktop.
 // The inversion belongs here rather than in input, AI or visual transforms.
 const nitro=!!input.boostActive&&gas>0;
 const limit=t.speedLimitMps*(nitro?1.35:1);
 const pace=Number(t.racePace)||1;
 const speedFactor=kartSteeringScale(speed,pace,t.baseSpeedMps||12.5);
 const targetSteering=BULLET_STEERING_POLARITY*requestedSteer*t.maxSteeringRadians*speedFactor;
 const blend=1-Math.exp(-t.steeringSpeed*clamp(dt,0,.1));
 const steeringValue=steering+(targetSteering-steering)*blend;
 const changingDirection=gas!==0&&speed*gas < -.6;
 let engine=0,brake=0;
 if(changingDirection){brake=t.brakingForcePerWheel*Math.min(1,Math.abs(gas));}
 else if(gas>0){engine=Math.abs(speed)<limit?t.engineForcePerRearWheel*gas*(nitro?1.7:1)*kartLaunchScale(speed,pace):0;}
 else if(gas<0){engine=speed>-t.speedLimitMps?t.reverseForcePerRearWheel*gas:0;}
 else brake=t.dragBrake;
 // No second physics solver: during drift Bullet changes wheel friction.
 const tireGrip=next.active?t.driftGrip:t.tireGrip;
 if(next.boostTime>0 && gas>0)engine*=1.22;
 return {engine,brake,steeringValue,tireGrip,drift:next,hop:next.hopTime>0 && !(drift?.hopTime>0),speed,steer:requestedSteer};
}

/**
 * Follow the official PlayCanvas vehicle's axle ownership: front wheels only
 * steer, rear wheels only propel and brake. Our earlier build braked all four
 * wheels: to preserve its effective braking force, double the per-wheel brake
 * command on the two rear wheels (2 * 2 = 4 wheel-equivalents).
 *
 * The game-specific steering polarity, boost engine value and hop impulse are
 * calculated elsewhere, unchanged. The function is intentionally free of
 * PlayCanvas entities for reproducible tests of native Bullet commands.
 */
export function applyRaycastAxleControls(vehicle,command,tireGrip){
 const layout=wheelLayout();
 for(let index=0;index<layout.length;index++){
  const front=layout[index].front;
  vehicle.applyEngineForce(front?0:command.engine,index);
  vehicle.setBrake(front?0:command.brake*2,index);
  if(front)vehicle.setSteeringValue(command.steeringValue,index);
  vehicle.getWheelInfo(index).set_m_frictionSlip(tireGrip);
 }
}

/** Set up the Bullet action using PlayCanvas's *existing* dynamicsWorld. */
export function createRaycastVehicle(app,entity,Ammo=globalThis.Ammo,t=RAYCAST_TUNING){
 const world=app?.systems?.rigidbody?.dynamicsWorld;
 const body=entity?.rigidbody?.body;
 if(!world||!body)throw new Error('Raycast vehicle requires a started PlayCanvas Ammo world and live chassis rigidbody');
 for(const key of ['btVehicleTuning','btDefaultVehicleRaycaster','btRaycastVehicle','btVector3']){
  if(typeof Ammo?.[key]!=='function')throw new Error('Ammo WASM missing '+key+'; install the bundled official Ammo WASM before starting.');
 }
 let tuning=null,raycaster=null,vehicle=null,added=false;
 const vectors=[];
 try{
  tuning=new Ammo.btVehicleTuning();
  raycaster=new Ammo.btDefaultVehicleRaycaster(world);
  vehicle=new Ammo.btRaycastVehicle(tuning,body,raycaster);
  vehicle.setCoordinateSystem(0,1,2);
  for(const spec of wheelLayout(t)){
   const connection=new Ammo.btVector3(spec.x,spec.y,spec.z);
   const direction=new Ammo.btVector3(0,-1,0);
   const axle=new Ammo.btVector3(-1,0,0);
   vectors.push(connection,direction,axle);
   const wheel=vehicle.addWheel(connection,direction,axle,t.suspensionRestLength,t.wheelRadius,tuning,spec.front);
   wheel.set_m_suspensionStiffness(t.suspensionStiffness);
   wheel.set_m_wheelsDampingCompression(t.dampingCompression);
   wheel.set_m_wheelsDampingRelaxation(t.dampingRelaxation);
   wheel.set_m_frictionSlip(t.tireGrip);
   wheel.set_m_rollInfluence(t.rollInfluence);
   if(typeof wheel.set_m_maxSuspensionTravelCm==='function')wheel.set_m_maxSuspensionTravelCm(t.maxSuspensionTravelCm);
   if(typeof wheel.set_m_maxSuspensionForce==='function')wheel.set_m_maxSuspensionForce(t.maxSuspensionForce);
  }
  world.addAction(vehicle);added=true;
  if(typeof body.setActivationState==='function')body.setActivationState(4); // DISABLE_DEACTIVATION
  return {vehicle,world,body,Ammo,tuning,raycaster,steering:0,drift:emptyDrift(),
   hopHeld:false,hopCooldown:0,hopAirTime:0,disposed:false,t,expectedBody:body};
 }catch(err){
  if(added)world.removeAction(vehicle);
  // The official Ammo vehicle example intentionally does not destroy
  // btVehicleTuning: this WASM build has no owned destructor for it.
  for(const obj of [vehicle,raycaster])if(obj)Ammo.destroy(obj);
  throw err;
 }finally{
  for(const vector of vectors)Ammo.destroy(vector);
 }
}

export function driveRaycastVehicle(car,input,dt,pc){
 const gravityScale=car.gravityScale??1;
 const rig=car.raycast;
 if(!rig||rig.disposed)throw new Error(`Raycast vehicle missing for ${car.id}`);
 // PlayCanvas rebuilds Ammo bodies on collision-type changes; never silently
 // drive a vehicle connected to a stale rigidbody pointer.
 if(car.entity?.rigidbody?.body!==rig.expectedBody)throw new Error(`Chassis body replaced for ${car.id}; recreate raycast vehicle action`);
 const velocity=car.entity.rigidbody.linearVelocity;
 const f=car.entity.forward; // PlayCanvas entity.forward is -Z, kart's nose is +Z
 const speed=-(velocity.x*f.x+velocity.y*f.y+velocity.z*f.z);
 const cmd=raycastCommands(input,speed,rig.steering,dt,rig.drift,rig.t);
 rig.steering=cmd.steeringValue;rig.drift=cmd.drift;
 rig.hopAirTime=Math.max(0,(rig.hopAirTime||0)-Math.max(0,dt));
 applyRaycastAxleControls(rig.vehicle,cmd,rig.hopAirTime>0?.08:cmd.tireGrip);
 for(let i=0;i<4;i++)rig.vehicle.getWheelInfo(i).set_m_suspensionStiffness(rig.hopAirTime>0?0:rig.t.suspensionStiffness);
 // Wheel contacts from the previous Bullet fixed step, not inferred from a
 // guessed road height. Retain legitimate airborne hops and jump trajectories.
 let contactWheels=0;
 for(let i=0;i<4;i++){
  const ray=rig.vehicle.getWheelInfo(i)?.get_m_raycastInfo?.();
  if(ray?.get_m_isInContact?.())contactWheels++;
 }
 const airborne=rig.hopAirTime>0;
 const road=car.roadNormal;
 const upright=kartUprightTorque({up:car.entity.up,roadNormal:road,
  angular:car.entity.rigidbody.angularVelocity,mass:rig.t.massKg,
  pace:rig.t.racePace||1,contacts:contactWheels,airborne});
 if(Math.abs(upright.x)+Math.abs(upright.z)>.001)car.entity.rigidbody.applyTorque(upright.x,0,upright.z);
 const downforce=kartDownforce(rig.t.massKg,speed,rig.t.racePace||1,contactWheels,airborne);
 if(downforce>0)car.entity.rigidbody.applyForce(0,-downforce,0);
 const extraGravity=gravityCorrection(rig.t.massKg,gravityScale);
 if(Math.abs(extraGravity)>.01)car.entity.rigidbody.applyForce(0,extraGravity,0);
 // Hop is a fresh drift-button press, independently of steering angle or speed.
 // Sustained A/X/LB/Shift remains drift, but must never auto-hop every frame.
 // Only hop from the ground; an airborne kart cannot double-jump.
 rig.hopCooldown=Math.max(0,(rig.hopCooldown||0)-Math.max(0,dt));
 const hopRequested=!!input.drift,hopEdge=hopRequested&&!rig.hopHeld;
 rig.hopHeld=hopRequested;
 const hopped=hopEdge&&rig.hopCooldown<=0&&contactWheels>=2;
 if(hopped && car.entity.rigidbody.applyImpulse){
  const vy=car.entity.rigidbody.linearVelocity.y;
  const impulse=jumpImpulseForSpeed(rig.t.massKg,vy,rig.t.jumpSpeed);
  car.entity.rigidbody.applyImpulse(0,impulse,0);
  rig.hopAirTime=rig.t.hopReleaseSeconds;
  for(let i=0;i<4;i++){
   const wheel=rig.vehicle.getWheelInfo(i);
   wheel.set_m_suspensionStiffness(0);wheel.set_m_frictionSlip(.08);
  }
  rig.hopCooldown=.62;
 }
 car.entity.rigidbody.activate();
 car.driftState=cmd.drift;
 car.driverDiagnostics={steer:cmd.steer,yawTarget:null,yawSet:null,engine:cmd.engine,brake:cmd.brake,steeringRadians:cmd.steeringValue,drifting:cmd.drift.active,hopped,hopContacts:contactWheels,hopAirTime:rig.hopAirTime,gravityScale,downforce,contactWheels};
 return cmd;
}

/** Read Ammo's wheel world transform, NOT guessed wheel rotation/height. */
export function syncRaycastWheelVisuals(car,pc){
 const rig=car?.raycast;
 if(!rig||rig.disposed)return;
 let contacts=0,travel=0;
 for(let i=0;i<4;i++){
  rig.vehicle.updateWheelTransform(i,true);
  const transform=rig.vehicle.getWheelTransformWS(i);
  const p=transform.getOrigin(),q=transform.getRotation();
  const visual=car.wheels[i]?.visual;
  if(visual){
   visual.setPosition(p.x(),p.y(),p.z());
   visual.setRotation(new pc.Quat(q.x(),q.y(),q.z(),q.w()));
  }
  const info=rig.vehicle.getWheelInfo(i);
  const ray=info?.get_m_raycastInfo?.();
  if(ray?.get_m_isInContact?.())contacts++;
  const length=ray?.get_m_suspensionLength?.();
  if(Number.isFinite(length))travel+=length;
 }
 car.wheelDiagnostics={probes:contacts,avgGap:null,suspensionLength:travel/4,source:'Bullet raycast',speedKmh:rig.vehicle.getCurrentSpeedKmHour()};
}

export function resetRaycastVehicle(car){
 const rig=car?.raycast;if(!rig||rig.disposed)return;
 rig.steering=0;rig.drift=emptyDrift();rig.hopHeld=false;rig.hopCooldown=0;rig.hopAirTime=0;
 for(let i=0;i<4;i++){
  rig.vehicle.setSteeringValue(0,i);rig.vehicle.applyEngineForce(0,i);rig.vehicle.setBrake(0,i);
  rig.vehicle.getWheelInfo(i).set_m_suspensionStiffness(rig.t.suspensionStiffness);
 }
 if(typeof rig.vehicle.resetSuspension==='function')rig.vehicle.resetSuspension();
 for(let i=0;i<4;i++)rig.vehicle.updateWheelTransform(i,true);
}
export function stopRaycastVehicle(car){
 const rig=car?.raycast;if(!rig||rig.disposed)return;
 // Brake only the driven axle as in the official example, preserving the
 // total stopped/paused brake strength from the earlier four-wheel version.
 for(let i=0;i<4;i++){
  rig.vehicle.applyEngineForce(0,i);
  rig.vehicle.setBrake(i<2?rig.t.brakingForcePerWheel*.70:0,i);
 }
}
export function disposeRaycastVehicle(car){
 const rig=car?.raycast;if(!rig||rig.disposed)return;
 // Remove action BEFORE rigidbody/entity is destroyed or engine restarts.
 rig.world.removeAction(rig.vehicle);
 // Official PlayCanvas vehicle.js removes the action, then destroys the
 // raycaster and vehicle only. btVehicleTuning has no valid Ammo.destroy
 // binding in the bundled WASM build and caused reset/restart cleanup errors.
 for(const native of [rig.raycaster,rig.vehicle])rig.Ammo.destroy(native);
 rig.disposed=true;car.raycast=null;
}
