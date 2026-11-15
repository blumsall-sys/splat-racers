/** Non-destructive collision ownership rules for the Blender GLB runtime.
 * Race markers are JSON-only and must NEVER create an Ammo body.
 * Road stays a static triangle mesh; guardrails use EITHER mesh OR static boxes.
 */
export function isWallMeshName(name) {
  return /(?:wall|guardrail|barrier|fence|railing)/i.test(String(name||''));
}
export function isRoadMeshName(name) {
  return /(?:road|tarmac|floor|ground|trackroad|track_surface)/i.test(String(name||'')) && !isWallMeshName(name);
}
export function chooseWallMode(search, track) {
  const requested = new URLSearchParams(search || '').get('walls');
  if(requested === 'mesh' || requested === 'boxes' || requested === 'off') return requested;
  return (track?.collision?.walls?.length > 0) ? 'boxes' : 'mesh';
}
/** The Blender packager stores box center Y plus its authored height.
 * On old packs with low guardrails, raise the upper edge without shifting
 * the base into the road. Widen slightly to remove visible wheel leakage.
 */
export function wallProxy(w) {
  if(!w || ![w.x,w.z,w.hx,w.hz].every(Number.isFinite) || w.hx<=0 || w.hz<=0)
    throw new Error('Invalid exported wall box '+(w?.id||'unknown'));
  const authoredHeight = Number.isFinite(w.height) && w.height > 0 ? w.height : 1.6;
  const floorY = Number.isFinite(w.y) ? w.y - authoredHeight/2 : 0;
  const height = Math.max(2.0, authoredHeight);
  const thickness = Math.max(w.hx, 0.22);
  return {
    id:String(w.id||'wall'),
    position:[w.x, floorY+height/2, w.z],
    yawRadians:Number.isFinite(w.yaw)?w.yaw:0,
    halfExtents:[thickness, height/2, w.hz + 0.06],
    originalHeight:authoredHeight
  };
}
export function collisionObjectName(result) {
  return result?.other?.name || result?.other?.entity?.name || 'unknown contact';
}
export function isMarkerName(name) {
  return /^(?:WP_\d+|SPAWN_P[12]|GATE_(?:START|\d+)(?:_[AB])?)$/i.test(String(name||''));
}
