import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectOptionalVoxelGlb} from '../scripts/optional-voxel-glb.mjs';
const u32=(n)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
function createSparseGlb(dest,indexCount){
 const binBytes=36+indexCount*4;
 const doc={asset:{version:'2.0'},buffers:[{byteLength:binBytes}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:indexCount*4}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5125,count:indexCount,type:'SCALAR'}],meshes:[{name:'DenseVoxel',primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 const raw=Buffer.from(JSON.stringify(doc));const json=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
 const total=12+8+json.length+8+binBytes;
 const fd=fs.openSync(dest,'w+');
 try{
  fs.writeSync(fd,Buffer.concat([u32(0x46546c67),u32(2),u32(total),u32(json.length),u32(0x4e4f534a),json,u32(binBytes),u32(0x004e4942)]),0,undefined,0);
  fs.ftruncateSync(fd,total);
 }finally{fs.closeSync(fd);}
}

test('optional voxel reader uses GLB metadata for existing Blender export',()=>{
 const file=new URL('../assets/packs/sample-glb/collision.glb',import.meta.url);
 const info=inspectOptionalVoxelGlb(file);
 assert.ok(info.meshCount>0&&info.triangles>0);assert.equal(info.metadataOnly,true);
});

test('optional voxel reader accepts over three million indices without expanding them',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'splat-voxel-test-'));
 try{
  const file=path.join(dir,'dense.collision.glb');createSparseGlb(file,3_000_003);
  const info=inspectOptionalVoxelGlb(file);
  assert.equal(info.triangles,1_000_001);
  assert.equal(info.primitives,1);
  assert.equal(info.metadataOnly,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('optional voxel reader refuses corrupt files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'splat-voxel-test-'));
 try{
  const file=path.join(dir,'invalid.glb');fs.writeFileSync(file,Buffer.alloc(24));
  assert.throws(()=>inspectOptionalVoxelGlb(file),/Optional voxel GLB: bad magic/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
