import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{assetRelativePath,checkRacePack,matrixDecomposeColumnMajor}from '../src/v14/pack-contract.js';
import{driveForces}from '../src/v14/drive-math.js';
const pack=JSON.parse(fs.readFileSync(new URL('./fixtures/sample-asset-pack.json',import.meta.url)));
const track=JSON.parse(fs.readFileSync(new URL('./fixtures/sample-track.json',import.meta.url)));
const activePack=JSON.parse(fs.readFileSync(new URL('../assets/asset-pack.json',import.meta.url)));
const activeTrack=JSON.parse(fs.readFileSync(new URL('../assets/track.json',import.meta.url))); 
test('existing v1.3 pack is accepted unchanged',()=>{const r=checkRacePack(pack,track);assert.equal(r.collisionSource,'staticCollisionGlb');assert.equal(r.dynamicCount,1)});
test('reject missing static mesh (never silently use old proxy collision)',()=>assert.throws(()=>checkRacePack({...pack,staticCollisionGlb:null},track),/staticCollisionGlb/));
test('reject unsafe relative paths',()=>{for(const x of ['/root.glb','../a.glb','a/../b.sog','https://evil','a\\b.glb'])assert.throws(()=>assetRelativePath(x))});
test('Blender SPLAT_ANCHOR column-major matrix preserves translation',()=>{
 const x=matrixDecomposeColumnMajor([1,0,0,0, 0,1,0,0, 0,0,1,0, 2,3,4,1]);assert.deepEqual(x.position,[2,3,4]);assert.deepEqual(x.scale,[1,1,1]);
});
test('reverse key creates a real negative driving force from rest',()=>{
 const f=driveForces({yaw:0,vx:0,vz:0,omega:0,throttle:-1});assert(f.fz<0);
});
test('P1 and NPC turning keep the existing negative yaw convention',()=>{
 const left=driveForces({yaw:0,vx:0,vz:7,omega:0,steer:-1});
 const right=driveForces({yaw:0,vx:0,vz:7,omega:0,steer:1});
 assert(left.torque>0);assert(right.torque<0);
});

test('active Blender asset pack is accepted without assuming sample dynamic count or elevation',()=>{
 const r=checkRacePack(activePack,activeTrack);
 assert.equal(r.collisionSource,'staticCollisionGlb');
 assert.equal(r.dynamicCount,activePack.dynamic?.length||0);
});
