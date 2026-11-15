// Optional external data preparation, does not change runtime or Blender addons.
// Needs `npm install -g @playcanvas/splat-transform` and WebGPU for collision generation.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),at=(s)=>{const i=args.indexOf(s);return i<0?null:args[i+1]};
const ply=at('--ply'),dest=at('--out')||'assets/splats';
if(!ply||!fs.existsSync(ply)||!ply.toLowerCase().endsWith('.ply'))throw new Error('Usage: npm run splat:prepare -- --ply path/to/edited.ply --out assets/splats');
fs.mkdirSync(dest,{recursive:true});
const run=(...cmd)=>{
 const binary=process.platform==='win32'?'splat-transform.cmd':'splat-transform';
 const r=spawnSync(binary,cmd,{stdio:'inherit',shell:process.platform==='win32'});
 if(r.error||r.status!==0)throw new Error('splat-transform failed; ensure the CLI is installed and WebGPU available. '+(r.error?.message||r.status));
};
const sog=path.join(dest,'track.sog'),voxel=path.join(dest,'track.voxel.json');
if(fs.existsSync(sog)||fs.existsSync(voxel))throw new Error('Output exists: use a clean folder to avoid accidental replacement.');
run(ply,sog);
run(ply,voxel,'--voxel-size','0.20','--voxel-opacity','0.2','--voxel-floor-fill','--collision-mesh','smooth');
for(const file of [sog,voxel,voxel.replace('.voxel.json','.voxel.bin'),voxel.replace('.voxel.json','.collision.glb')]){
 if(!fs.existsSync(file)||fs.statSync(file).size===0)throw new Error('Missing output '+file);
 console.log(file,Math.round(fs.statSync(file).size/1024),'KiB');
}
console.log('IMPORTANT: SOG renderer not included in standalone v1.2. Collision GLB requires a reviewed Blender proxy conversion.');
