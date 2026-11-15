import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import{checkRacePack,assetRelativePath}from '../src/v14/pack-contract.js';
const target=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const sourceArg=process.argv[2];if(!sourceArg)throw new Error('Supply your exported v1.3 game directory, e.g. node scripts/import-v13-assets.mjs "D:\\Splat Racers\\v7\\Splat_Racers_Modular_v1_3"');
const source=path.resolve(sourceArg),src=path.join(source,'assets'),dst=path.join(target,'assets');
const pack=JSON.parse(await fs.readFile(path.join(src,'asset-pack.json'),'utf8'));
const track=JSON.parse(await fs.readFile(path.join(src,'track.json'),'utf8'));checkRacePack(pack,track);
const files=['asset-pack.json','track.json',pack.visualGlb,pack.staticCollisionGlb,...(pack.dynamic||[]).map(x=>x.asset),...Object.values(pack.splat||{}).filter(x=>typeof x==='string'&&/\.(sog|glb|json|bin)$/i.test(x))].filter(Boolean);
// Preserve exported/one-time calibrated SOG offsets when the source has them.
try { await fs.access(path.join(src,'splat-alignment.json')); files.push('splat-alignment.json'); } catch {}
for(const rel of [...new Set(files)]){assetRelativePath(rel);await fs.access(path.join(src,rel));}
const backup=path.join(target,'assets-previous-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(backup,{recursive:true});
for(const name of ['asset-pack.json','track.json','splat-alignment.json']){try{await fs.copyFile(path.join(dst,name),path.join(backup,name));}catch{}}
for(const rel of [...new Set(files)]){const dest=path.join(dst,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(src,rel),dest);console.log('Imported',rel);}
console.log('Now run npm.cmd run assets:check and npm.cmd run dev; game logic unchanged.');
