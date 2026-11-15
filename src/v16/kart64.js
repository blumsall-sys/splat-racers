/**
 * Splat Racers v1.6 – arcade kart steering, inspired by the published Mario Kart 64
 * control scheme (analog stick + A gas + B brake + R hop/power-slide).
 * These are original, documented tuning values; they do not claim Nintendo's
 * proprietary formulas or exact Mario Kart 64 vehicle physics.
 *
 * Coordinate contract: chassis nose = local +Z; Y is vertical; screen-right
 * from a chase camera behind a +Z-facing car is world -X. So right steering
 * (input +1) produces NEGATIVE Y angular velocity when moving forward.
 */
import {driveForces, signedForwardSpeed, wheelSpinStep, wheelSteerDegrees} from '../v14/drive-math.js';
import {projectForceToRoad, preserveAngularSlopeAxes} from '../v14/slope-vehicle.js';

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export const KART_TUNING=Object.freeze({
  maxTurnRate:1.93,             // rad/s at full stick and full ground speed
  minimumTurnSpeed:.25,        // m/s; sharp response immediately after taking off
  fullTurnSpeed:4.8,          // m/s; max steering authority reached here
  normalSteerResponse:16,     // seconds^-1; input is actual yaw-velocity servo
  driftSteerResponse:12,
  neutralYawResponse:11,
  driftStartSpeed:1.35,       // m/s
  slideGrip:1.7,              // lateral friction while power sliding
  normalGrip:3.4,
  driftTurnMultiplier:1.23,
  turboDuration:.72,
  turboForceMultiplier:1.58,
  spinTurnRate:2.0,
  maxSteerDegrees:29
});
export function emptyDrift(){return {active:false,direction:0,stage:0,lastCounter:0,boostTime:0,hopTime:0};}

/** Advance drift/mini-turbo with no browser/PlayCanvas dependency. */
export function nextDrift(previous,input,speed,dt){
  const s={...emptyDrift(),...previous};
  const steer=clamp(Number(input.steer)||0,-1,1);
  const request=!!input.drift;
  const started=!s.active&&request&&Math.abs(steer)>.16&&Math.abs(speed)>=KART_TUNING.driftStartSpeed;
  if(started){s.active=true;s.direction=Math.sign(steer);s.stage=0;s.lastCounter=s.direction;s.hopTime=.16;}
  if(s.active){
    if(!request){
      if(s.stage>=3)s.boostTime=KART_TUNING.turboDuration;
      s.active=false;s.direction=0;s.stage=0;s.lastCounter=0;
    }else{
      // MK64-style countersteer changes sparks and earns a release boost.
      // A proper counter and return must be distinct, not keyboard repeats.
      const direction=Math.abs(steer)>.42?Math.sign(steer):0;
      if(direction&&direction!==s.lastCounter){
        s.stage=Math.min(3,s.stage+1);
        s.lastCounter=direction;
      }
    }
  }
  s.boostTime=Math.max(0,s.boostTime-dt);
  s.hopTime=Math.max(0,s.hopTime-dt);
  return s;
}

/** Pure physics-controller update: no engine mutation or hidden global state.
 * The existing force model drives translation and dynamic collisions. Yaw uses
 * a filtered angular-VELOCITY setpoint, because v1.5 torque was too weak to
 * turn reliably with the kart's inertia and angular damping.
 */
