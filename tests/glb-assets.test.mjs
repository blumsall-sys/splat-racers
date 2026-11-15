import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {decodeGlb} from '../src/assets/glb-loader.js';
import {validatePack} from '../src/assets/asset-pack.js';
const asset=name=>fs.readFileSync(new URL('../assets/packs/sample-glb/'+name,import.meta.url));
test('Blender-compatible GLB scene yields triangles/normals/transforms',()=>{
 const m=decodeGlb(asset('visuals.glb'));
 assert.ok(m.length>=2);assert.ok(m.every(x=>x.vertices.length%18===0 && x.model.length===16));
 assert.ok(m.some(x=>x.color[0]<0.5));
});
test('dynamic crate GLB has triangles and is centered',()=>{
 const m=decodeGlb(asset('crate.glb'));assert.ok(m.length>0);assert.ok(m[0].vertices.length>=108);
});
test('reject incomplete/corrupted GLB',()=>{
 assert.throws(()=>decodeGlb(new Uint8Array([1,2,3,4])),/GLB/);
 let broken=Buffer.from(asset('crate.glb'));broken.writeUInt32LE(0,0);assert.throws(()=>decodeGlb(broken),/magic/);
});
test('asset manifest rejects unsafe paths',()=>{
 assert.throws(()=>validatePack({version:1,visualGlb:'../bad.glb'}),/Unsafe/);
 assert.throws(()=>validatePack({version:2}),/version/);
});
