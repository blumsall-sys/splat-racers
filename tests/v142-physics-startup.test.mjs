import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {requirePhysicsBackend,requireStaticCollider} from '../src/v14/physics-startup-guard.js';

test('physics backend remains absent before PlayCanvas start: fail with specific error',()=>{
 const app={systems:{rigidbody:{physicsWorld:null}}};
 assert.throws(()=>requirePhysicsBackend(app),/app\.start\(\).*before collider creation/);
});
test('backend becomes available after start (mocked PlayCanvas lifecycle)',()=>{
 const app={systems:{rigidbody:{physicsWorld:null}},start(){this.systems.rigidbody.physicsWorld={raycastFirst(){}};}};
 app.start();
 assert.equal(requirePhysicsBackend(app),app.systems.rigidbody.physicsWorld);
});
test('missing mesh shape and missing rigidbody report separate diagnostics',()=>{
 const bad={name:'COL_TrackRoad',collision:{shape:null},rigidbody:{body:null}};
 assert.throws(()=>requireStaticCollider(bad,{name:'COL_TrackRoad'},1),/mesh shape: MISSING, rigidbody: MISSING/);
 bad.collision.shape={};
 assert.throws(()=>requireStaticCollider(bad,{name:'COL_TrackRoad'},1),/mesh shape: ready, rigidbody: MISSING/);
 bad.rigidbody.body={};
 assert.equal(requireStaticCollider(bad,{name:'COL_TrackRoad'},1),undefined);
});
test('actual runtime starts PlayCanvas once, ahead of all physics asset loads',()=>{
 const src=fs.readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
 const positions=[src.indexOf('app.start();'),src.indexOf('requirePhysicsBackend(app);'),src.indexOf('geometry=await addPackGeometry('),src.indexOf('props=await addDynamicObjects('),src.indexOf('roadHits=testAmmoRoadAtSpawns(')];
 assert(positions.every(n=>n>=0));
 assert(positions.every((n,i)=>i===0||positions[i-1]<n),`Incorrect physics start order: ${positions}`);
 assert.equal(src.match(/^\s*app\.start\(\);/gm)?.length,1);
});
