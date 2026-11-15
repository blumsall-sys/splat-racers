/** v1.4.2: smoke-check actual PlayCanvas Ammo installation and collider creation.
 * Dependency-free to allow regression tests without PlayCanvas/WebGL. */
export function requirePhysicsBackend(app) {
 const world=app?.systems?.rigidbody?.physicsWorld;
 if (!world) {
  throw new Error('Ammo physics backend was not installed at PlayCanvas startup. Check public/ammo, reload, and confirm that app.start() was called before collider creation.');
 }
 return world;
}
export function requireStaticCollider(entity, renderAsset, meshCount) {
 const shapeReady=Boolean(entity?.collision?.shape);
 const bodyReady=Boolean(entity?.rigidbody?.body);
 if (!shapeReady || !bodyReady) {
  throw new Error(`Static collider ${entity?.name||'unnamed'} failed (mesh shape: ${shapeReady?'ready':'MISSING'}, rigidbody: ${bodyReady?'ready':'MISSING'}, meshes: ${meshCount}, asset: ${renderAsset?.name||'unnamed'}). Open Chrome Console for preceding PlayCanvas/Ammo messages.`);
 }
}
