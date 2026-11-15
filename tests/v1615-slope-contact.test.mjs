import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectForceToRoad,preserveAngularSlopeAxes} from '../src/v14/slope-vehicle.js';
import {sampleRoadSupport,updateWheelContacts} from '../src/v14/road-support.js';
import {KART_CONTACT} from '../src/v14/kart-contact.js';
import {kartControlStep,emptyDrift,KART_TUNING} from '../src/v16/kart64.js';
const source=fs.readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
const driving=fs.readFileSync(new URL('../src/v16/kart64.js',import.meta.url),'utf8');
class Vec3 {constructor(x,y,z){Object.assign(this,{x,y,z})}}
test('physics body can pitch and roll to meet graded road, steering preserves both axes',()=>{
 assert.match(source,/angularFactor=new pc\.Vec3\(\.25,1,\.25\)/);
 assert.match(driving,/preserveAngularSlopeAxes\(rot,state\.commandedYaw\)/);
 assert.deepEqual(preserveAngularSlopeAxes({x:.3,y:6,z:-.4},-.6),{x:.3,y:-.6,z:-.4});
 assert.equal(preserveAngularSlopeAxes({x:Infinity,z:-50},.1).z,-3.5);
});
test('road tangent is not forced down into inclined surface and still produces gravity uphill',()=>{
 const a=projectForceToRoad(0,1500,{x:0,y:1,z:0},true);
 assert.equal(a.x,0);assert(Math.abs(a.y)<1e-10);assert.equal(a.z,1500);
 const slope=.3;const up={x:0,y:1/Math.hypot(1,slope),z:-slope/Math.hypot(1,slope)};
 const b=projectForceToRoad(0,1500,up,true);
 assert(Math.abs(b.y-450)<1e-8);assert(Math.abs(up.y*b.y+up.z*b.z)<1e-7);
 const airborne=projectForceToRoad(0,1500,up,false);
 assert.equal(airborne.y,0);assert.equal(airborne.z,180);
});
test('steering side grip bounded, so contact solver can separate vehicles',()=>{
 assert(KART_TUNING.normalGrip<5);
 let max=0;
 for(const speed of [0,2,6,12,20]){
  const s=kartControlStep({yaw:0,omega:0,vx:10,vz:speed},{throttle:1,steer:0,drift:false},emptyDrift(),1/60);
  max=Math.max(max,Math.abs(s.fx));assert(Number.isFinite(s.fz));
 }
 assert(max<=170*13+1e-6,`side force ${max}`);
});
test('sample probes follow actual pitched body world transform rather than assumed flat yaw',()=>{
 // An inclined transform moves the front probe +0.2 up, the rear -0.2.
 // The x/z offsets remain unchanged in this deliberately simple test matrix.
 const m=[1,0,0,0, 0,1,0,0, 0,.2778,1,0, 0,0,0,1];
 const wheels=[];for(const front of [false,true])for(const side of [-1,1])wheels.push({front,side,mountY:KART_CONTACT.wheelMountY,mount:{setLocalPosition(...xyz){this.xyz=xyz;}}});
 const car={yaw:0,wheels,entity:{getPosition:()=>({x:0,y:0,z:0}),getWorldTransform:()=>({data:m})}};
 const physics={raycastFirst(a,b,opt){return {point:{y:a.z*.15},normal:{x:0,y:1,z:-.15}};}};
 const data=sampleRoadSupport(physics,car,Vec3);
 assert.equal(data.hits.length,4);assert(data.grade>.1);
 updateWheelContacts(car,data,1/60);
 assert.equal(car.wheelDiagnostics.probes,4);
});
test('wheel height solves world-space banked mount position without clipping',()=>{
 const angle=.18;
 // Local X contributes +sin(tilt) to world Y for banked road; local Y contributes cos.
 const m=[Math.cos(angle),Math.sin(angle),0,0,-Math.sin(angle),Math.cos(angle),0,0,0,0,1,0,0,KART_CONTACT.chassisHalfHeight,0,1];
 const wheels=[];for(const front of [false,true])for(const side of [-1,1])wheels.push({front,side,mountY:KART_CONTACT.wheelMountY,mount:{setLocalPosition(...xyz){this.xyz=xyz;}}});
 const car={wheels,entity:{getPosition:()=>({x:0,y:KART_CONTACT.chassisHalfHeight,z:0}),getWorldTransform:()=>({data:m})}};
 const hits=wheels.map(w=>({front:w.front?KART_CONTACT.wheelAxleZ:-KART_CONTACT.wheelAxleZ,side:w.side,height:w.side*KART_CONTACT.wheelTrackX*Math.tan(angle)}));
 updateWheelContacts(car,{hits},1/60);
 for(const w of wheels){
  const worldWheelY=m[13]+m[1]*w.side*KART_CONTACT.wheelTrackX+m[5]*w.mount.xyz[1];
  const target=hits.find(h=>h.side===w.side && (h.front>0)===w.front);
  assert(Math.abs(worldWheelY-KART_CONTACT.wheelRadius-target.height-KART_CONTACT.wheelGroundClearance)<.045);
 }
});
