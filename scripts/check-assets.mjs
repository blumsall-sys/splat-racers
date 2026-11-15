import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeGlb} from '../src/assets/glb-loader.js';
import {inspectOptionalVoxelGlb} from './optional-voxel-glb.mjs';
import {validatePack} from '../src/assets/asset-pack.js';
import {validateTrack} from '../src/track/track.js';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const track=validateTrack(JSON.parse(fs.readFileSync(path.join(root,'assets/track.json'),'utf8')));
const pack=validatePack(JSON.parse(fs.readFileSync(path.join(root,'assets/asset-pack.json'),'utf8')));
function check(relative,kind){
 if(!relative)return;
 if(!/^[A-Za-z0-9_\/-]+\.(glb|sog|json|bin)$/.test(relative))throw new Error('Invalid asset path '+relative);
 const dest=path.resolve(root,'assets',relative);
 if(!dest.startsWith(path.join(root,'assets')+path.sep))throw new Error('Unsafe path '+relative);
 if(!fs.existsSync(dest)||!fs.statSync(dest).size)throw new Error('Asset missing: '+relative);
 if(kind==='glb'){
  const primitives=decodeGlb(fs.readFileSync(dest));if(!primitives.length)throw new Error('Empty GLB '+relative);
  console.log('PASS GLB',relative,primitives.length,'primitives');
 }else console.log('PASS',relative,Math.ceil(fs.statSync(dest).size/1024),'KB');
}
check(pack.visualGlb,'glb');check(pack.staticCollisionGlb,'glb');
for(const a of pack.dynamic||[]){
 if(!track.collision.obstacles.some(o=>o.id===a.id))throw new Error('Dynamic mesh ID not found in track: '+a.id);
 check(a.asset,'glb');
}
for(const [key,rel] of Object.entries(pack.splat||{})){
 if(typeof rel!=='string'||!rel.trim())continue;
 if(key==='voxelCollisionGlb'){
  check(rel,'data');
  const summary=inspectOptionalVoxelGlb(path.resolve(root,'assets',rel));
  console.log('PASS OPTIONAL VOXEL GLB',rel,summary.triangles,'triangles (metadata only)');
 }else check(rel,'data');
}
console.log('PASS',pack.packId,':',track.collision.walls.length,'wall proxies,',track.collision.obstacles.length,'dynamic obstacles.');
if(pack.staticCollisionGlb)console.log('NOTICE static collision GLB is exported/staged; arcade runtime uses JSON wall/heightfield proxies.');
if(pack.splat?.sog)console.log('NOTICE splat SOG is staged; separate gsplat renderer required.');
