// Reviewed voxel->box collision adapter. Do not attach unreviewed splat voxels automatically.
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateTrack} from '../src/track/track.js';
const params=process.argv.slice(2);
const arg=(name)=>{const i=params.indexOf(name);return i>=0?params[i+1]:null};
const base=process.cwd();
const input=arg('--track')||'assets/track.json',overlay=arg('--overlay'),out=arg('--out');
if(!overlay||!out)throw new Error('Usage: node scripts/merge-voxel-overlay.mjs --track assets/track.json --overlay voxel-wall-overlay.json --out assets/track-voxel.json');
const t=validateTrack(JSON.parse(await fs.readFile(input,'utf8')));
const vo=JSON.parse(await fs.readFile(overlay,'utf8'));
if(vo.version!==1||!Array.isArray(vo.walls)||vo.walls.length>2000||vo.walls.some(w=>!w.id?.startsWith('VOX_')))throw new Error('Invalid overlay: expected reviewed VOX_ wall boxes');
t.collision.walls=t.collision.walls.filter(w=>!w.id.startsWith('VOX_')).concat(vo.walls);
validateTrack(t);
await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(t,null,2)+'\n');
console.log(`Created ${out} with ${vo.walls.length} additional voxel-derived 2.5D proxy walls.`);
console.log('REVIEW visually in browser before adopting; splat-derived mesh is not a native Bullet/Ammo collider in this engine.');
