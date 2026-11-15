// Vite bundles source; this copies *only* referenced Blender assets to deployed dist.
import fs from 'node:fs/promises';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetRelativePath,checkRacePack} from '../src/v14/pack-contract.js';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const read=async p=>JSON.parse(await fs.readFile(path.join(root,'assets',p),'utf8'));
const pack=await read('asset-pack.json'),track=await read('track.json');checkRacePack(pack,track);
const rels=['asset-pack.json','track.json','splat-alignment.json',pack.visualGlb,pack.staticCollisionGlb,...(pack.dynamic||[]).map(x=>x.asset),...(pack.vehicles||[]).flatMap(v=>[v.bodyGlb,v.wheelGlb]),pack.splat?.sog].filter(Boolean);
for(const rel of [...new Set(rels)]){
 assetRelativePath(rel);
 const source=path.resolve(root,'assets',rel),dest=path.resolve(root,'dist/assets',rel);
 if(!source.startsWith(path.resolve(root,'assets')+path.sep))throw new Error('Unsafe path '+rel);
 await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(source,dest);
 console.log('Packaged',rel);
}
for(const file of ['ammo.wasm.js','ammo.wasm.wasm','ammo.js']){
 const src=path.join(root,'public/ammo',file);await fs.access(src).catch(()=>{throw new Error('Missing '+file+'; run npm run setup:ammo before building');});
}
await fs.writeFile(path.join(root,'dist','.nojekyll'),'');
console.log('Blender asset bundle copied to dist.');
