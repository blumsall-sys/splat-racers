// Canonical wheel layout for both WebGL and software renderers.
// Forward is local +Z; positive yaw rotates forward towards world +X.
// The chase camera displays -X as screen-right, hence right steering is negative yaw.
import {roadHeight} from '../physics/terrain.js';

export const WHEEL_RADIUS = 0.32;
export const WHEEL_TRACK_HALF = 0.78;
export const WHEEL_BASE_HALF = 0.82;
export const ROAD_SURFACE_OFFSET = -0.055;
export const WHEEL_CENTER_CLEARANCE = 0.001;
export const MAX_STEER_ANGLE = 0.46;

// The wheel axle remains anchored to the road; the sprung chassis can pitch, roll and bob.
// side = -1/+1 for local -X/+X; axle = -1 rear, +1 front.
export function wheelPose(body, side, axle) {
  const sin = Math.sin(body.yaw), cos = Math.cos(body.yaw);
  const xLocal = side * WHEEL_TRACK_HALF;
  const zLocal = axle * WHEEL_BASE_HALF;
  const x = body.x + cos * xLocal + sin * zLocal;
  const z = body.z - sin * xLocal + cos * zLocal;
  const ground = (body.getHeight || roadHeight)(x, z) + ROAD_SURFACE_OFFSET;
  const index = (axle > 0 ? 2 : 0) + (side > 0 ? 1 : 0);
  return {
    x, z, y: ground + WHEEL_RADIUS + WHEEL_CENTER_CLEARANCE,
    ground, side, axle, index,
    yaw: body.yaw + (axle > 0 ? (body.steerVisual || 0) : 0),
    spin: body.wheelAngles?.[index] || 0
  };
}

// Signed wheel rolling speed; reverse rotates the tires backwards.
// This tracks real longitudinal travel and the speed difference across the axle.
export function integrateWheelSpin(body, dt) {
  if (body.kind !== 'car') return;
  if (!body.wheelAngles) body.wheelAngles = [0,0,0,0];
  const sin = Math.sin(body.yaw), cos = Math.cos(body.yaw);
  const forwardSpeed = body.vx * sin + body.vz * cos;
  for (const side of [-1, 1]) {
    const rate = (forwardSpeed - body.omega * side * WHEEL_TRACK_HALF) / WHEEL_RADIUS;
    const radians = rate * dt;
    for (const axle of [-1, 1]) {
      const index = (axle > 0 ? 2 : 0) + (side > 0 ? 1 : 0);
      body.wheelAngles[index] = (body.wheelAngles[index] + radians) % (Math.PI * 2);
    }
  }
}
