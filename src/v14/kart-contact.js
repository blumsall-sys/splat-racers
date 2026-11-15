/**
 * Splat Racers v1.6.15 contact geometry: ONE Ammo chassis collider supports
 * each kart on the actual road. Wheels are visual only, not extra rigid bodies.
 * Consistent dimensions here prevent an independent spring from fighting Ammo.
 */
export const KART_CONTACT = Object.freeze({
  chassisHalfWidth: 1.10,
  chassisHalfHeight: 0.43,
  chassisHalfLength: 1.06,
  spawnClearance: 0.05,
  wheelRadius: 0.30,
  wheelMountY: -0.13,
  wheelTrackX: 0.78,
  wheelAxleZ: 0.72,
  wheelGroundClearance: 0.012,
  wheelTravel: 0.38,
  wheelFollowHz: 20
});
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Pure wheel-height calculation, independent of browser/PlayCanvas. */
export function wheelMountHeight(roadY, chassisY, cfg = KART_CONTACT) {
  if (!Number.isFinite(roadY) || !Number.isFinite(chassisY)) return cfg.wheelMountY;
  return clamp(roadY + cfg.wheelRadius + cfg.wheelGroundClearance - chassisY,
    cfg.wheelMountY - cfg.wheelTravel, cfg.wheelMountY + cfg.wheelTravel);
}
export function smoothWheelHeight(previous, target, dt, cfg = KART_CONTACT) {
  if (!Number.isFinite(previous)) return target;
  // When the road rises beneath the tyre, follow immediately to avoid visual
  // penetration. On descents, allow a short cosmetic suspension extension.
  if (target > previous) return target;
  return previous + (target - previous) * (1 - Math.exp(-cfg.wheelFollowHz * clamp(dt, 0, .1)));
}
/** Contact classification only; no upward force is applied to the chassis. */
export function roadProximity(roadY, chassisY, verticalSpeed, cfg = KART_CONTACT) {
  if (![roadY, chassisY, verticalSpeed].every(Number.isFinite)) return false;
  const excess = chassisY - roadY - cfg.chassisHalfHeight;
  return excess >= -.24 && excess < .34 && Math.abs(verticalSpeed) < 3.0;
}
