import {isRoadCollider} from './road-support.js';
/** Validate the *active Ammo world* before letting cars spawn.
 * A GLB can contain faces and still be completely outside the driving surface. */
export function testAmmoRoadAtSpawns(physicsSystem,spawns,Vec3){
 const hits={};
 for(const id of ['p1','p2']){
  const p=spawns[id];
  const from=new Vec3(p.x,(p.y??0)+80,p.z);
  const to=new Vec3(p.x,(p.y??0)-120,p.z);
  const hit=physicsSystem.raycastFirst(from,to,{filterCallback:isRoadCollider});
  if(!hit||!hit.point||!Number.isFinite(hit.point.y))throw new Error(`No Ammo mesh contact beneath ${id} at x=${p.x.toFixed(2)}, z=${p.z.toFixed(2)}. Cars would fall through the floor. Check that RACE_COLLISION contains the road (not only walls), collision.glb is placed correctly, and the importer's render assets produced real btTriangleMesh shapes.`);
  if(hit.normal?.y!==undefined&&hit.normal.y<.4)throw new Error(`Ammo contact under ${id} has wall-like/downward normal (normal.y=${hit.normal.y.toFixed(2)}), not a road. Flip normals or check road mesh and spawn.`);
  hits[id]={height:hit.point.y,entity:hit.entity?.name||'unknown'};
 }
 return hits;
}
export function validateAlignment(cfg){
 const n=v=>typeof v==='number'&&Number.isFinite(v);
 if(!cfg||!Array.isArray(cfg.position)||cfg.position.length!==3||!cfg.position.every(n)||!Array.isArray(cfg.rotationEuler)||cfg.rotationEuler.length!==3||!cfg.rotationEuler.every(n)||!n(cfg.scale)||cfg.scale<=0||cfg.scale>10000)throw new Error('Invalid assets/splat-alignment.json. Expected position [x,y,z], rotationEuler [pitch,yaw,roll] and positive uniform scale.');
 return cfg;
}
