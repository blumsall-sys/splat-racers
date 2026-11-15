/** Offline inspection: DOES NOT claim browser Ammo contacts are good.
 * Shows the exact mesh names included in the physical collision GLB and the
 * independent guardrail boxes exported as track.json. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {wallProxy,isMarkerName,isRoadMeshName,isWallMeshName} from '../src/v14/collision-policy.js';
import {checkColliderProxies} from '../src/v14/collider-proxies.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assetDir=path.join(root,'assets');
const read=p=>JSON.parse(fs.readFileSync(path.join(assetDir,p),'utf8'));
const pack=read('asset-pack.json'),track=read('track.json');
const proxyInfo=checkColliderProxies(pack.colliders||[]);
if(!pack.staticCollisionGlb){
 if(!pack.colliders?.some(c=>c.bodyType==='static'&&c.drivable))throw new Error('Proxy-only pack requires a drivable static floor collider');
 console.log(`PASS PROXY-ONLY collision: ${proxyInfo.static} static, ${proxyInfo.dynamic} dynamic. Validate contact in browser with ?colliders=1`);
}else{
const glbPath=path.join(assetDir,pack.staticCollisionGlb||'');
if(!pack.staticCollisionGlb || !fs.existsSync(glbPath))throw new Error('Active pack has no staticCollisionGlb');
const buf=fs.readFileSync(glbPath);
if(buf.toString('ascii',0,4)!=='glTF'||buf.readUInt32LE(4)!==2)throw new Error('Invalid GLB header');
const jsonLength=buf.readUInt32LE(12),jsonType=buf.toString('ascii',16,20);
if(jsonType!=='JSON'||jsonLength>buf.length-20)throw new Error('GLB has invalid JSON chunk');
const doc=JSON.parse(buf.toString('utf8',20,20+jsonLength));
const names=(doc.nodes||[]).filter(n=>Number.isInteger(n.mesh)).map(n=>n.name||'(unnamed mesh)');
const road=names.filter(isRoadMeshName),meshWalls=names.filter(isWallMeshName),other=names.filter(n=>!isRoadMeshName(n)&&!isWallMeshName(n));
const proxySpecs=track.collision?.walls||[];
const proxies=proxySpecs.map(wallProxy);
console.log(`Active pack: ${pack.packId}`);
console.log(`Physics GLB: ${pack.staticCollisionGlb}`);
console.log(`Road mesh nodes: ${road.length} — ${road.join(', ')||'NONE'}`);
console.log(`Wall mesh nodes: ${meshWalls.length} — ${meshWalls.join(', ')||'NONE'}`);
console.log(`Other mesh nodes: ${other.length} — ${other.join(', ')||'NONE'}`);
console.log(`Separate guardrail box proxies: ${proxies.length}`);
const heights=proxies.map(p=>p.halfExtents[1]*2);
if(heights.length)console.log(`Guardrail box heights: ${Math.min(...heights).toFixed(2)}–${Math.max(...heights).toFixed(2)} m (runtime minimum 2m)`);
console.log(`Moving props: ${(pack.dynamic||[]).length} — ${(pack.dynamic||[]).map(p=>p.id).join(', ')||'none'}`);
console.log(`Race markers: ${(track.race?.waypoints||[]).length} waypoints, ${(track.race?.gates||[]).length} gates, two spawns; NONE are physical colliders`);
if(names.some(isMarkerName))throw new Error('COLLISION GLB accidentally includes an object named like a race marker');
if(road.length===0)throw new Error('No road-named mesh in collision GLB; inspect in Blender');
if(!proxies.length && !meshWalls.length)throw new Error('No wall collision source in the pack');
console.log('\nPASS: Static GLB structure and wall proxies exist. This does NOT verify contact on the live Ammo scene.');
console.log('Use ?debug=1&colliders=1&walls=boxes&props=off to isolate the guardrails.');

}
