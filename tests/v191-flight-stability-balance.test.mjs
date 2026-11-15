import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attitudeError,uprightTorque,needsLocalRighting} from '../src/vehicles/attitude-assist.js';
import {flightSpeedLimit,cappedFlightThrust,driveFlyingVehicle,COMPETITIVE_SPEED_CAP} from '../src/vehicles/flight-controls.js';
import {vehicleCatalog} from '../src/vehicles/library.js';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const approx=(a,b,e=1e-5)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);

test('sideways, near-inverted, and fully inverted hulls generate restoring physical torque',()=>{
 const roll=uprightTorque({x:-1,y:0,z:0},{x:1,y:0,z:0},{x:0,y:0,z:0},140,'HOVER');
 assert(roll.torque.z<0,'negative Z torque turns rightward roll back');
 assert(roll.tiltDegrees>89&&roll.tiltDegrees<91);
 assert.equal(roll.driveAuthority,0);
 assert.equal(roll.gateEligible,false);
 const inverted=uprightTorque({x:0,y:-1,z:0},{x:1,y:0,z:0},{x:0,y:0,z:0},70,'DRONE');
 assert(Math.abs(inverted.torque.x)>200,'at 180 degrees the cross product alone would be zero');
 const upright=uprightTorque({x:0,y:1,z:0},{x:1,y:0,z:0},{x:0,y:0,z:0},70,'DRONE');
 approx(upright.torque.x,0);approx(upright.torque.z,0);
 assert.equal(upright.gateEligible,true);assert.equal(upright.driveAuthority,1);
 const damp=uprightTorque({x:0,y:1,z:0},{x:1,y:0,z:0},{x:2,y:0,z:-2},70,'DRONE');
 assert(damp.torque.x<0&&damp.torque.z>0,'rotation always damped');
});

test('semi-implicit torque model reduces a 75 degree tumble without snapping transforms',()=>{
 const mass=140,I=mass*.7,dt=1/120;
 let angle=75*Math.PI/180,omega=.85;
 for(let i=0;i<360;i++){
  const u={x:-Math.sin(angle),y:Math.cos(angle),z:0};
  const out=uprightTorque(u,{x:1,y:0,z:0},{x:0,y:0,z:omega},mass,'HOVER');
  omega+=out.torque.z/I*dt;
  angle+=omega*dt;
 }
 assert(Math.abs(angle*180/Math.PI)<8,'PD motor settles an initially spinning rolled craft');
});

test('tipped hovercraft thrust shuts off, stalls rather than side-driving, then self-rights locally',()=>{
 const forces=[],torques=[],events=[];
 const rb={linearVelocity:{x:4,y:0,z:5},angularVelocity:{x:0,y:0,z:0},
  applyForce(...a){forces.push(a);},applyTorque(...a){torques.push(a);},activate(){},
  teleport(pos,rot){events.push({pos,rot});this.position=pos;}};
 const c={id:'p1',entity:{rigidbody:rb,up:{x:-1,y:0,z:0},right:{x:1,y:0,z:0},forward:{x:0,y:0,z:-1},getPosition:()=>rb.position||{x:5,y:2,z:5}},
  spec:{id:'hover',type:'HOVER',mass:140,maxSpeed:15,hoverHeight:2.45,autoRightSeconds:1.2},hoverTarget:2.45,tippedSeconds:1.19};
 const phys={raycastFirst:()=>({point:{y:0}})},pc={Vec3:class Vec3{constructor(x,y,z){Object.assign(this,{x,y,z});}}};
 const result=driveFlyingVehicle(c,{throttle:1,steer:1,drift:false,descend:false},.05,phys,pc,{competitive:true});
 assert.equal(result.autoLeveled,true);
 assert.equal(result.gateEligible,false);
 assert.equal(c.flightLocalRightings,1);
 assert.equal(events.length,1);
 assert.equal(events[0].pos.x,5,'anti-stuck does not warp onto race line or checkpoint');
 assert.equal(events[0].pos.z,5);
 assert.equal(c.driverDiagnostics.engine,0,'no forward thrust while tipped over');
 assert(torques.some(x=>x[2]<0),'restoring torque applied before anti-snag');
 assert(forces.some(x=>x[0]<0&&x[2]<0),'strong velocity braking on side');
});

test('flight speed and boost are aligned with kart limits, without free-roam artificial cap',()=>{
 const cars=vehicleCatalog();
 assert.deepEqual(cars.map(v=>v.maxSpeed),[12.5,12.5,12.5]);
 for(const kind of ['HOVER','DRONE']){
  const s={type:kind,maxSpeed:19};
  assert.equal(flightSpeedLimit(s,false,true),COMPETITIVE_SPEED_CAP*.87);
  approx(flightSpeedLimit(s,true,true),COMPETITIVE_SPEED_CAP*.87*1.35);
  assert.equal(flightSpeedLimit(s,false,false),19);
 }
 assert.equal(cappedFlightThrust({along:14,throttle:1,speedLimit:12.5,mass:70}),0);
 assert.equal(cappedFlightThrust({along:1,throttle:1,speedLimit:12.5,mass:70,authority:0}),0);
 const normal=cappedFlightThrust({along:5,throttle:1,speedLimit:12.5,mass:70,acceleration:4});
 assert.equal(normal,280,'drone should accelerate near 4 m/s², not 16.5 m/s²');
 assert(normal>0);
});

test('collision recovery delay and vehicle library export fields remain valid',()=>{
 assert.equal(needsLocalRighting(80,2.5,2.6),false);
 assert.equal(needsLocalRighting(80,2.7,2.6),true);
 assert.equal(needsLocalRighting(20,20,2.6),false);
 const base={id:'stable',label:'Stable',type:'DRONE',mass:70,maxSpeed:12.5,hoverHeight:2.45,jumpSpeed:5.5,bodyGlb:'vehicles/dupe.glb',stabilityAssist:1.6,autoRightSeconds:3.4};
 assert.equal(vehicleCatalog({vehicles:[base]}).at(-1).stabilityAssist,1.6);
 assert.throws(()=>vehicleCatalog({vehicles:[{...base,stabilityAssist:9}]}));
 assert.throws(()=>vehicleCatalog({vehicles:[{...base,autoRightSeconds:0.5}]}));
 const exp=read('blender_addon/lab5_splat_packager/exporter.py');
 const tool=read('blender_addon/lab5_splat_packager/vehicle_tools.py');
 assert(exp.includes("'stabilityAssist':"));assert(exp.includes("'autoRightSeconds':"));
 assert(tool.includes('lab5_vehicle_stability_assist'));
 const main=read('src/v14/main.js');
 assert(main.includes('Object.assign(car.raycast.t,kartSpeedTuning('));
 assert(main.includes('flight.autoLeveled'));
 assert(main.includes('!car.flightDiagnostics?.gateEligible'));
});
