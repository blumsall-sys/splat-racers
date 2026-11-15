import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodeGlb} from '../src/assets/glb-loader.js';
import {roadHeightsAtSpawns,requireSpawnCoverage,transformPoint} from '../src/v14/collision-diagnostics.js';
import {testAmmoRoadAtSpawns,validateAlignment} from '../src/v14/ground-check.js';
const mesh=decodeGlb(fs.readFileSync(new URL('../assets/packs/sample-glb/collision.glb',import.meta.url)));
const track=JSON.parse(fs.readFileSync(new URL('./fixtures/sample-track.json',import.meta.url))); 

test('sample GLB road is under both spawn points at zero metres',()=>{
 const hits=requireSpawnCoverage(mesh,track.spawns);
 for(const id of ['p1','p2']){assert(hits[id]);assert(Math.abs(hits[id].y)<.0001);}
});
test('off-circuit spawn is rejected before an Ammo race starts',()=>{
 assert.equal(roadHeightsAtSpawns(mesh,{p1:{x:30000,z:30000}}).p1,null);
 assert.throws(()=>requireSpawnCoverage(mesh,{p1:{x:30000,z:30000}}),/No driveable/);
});
test('glTF column-major transform correctly applies world scale/translation',()=>{
 assert.deepEqual(transformPoint([2,0,0,0,0,2,0,0,0,0,2,0,7,8,9,1],1,2,3),[9,12,15]);
});
test('Ammo spawn test rejects missing collision instead of silently dropping cars',()=>{
 const p={raycastFirst:()=>null};const Vec3=class{constructor(x,y,z){Object.assign(this,{x,y,z});}};
 assert.throws(()=>testAmmoRoadAtSpawns(p,track.spawns,Vec3),/Cars would fall through/);
});
test('Ammo spawn test samples height and identifies the real collision entity',()=>{
 const p={raycastFirst:(from)=>({point:{y:3.2},normal:{y:1},entity:{name:'ROAD_from_Blender'}})};
 const Vec3=class{constructor(x,y,z){Object.assign(this,{x,y,z});}};
 const r=testAmmoRoadAtSpawns(p,track.spawns,Vec3);assert.equal(r.p1.height,3.2);assert.equal(r.p2.entity,'ROAD_from_Blender');
});
test('SOG alignment defaults to identity and rejects invalid scale and rotation',()=>{
 const parsed=JSON.parse(fs.readFileSync(new URL('./fixtures/sample-splat-alignment.json',import.meta.url)));
 assert.deepEqual(validateAlignment(parsed).position,[0,0,0]);assert.equal(parsed.scale,1);
 assert.throws(()=>validateAlignment({...parsed,scale:0}),/Invalid/);
 assert.throws(()=>validateAlignment({...parsed,rotationEuler:[0,Number.NaN,0]}),/Invalid/);
});
test('Blender exporter explicitly honors the selected splat object and source scale',()=>{
 const py=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/exporter.py',import.meta.url),'utf8');
 assert.match(py,/props\.splat_alignment_object or bpy\.data\.objects\.get\('SOG_PLACEMENT'\)/);
 assert.match(py,/sog_source_is_aligned/);
 assert.match(py,/objectScaleBlender/);
 assert.match(py,/RACE_COLLISION must contain actual road meshes/);
});
test('PlayCanvas collider source uses asset mesh lookup and verifies a real Ammo body',()=>{
 const js=fs.readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
 assert.match(js,/resolveCollisionRenderAsset/);
 assert.match(js,/requireStaticCollider\(entity,renderAsset,meshes\.length\)/);
});

// A custom imported track can legitimately be raised above world origin. The
// immutable sample asset tests must never compare that active track to the
// sample GLB, or incorrectly fail on valid Blender exports.
test('elevated road geometry and matching elevated spawn are accepted',()=>{
 const elevated=mesh.map(m=>({...m,model:(()=>{const a=m.model.slice();a[13]+=8.35;return a;})()}));
 const hits=requireSpawnCoverage(elevated,track.spawns);
 assert.ok(hits.p1.y>8.3&&hits.p2.y>8.3);
});
