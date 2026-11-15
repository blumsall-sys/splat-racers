import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {KART_CONTACT,wheelMountHeight,smoothWheelHeight,roadProximity} from '../src/v14/kart-contact.js';
import {sampleRoadSupport,updateKartRoadState,updateWheelContacts,isRoadCollider} from '../src/v14/road-support.js';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}
function setup({chassis=KART_CONTACT.chassisHalfHeight,road=()=>0,normal=()=>1,hasRoad=()=>true}={}){
 const forces=[];
 const wheels=[];
 for(const front of [false,true])for(const side of [-1,1]){
  wheels.push({front,side,mount:{setLocalPosition(...xyz){this.xyz=xyz;}}});
 }
 const car={yaw:0,wheels,entity:{getPosition(){return {x:0,y:chassis,z:0}},rigidbody:{linearVelocity:{y:0},applyForce(...args){forces.push(args)}}}};
 const physics={raycastFirst(from,to,opts){
   assert(opts.filterCallback({name:'EXPORTED_GEN_RoadCollision'}));
   assert(!opts.filterCallback({name:'GEN_InnerWall'}));
   return hasRoad(from.x,from.z)?{point:{y:road(from.x,from.z)},normal:{y:normal(from.x,from.z)}}:null;
 }};
 return {car,physics,forces};
}
test('standing on an Ammo road gets no artificial upward spring or gravity cancellation',()=>{
 const {car,physics,forces}=setup();
 for(let i=0;i<120;i++)updateKartRoadState(physics,car,{Vec3},1/60);
 assert.equal(forces.length,0);
 assert.equal(car.grounded,true);
 assert.equal(car.roadForce,0);
 assert.equal(car.wheelDiagnostics.probes,4);
 assert(Math.abs(car.wheelDiagnostics.avgGap-KART_CONTACT.wheelGroundClearance)<.005);
});
test('wheel centres follow a rising bank and do not penetrate it with the default chassis height',()=>{
 const {car,physics}=setup({road:x=>x*.18});
 for(let i=0;i<30;i++)updateKartRoadState(physics,car,{Vec3},1/60);
 assert.equal(car.wheelDiagnostics.probes,4);
 for(const w of car.wheels){
  const roadY=w.side*KART_CONTACT.wheelTrackX*.18;
  const wheelBottom=KART_CONTACT.chassisHalfHeight+w.mount.xyz[1]-KART_CONTACT.wheelRadius;
  assert(Math.abs(wheelBottom-roadY-KART_CONTACT.wheelGroundClearance)<.004);
 }
});
test('off edge or mid-air: no spring force, no phantom road, wheels return to their mounts',()=>{
 const {car,physics,forces}=setup({chassis:3,hasRoad:()=>false});
 for(let i=0;i<50;i++)updateKartRoadState(physics,car,{Vec3},1/60);
 assert.equal(forces.length,0);assert.equal(car.grounded,false);
 assert.equal(car.wheelDiagnostics.probes,0);
 for(const w of car.wheels)assert.equal(w.mount.xyz[1],KART_CONTACT.wheelMountY);
});
test('grade still reports positive uphill, but does not add vertical forces',()=>{
 const {car,physics,forces}=setup({road:(x,z)=>z*.12});
 const data=updateKartRoadState(physics,car,{Vec3},1/60);
 assert(data.grade>.10 && data.grade<.14);
 assert.equal(forces.length,0);
});
test('physical hull and wheel mounts share one calibrated tyre-height contract',()=>{
 assert(Math.abs(KART_CONTACT.chassisHalfHeight+KART_CONTACT.wheelMountY-KART_CONTACT.wheelRadius)<.0001);
 assert(Math.abs(wheelMountHeight(0,KART_CONTACT.chassisHalfHeight)-KART_CONTACT.wheelMountY-KART_CONTACT.wheelGroundClearance)<1e-9);
 assert(roadProximity(0,KART_CONTACT.chassisHalfHeight,0));
 assert(!roadProximity(0,3,0));
 assert.equal(smoothWheelHeight(0,1,1/60),1); // rising ground cannot push tyre under deck
 assert(smoothWheelHeight(1,0,1/60)>0); // downhill extension remains smooth
 const source=read('src/v14/pc-scene.js');
 assert.match(source,/restitution:\.64,linearDamping/);
 assert.match(source,/createRaycastVehicle\(app,chassis,ammo(?:,T)?\)/);
 const main=read('src/v14/main.js');
 assert.match(main,/syncRaycastWheelVisuals\(car,pc\)/);
 assert.doesNotMatch(main,/updateKartRoadState\(app\.systems\.rigidbody,car,pc,dt\)/);
});
