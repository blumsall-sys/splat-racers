import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {calibrationKey,readStoredCalibration} from '../src/v14/sog-calibration-store.js';
import {checkRacePack} from '../src/v14/pack-contract.js';
import {inspectSogArchive,verifyActiveSog,fileSha256} from '../scripts/check-sog-pack.mjs';
import {readFileSync} from 'node:fs';
const source=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tinyZip=(files)=>{
 const chunks=[],centers=[];let offset=0;
 for(const [name,payload] of Object.entries(files)){
  const nameBuf=Buffer.from(name),raw=Buffer.from(payload),compressed=deflateRawSync(raw);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(nameBuf.length,26);
  chunks.push(h,nameBuf,compressed);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(nameBuf.length,28);c.writeUInt32LE(offset,42);
  centers.push(c,nameBuf);offset+=h.length+nameBuf.length+compressed.length;
 }
 const centerSize=centers.reduce((n,b)=>n+b.length,0),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(Object.keys(files).length,8);e.writeUInt16LE(Object.keys(files).length,10);e.writeUInt32LE(centerSize,12);e.writeUInt32LE(offset,16);
 return Buffer.concat([...chunks,...centers,e]);
};
const fakeSog=(missingTexture=false)=>tinyZip({
 'meta.json':JSON.stringify({version:2,count:43,means:{files:['means_l.webp','means_u.webp']},scales:{files:['scales.webp']},quats:{files:['quats.webp']},sh0:{files:['sh0.webp']}}),
 'means_l.webp':'1','means_u.webp':'2','scales.webp':'3','quats.webp':'4',...(missingTexture?{}:{'sh0.webp':'5'})
});
const identity=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
test('SOG inspect reads bundled ZIP meta.json and referenced texture list',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'sog-'));try{
  const file=path.join(tmp,'test.sog');await writeFile(file,fakeSog());
  const result=await inspectSogArchive(file);assert.equal(result.gaussians,43);assert.equal(result.textures,5);
  await writeFile(file,fakeSog(true));await assert.rejects(()=>inspectSogArchive(file),/missing texture/);
  await writeFile(file,Buffer.from('not sog'));await assert.rejects(()=>inspectSogArchive(file),/not a bundled|too small/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
test('active SOG integrity compares SHA256 and file size with Blender manifest',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'sog-project-'));try{
  const dir=path.join(root,'assets','packs','test');await mkdir(dir,{recursive:true});
  const filename=path.join(dir,'track.sog');await writeFile(filename,fakeSog());
  const hash=await fileSha256(filename),size=(await import('node:fs/promises')).stat(filename).then(s=>s.size);
  const pack={splat:{sog:'packs/test/track.sog',sogSha256:hash,sogBytes:await size,anchorMatrixColumnMajor:identity,sourceSogName:'test.sog'}};
  const result=await verifyActiveSog(root,pack);assert.equal(result.configured,true);
  await assert.rejects(()=>verifyActiveSog(root,{splat:{...pack.splat,sogSha256:'0'.repeat(64)}}),/SHA256 MISMATCH/);
  await assert.rejects(()=>verifyActiveSog(root,{splat:{...pack.splat,sogBytes:5}}),/SIZE MISMATCH/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('browser calibration persists for identical SOG bytes and Blender anchor',()=>{
 const pack={packId:'track-abc',splat:{sourceSogName:'same.sog',sog:'packs/one/track.sog',sogSha256:'a'.repeat(64),anchorMatrixColumnMajor:identity}};
 const next={...pack,packId:'track-def',splat:{...pack.splat,sog:'packs/two/track.sog'}};
 assert.equal(calibrationKey(pack),calibrationKey(next));
 assert.notEqual(calibrationKey(next),calibrationKey({...next,splat:{...next.splat,sogSha256:'b'.repeat(64)}}));
 assert.notEqual(calibrationKey(next),calibrationKey({...next,splat:{...next.splat,anchorMatrixColumnMajor:identity.map((v,i)=>i===12?5:v)}}));
 assert.notEqual(calibrationKey(next),calibrationKey({...next,splat:{...next.splat,calibrationRevision:1}}));
 const storage={getItem(key){return key===calibrationKey(pack)?JSON.stringify({position:[1,2,3],rotationEuler:[0,0,180],scale:1}):null;}};
 assert.equal(readStoredCalibration(next,null,storage).position[0],1);
 assert.equal(readStoredCalibration({...next,splat:{...next.splat,sogSha256:'b'.repeat(64)}},'fallback',storage),'fallback');
});
test('partial Blender manifest rewrite is rejected if active pack and track revisions differ',()=>{
 const track={version:1,assetPackId:'new-export',race:{waypoints:[{}, {}, {}],gates:[{},{}]},spawns:{p1:{x:0,z:0},p2:{x:1,z:1}},collision:{obstacles:[]}};
 const pack={version:1,packId:'old-export',staticCollisionGlb:'packs/example/collision.glb',dynamic:[]};
 assert.throws(()=>checkRacePack(pack,track),/Incomplete Blender export/);
 assert.doesNotThrow(()=>checkRacePack({...pack,packId:'new-export'},track));
});
test('Blender export refuses accidental SOG removal and stamps digest',()=>{
 const src=source('blender_addon/lab5_splat_packager/exporter.py');
 assert.match(src,/previous_sog and not props\.sog_file and not props\.allow_clear_sog/);
 assert.match(src,/splat\['sogSha256'\]=_sha256_file\(sog_path\)/);
 assert.match(src,/changed_sog/);
 assert.match(src,/files\.append\(\('asset-pack\.json',pack\)\)  # COMMIT LAST/);
});
test('legacy browser alignment migrates only after unchanged SOG content and placement was verified by Blender',()=>{
 const name='Cleo.sog';const pack={packId:'next',splat:{sog:'packs/new/track.sog',sogSha256:'b'.repeat(64),sourceSogName:name,migrateLegacyCalibration:true}};
 const values={position:[5,0,0],rotationEuler:[0,0,0],scale:1};const cache=new Map([['LAB5:SOG_ALIGNMENT:v1:'+name,JSON.stringify(values)]]);
 const storage={getItem:key=>cache.get(key)||null,setItem:(key,v)=>cache.set(key,v)};
 assert.equal(readStoredCalibration(pack,null,storage).position[0],5);
 assert.ok(cache.has(calibrationKey(pack)));
 assert.equal(readStoredCalibration({...pack,splat:{...pack.splat,migrateLegacyCalibration:false,sogSha256:'c'.repeat(64)}},'none',storage),'none');
});
test('Blender includes a read-only SOG preflight button without touching drive controls',()=>{
 const addon=source('blender_addon/lab5_splat_packager/__init__.py');
 assert.match(addon,/class LAB5_OT_check_sog_link/);
 assert.match(addon,/layout\.operator\('lab5_race\.check_sog_link'/);
 assert.match(addon,/_verify_bundled_sog\(source\)/);
});
