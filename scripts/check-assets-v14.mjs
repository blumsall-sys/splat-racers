// Verify the actual Blender pack intended for real Ammo static mesh collision.
import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{decodeGlb}from '../src/assets/glb-loader.js';
import{inspectRoadTriangles,roadQualityWarnings}from './check-road-quality.mjs';
import{inspectOptionalVoxelGlb}from './optional-voxel-glb.mjs';
import{assetRelativePath,checkRacePack}from '../src/v14/pack-contract.js';
import{validateTrack}from '../src/track/track.js';
import{requireSpawnCoverage}from '../src/v14/collision-diagnostics.js';
import{verifyActiveSog}from './check-sog-pack.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const track=validateTrack(JSON.parse(fs.readFileSync(path.join(root,'assets/track.json'),'utf8')));
const pack=JSON.parse(fs.readFileSync(path.join(root,'assets/asset-pack.json'),'utf8'));
const result=checkRacePack(pack,track);
let tris=0;let staticMeshes=[];
function inspect(p,glb){
 assetRelativePath(p);
 const full=path.resolve(root,'assets',p);
 if(!full.startsWith(path.join(root,'assets')+path.sep))throw new Error('Unsafe path '+p);
 const st=fs.statSync(full);if(!st.size)throw new Error('Empty asset: '+p);
 if(glb){const meshes=decodeGlb(fs.readFileSync(full));if(!meshes.length)throw new Error('GLB has no triangle meshes: '+p);
  const t=meshes.reduce((a,m)=>a+m.vertices.length/18,0);tris+=t;
  if(p===pack.staticCollisionGlb)staticMeshes=meshes;
  console.log('PASS GLB',p,meshes.length,'mesh primitives',t,'triangles');
 }else console.log('PASS FILE',p,Math.round(st.size/1024),'KiB');
}
if(pack.visualGlb)inspect(pack.visualGlb,true);
if(pack.staticCollisionGlb)inspect(pack.staticCollisionGlb,true);
const quality=inspectRoadTriangles(staticMeshes);
if(pack.staticCollisionGlb){
 console.log('ROAD GEOMETRY:',quality.triangles,'triangles,',quality.upward,'upward,',quality.degenerate,'degenerate,',quality.coarse,'coarse faces');
 for(const warning of roadQualityWarnings(quality))console.warn('ROAD ADVISORY:',warning);
}else console.log('ROAD COLLISION: JSON primitive proxies; GLB road quality test not applicable.');
if(pack.staticCollisionGlb){const surfaces=requireSpawnCoverage(staticMeshes,track.spawns);
for(const [id,hit] of Object.entries(surfaces))console.log('PASS ROAD UNDER',id,'height',hit.y.toFixed(3),'m, mesh',hit.mesh);}
else console.log('PROXY-ONLY GROUND: physical coverage is verified at browser startup by Ammo raycasts.');
for(const item of pack.dynamic||[])inspect(item.asset,true);
for(const vehicle of pack.vehicles||[]){
 inspect(vehicle.bodyGlb,true);
 if(vehicle.wheelGlb)inspect(vehicle.wheelGlb,true);
}
if(pack.splat?.sog)inspect(pack.splat.sog,false);
await verifyActiveSog(root,pack);
if(pack.splat?.voxelCollisionGlb){
 const rel=assetRelativePath(pack.splat.voxelCollisionGlb);
 const full=path.resolve(root,'assets',rel);
 if(!full.startsWith(path.join(root,'assets')+path.sep))throw new Error('Unsafe path '+rel);
 const summary=inspectOptionalVoxelGlb(full);
 console.log('PASS OPTIONAL VOXEL GLB',rel,summary.meshCount,'meshes',summary.triangles,'triangles',Math.round(summary.bytes/1048576),'MiB (metadata only; NOT used as Ammo road)');
}
console.log('NOTE: staticCollisionGlb and/or primitive colliders supply physics; optional voxel GLB is not auto-loaded into Ammo.');
console.log('PASS PACK',pack.packId,'| colliders:',pack.staticCollisionGlb?'GLB static triangle mesh + JSON primitives':'JSON static/dynamic primitives','| SOG:',result.hasSog,'| total referenced triangles:',tris);
if(!pack.splat?.sog)console.log('NOTE: no SOG in this sample. Import your already-working exported pack with npm run import:previous -- "C:\\path\\to\\old-game" OR re-export your Blender scene with the new add-on.');
