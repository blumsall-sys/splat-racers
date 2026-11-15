import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {suspensionForce,isRoadCollider,sampleRoadSupport,applyRoadSupport,RIDE} from '../src/v14/road-support.js';
import {calibrationKey,readStoredCalibration,saveStoredCalibration,clearStoredCalibration} from '../src/v14/sog-calibration-store.js';
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fakeStorage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
test('at ride height suspension exactly balances gravity without changing horizontal velocity',()=>{
 assert(Math.abs(suspensionForce(0,RIDE.rideHeight,0)-RIDE.massKg*9.81)<1e-8);
 assert(suspensionForce(0,RIDE.rideHeight-.10,-2)>RIDE.massKg*9.81);
});
test('off track or far below: zero spring and gravity remains',()=>{
 assert.equal(suspensionForce(0,5,0),0);
 assert.equal(suspensionForce(2,-4,0),0);
});
test('raycast only targets road not wall or other cars; samples slope',()=>{
 assert(isRoadCollider({name:'EXPORTED_GEN_RoadCollision'}));
 assert(isRoadCollider({name:'COL_TrackRoad'}));
 assert(!isRoadCollider({name:'GEN_InnerWall'}));
 assert(!isRoadCollider({name:'p1'}));
 class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}
 const rb={applyForce(...args){this.applied=args},linearVelocity:{y:0}};
 const car={yaw:0,entity:{getPosition:()=>({x:0,y:.68,z:0}),rigidbody:rb}};
 const phys={raycastFirst(start,end,opts){assert(opts.filterCallback({name:'GEN_RoadCollision'}));return {point:{y:start.z>0?.15:0},normal:{y:1}};}};
 const s=applyRoadSupport(phys,car,{Vec3});assert(s?.samples===4);assert(s.grade>0);assert.equal(rb.applied,undefined);assert.equal(car.roadForce,0);assert.equal(car.wheelDiagnostics,undefined);
});
test('wider physical bumper covers wheel radius and yaw-only dynamics retain falling gravity',()=>{
 const source=read('src/v14/pc-scene.js');assert.match(source,/halfExtents:new pc.Vec3\(\.\.\.extents\)/);
 assert.match(source,/angularFactor=new pc.Vec3\(\.25,1,\.25\)/);
 const main=read('src/v14/main.js');assert.match(main,/driveRaycastVehicle\(car,input,dt,pc\)/);
 assert.doesNotMatch(main,/observeKartSteering\(car,dt,pc/);
});
test('browser calibration persists by source SOG name across versioned exports',()=>{
 const a={packId:'my-race-track-20261028-120001-123456',splat:{sourceSogName:'Cleo.sog'}};
 const b={packId:'my-race-track-20261028-120201-123456',splat:{sourceSogName:'Cleo.sog'}};
 assert.equal(calibrationKey(a),calibrationKey(b));
 const store=fakeStorage(),data={position:[0,-20,0],rotationEuler:[-80,0,0],scale:1};
 assert(saveStoredCalibration(a,data,store));assert.deepEqual(readStoredCalibration(b,null,store),data);
 clearStoredCalibration(a,store);assert.deepEqual(readStoredCalibration(b,{hello:1},store),{hello:1});
});
test('exporter keeps previous browser alignment unless explicit reset and has guarded rail operator',()=>{
 const src=read('blender_addon/lab5_splat_packager/__init__.py');
 assert.match(src,/reset_browser_calibration:BoolProperty\([^\n]*default=False/);
 assert.match(src,/LAB5_OT_guardrail_safe/);
 assert.match(src,/guardrail_height=max\(p.guardrail_height,2\.0\)/);
 assert.match(src,/guardrail_thickness=max\(p.guardrail_thickness,\.36\)/);
});