export function kartControlStep(body,input,driftState,dt){
  if(!(dt>0&&dt<=.12))throw new Error('Invalid kart simulation timestep '+dt);
  const speed=signedForwardSpeed(body);
  const drift=nextDrift(driftState,input,speed,dt);
  const normalizedSteer=clamp(Number(input.steer)||0,-1,1);
  const hasThrottle=Math.abs(input.throttle||0)>.01;
  const spinTurn=!!input.accelerate&&!!input.brake&&Math.abs(speed)<.85&&Math.abs(normalizedSteer)>.1;
  const travelSign=Math.abs(speed)>.24?Math.sign(speed):(input.throttle<0?-1:1);
  const speedAuthority=clamp((Math.abs(speed)-KART_TUNING.minimumTurnSpeed)/(KART_TUNING.fullTurnSpeed-KART_TUNING.minimumTurnSpeed),0,1);
  // Steering at 0.3 m/s should already be perceptible; no turning on spot
  // unless explicitly pressing gas + brake with steering (spin-turn).
  let desiredYaw=spinTurn ? -normalizedSteer*KART_TUNING.spinTurnRate :
    -normalizedSteer*travelSign*KART_TUNING.maxTurnRate*(.36+.64*speedAuthority)*(Math.abs(speed)>.1||hasThrottle?1:0);
  if(Math.abs(normalizedSteer)<.001&&!spinTurn)desiredYaw=0;
  if(drift.active){
    // Hold a cornering direction during the slide even while countersteering.
    // Countersteer softens/tightens the turn, rather than reversing drift.
    const counter=Math.sign(normalizedSteer)===drift.direction?1:.50;
    desiredYaw=-drift.direction*travelSign*KART_TUNING.maxTurnRate*KART_TUNING.driftTurnMultiplier*counter*(.45+.55*speedAuthority);
  }
  const response=drift.active?KART_TUNING.driftSteerResponse:
    Math.abs(normalizedSteer)<.04?KART_TUNING.neutralYawResponse:KART_TUNING.normalSteerResponse;
  const alpha=1-Math.exp(-response*dt);
  const commandedYaw=body.omega+(desiredYaw-body.omega)*alpha;
  const drive=driveForces({...body,...input,drift:drift.active});
  // During drift, preserve a little lateral velocity for bumper-car cornering.
  const f={x:Math.sin(body.yaw),z:Math.cos(body.yaw)};
  const right={x:-f.z,z:f.x};
  const lateral=body.vx*right.x+body.vz*right.z;
  // The old unlimited corrective grip could exceed 12 kN during a side impact
  // and fight Ammo contact normals on banked or tessellated roads.
  const desiredSide=clamp(-lateral*170*(drift.active?KART_TUNING.slideGrip:KART_TUNING.normalGrip),-170*13,170*13);
  const previousSide=drive.fx*right.x+drive.fz*right.z;
  const sideDelta=desiredSide-previousSide;
  let fx=drive.fx+right.x*sideDelta,fz=drive.fz+right.z*sideDelta;
  if(drift.boostTime>0&&input.throttle>0){fx+=f.x*170*13;fz+=f.z*170*13;}
  return {fx,fz,desiredYaw,commandedYaw,speed,drift,spinTurn,
    wheelAngle:wheelSteerDegrees(normalizedSteer),wheelRoll:wheelSpinStep(speed,dt),
    steeringInput:normalizedSteer};
}

/** Apply the computed result to a live PlayCanvas rigidbody. Components are
 * resolved and checked each frame, no stale cached Ammo-body pointers.
 * Rotational servo preserves the rigidbody and its wall/car contact solver;
 * it changes ONLY the Y angular velocity, not position/heading each frame.
 */
export function applyKartController(car,input,dt,pc){
  const rb=car?.entity?.rigidbody;
  if(!rb)throw new Error('No live kart rigidbody for '+(car?.id||'unknown'));
  const wasDrifting=!!car.driftState?.active;
  const state=kartControlStep(car,input,car.driftState||emptyDrift(),clamp(dt,1/240,.1));
  car.driftState=state.drift;
  // Convert part of the forward force into the road tangent on a hill.
  // Gravity then naturally reduces uphill acceleration; in the air, only gravity acts vertically.
  const force=projectForceToRoad(state.fx,state.fz,car.roadNormal,car.grounded);
  rb.applyForce(force.x,force.y,force.z);
  if(state.drift.active&&!wasDrifting){
    // The initial R-button action is a small real physics hop, just enough to
    // unload the tires briefly (v ~= 1.25 m/s, rise about 8 cm in gravity).
    // Do NOT teleport the physics body or snap it onto track geometry.
    rb.applyImpulse(0,170*1.25,0);
  }
  const rot=rb.angularVelocity;
  // Do not zero pitch/roll each frame. On graded surfaces that locks the box
  // against the road and causes the front chassis edge to chatter on triangles.
  const angular=preserveAngularSlopeAxes(rot,state.commandedYaw);
  rb.angularVelocity=new pc.Vec3(angular.x,angular.y,angular.z);
  rb.activate();
  // Tire visuals spin with signed physical speed; only front tires steer.
  for(const wheel of car.wheels){
    wheel.spin+=state.wheelRoll;
    wheel.steering.setLocalEulerAngles(0,wheel.front?state.wheelAngle:0,0);
    wheel.rolling.setLocalEulerAngles(wheel.spin*180/Math.PI,0,0);
  }
  car.driverDiagnostics={steer:state.steeringInput,yawTarget:state.desiredYaw,yawSet:state.commandedYaw,
    yawBefore:rot.y,roadNormalY:car.roadNormal?.y??null,gradeForceY:force.y,drifting:state.drift.active,boost:state.drift.boostTime,spinTurn:state.spinTurn};
  return state;
}
