import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {matrixDecomposeColumnMajor} from '../src/v14/pack-contract.js';
import {applySogAnchorTransform} from '../src/v14/sog-transform.js';

function matrixFromTRS(angle, sx, sy, sz, tx, ty, tz){
 const c=Math.cos(angle),s=Math.sin(angle);
 return [c*sx,0,-s*sx,0, 0,sy,0,0, s*sz,0,c*sz,0, tx,ty,tz,1];
}
function recompose(dec){
 const a=dec.rotationMatrix;
 const out=a.map((v,i)=>v);
 for(let col=0;col<3;col++)for(let row=0;row<3;row++)out[4*col+row]*=dec.scale[col];
 out[12]=dec.position[0];out[13]=dec.position[1];out[14]=dec.position[2];
 return out;
}
function closeArray(a,b,eps=1e-7){
 assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<eps,`component ${i}: ${a[i]} != ${b[i]}`);
}

test('identity and no optional anchor are safe',()=>{
 assert.equal(matrixDecomposeColumnMajor(null),null);
 const id=matrixDecomposeColumnMajor([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 assert.deepEqual(id.position,[0,0,0]);assert.deepEqual(id.scale,[1,1,1]);
 assert.deepEqual(id.rotationMatrix,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
});
test('rotation, non-uniform scale and translation are decomposed separately',()=>{
 const matrix=matrixFromTRS(Math.PI/3,2,3,4,10,5,-7);
 const parts=matrixDecomposeColumnMajor(matrix);
 closeArray(recompose(parts),matrix);
 assert.deepEqual(parts.position,[10,5,-7]);
 assert.deepEqual(parts.scale,[2,3,4]);
});
test('mirrored Blender transform remains reproducible with signed scale',()=>{
 const matrix=matrixFromTRS(-Math.PI/4,-1.5,1.75,2.5,-2,8,5);
 const parts=matrixDecomposeColumnMajor(matrix);
 closeArray(recompose(parts),matrix);
 assert.equal(parts.scale.filter(n=>n<0).length,1);
});
test('reject shear and perspective instead of silently distorting a SOG',()=>{
 const affine=matrixFromTRS(0,1,1,1,0,0,0);
 const sheared=[...affine];sheared[4]=.5;
 assert.throws(()=>matrixDecomposeColumnMajor(sheared),/shear/);
 const perspective=[...affine];perspective[3]=.2;
 assert.throws(()=>matrixDecomposeColumnMajor(perspective),/perspective/);
});
test('SOG applies transform using Quat.setFromMat4 with a Mat4 missing getRotation',()=>{
 const calls=[];
 const pc={
  Mat4:class{constructor(){this.data=new Float32Array(16)}},
  Quat:class{setFromMat4(m){calls.push(['quat',Array.from(m.data)]);return this}}
 };
 const entity={setLocalPosition:(...v)=>calls.push(['pos',v]),setLocalRotation:()=>calls.push(['rot']),setLocalScale:(...v)=>calls.push(['scale',v])};
 assert.equal(applySogAnchorTransform(entity,matrixFromTRS(.6,2,3,4,1,2,3),pc),true);
 assert.deepEqual(calls.map(c=>c[0]),['quat','pos','rot','scale']);
 assert.deepEqual(calls.at(-1)[1],[2,3,4]);
 // this test would fail with the old m.getRotation() call.
 assert.equal(applySogAnchorTransform(entity,null,pc),false);
});
test('render-path SOG anchor uses tested helper rather than invalid Mat4.getRotation',()=>{
 const src=fs.readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
 assert.match(src,/applySogAnchorTransform\(splat,pack\.splat\.anchorMatrixColumnMajor,pc\)/);
 assert.doesNotMatch(src,/\.getRotation\(/);
});
