/** Migrate ONLY the user's old asset pack and its referenced files into this
 * current game build. Does not replace JS/HTML, shaders, menus or addons.
 * Run: node scripts/import-existing-pack.mjs "C:\\path\\to\\old-racers"
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assetRelativePath,checkRacePack} from '../src/v14/pack-contract.js';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const old=path.resolve(process.argv.slice(2).join(' ').replace(/^['"]|['"]$/g,''));
if(!process.argv[2]||root===old)throw new Error('Supply a DIFFERENT folder containing your previous game assets (not the new v1.9.0 folder).');
const source=path.join(old,'assets'),target=path.join(root,'assets');
const load=async name=>JSON.parse(await fs.readFile(path.join(source,name),'utf8'));
const pack=await load('asset-pack.json'),track=await load('track.json');
checkRacePack(pack,track);
const refs=[pack.visualGlb,pack.staticCollisionGlb,
 ...(pack.dynamic||[]).map(x=>x.asset),...(pack.vehicles||[]).flatMap(v=>[v.bodyGlb,v.wheelGlb]),
 pack.splat?.sog,pack.splat?.voxel,pack.splat?.voxelBinary,pack.splat?.voxelCollisionGlb].filter(Boolean);
// Preflight every referenced file before touching the new asset pack.
for(const rel of refs){
 assetRelativePath(rel);
 const filename=path.resolve(source,rel);
 if(!filename.startsWith(source+path.sep))throw new Error('Unsafe source path '+rel);
 const stat=await fs.stat(filename);if(!stat.isFile()||stat.size===0)throw new Error('Missing or empty asset: '+filename);
}
const backup=path.join(root,'assets','backups','before-import-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(backup,{recursive:true});
for(const f of ['asset-pack.json','track.json','splat-alignment.json']){
 const dest=path.join(target,f);
 try{await fs.copyFile(dest,path.join(backup,f));}catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const rel of [...new Set(refs)]){
 const dest=path.join(target,rel);await fs.mkdir(path.dirname(dest),{recursive:true});
 await fs.copyFile(path.join(source,rel),dest);
 console.log('Imported',rel);
}
for(const f of ['track.json','splat-alignment.json','asset-pack.json']){
 try{
  const staging=path.join(target,f+'.migrate-staging');
  await fs.copyFile(path.join(source,f),staging);await fs.rename(staging,path.join(target,f));
  console.log('Imported',f);
 }catch(e){if(e.code!=='ENOENT'||f!=='splat-alignment.json')throw e;}
}
console.log('Success. Previous game code was NOT copied. Backup of new sample manifest:',backup);
console.log('For native flight rings (rather than legacy previews), open your Blender scene with add-on 1.4.0, Refresh Flight Rings, then EXPORT Asset Pack to THIS game root.');
