/**
 * Optional *native* Bullet smoke test, based on PlayCanvas's official WASM.
 * Run `npm run setup:ammo`, then `node scripts/qa-native-vehicle.mjs`.
 * This is a flat-ground physics test, not a replacement for testing the
 * PlayCanvas/GLB course in a real browser.
 */
import {createRequire} from 'node:module';
import {existsSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {RAYCAST_TUNING,createRaycastVehicle,raycastCommands,applyRaycastAxleControls,disposeRaycastVehicle} from '../src/v17/raycast-kart.js';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=process.env.AMMO_SOURCE_DIR||path.join(root,'public/ammo');
const jsPath=path.join(folder,'ammo.wasm.js');
const wasmPath=path.join(folder,'ammo.wasm.wasm');
if(!existsSync(jsPath)||!existsSync(wasmPath))throw new Error('Missing Ammo WASM; run npm run setup:ammo first or provide AMMO_SOURCE_DIR');
// Bundled glue is CommonJS, but this project uses type:module. Stage a
// temporary CommonJS copy so this validation runs consistently on Windows.
const temp=mkdtempSync(path.join(os.tmpdir(),'lab5-ammo-qa-'));
copyFileSync(jsPath,path.join(temp,'ammo.wasm.js'));
copyFileSync(wasmPath,path.join(temp,'ammo.wasm.wasm'));
const AmmoFactory=require(path.join(temp,'ammo.wasm.js'));
const Ammo=await AmmoFactory({locateFile:name=>path.join(temp,name)});
const vector=(x,y,z)=>new Ammo.btVector3(x,y,z);
const config=new Ammo.btDefaultCollisionConfiguration();
const dispatcher=new Ammo.btCollisionDispatcher(config);
const broadphase=new Ammo.btDbvtBroadphase();
const solver=new Ammo.btSequentialImpulseConstraintSolver();
const world=new Ammo.btDiscreteDynamicsWorld(dispatcher,broadphase,solver,config);
world.setGravity(vector(0,-9.81,0));
function body(shape,mass,xyz){
 const transform=new Ammo.btTransform();transform.setIdentity();transform.setOrigin(vector(...xyz));
 const state=new Ammo.btDefaultMotionState(transform);const inertia=vector(0,0,0);
 if(mass>0)shape.calculateLocalInertia(mass,inertia);
 const info=new Ammo.btRigidBodyConstructionInfo(mass,state,shape,inertia);
 const rigid=new Ammo.btRigidBody(info);
 world.addRigidBody(rigid);return rigid;
}
const ground=body(new Ammo.btBoxShape(vector(100,.5,100)),0,[0,-.5,0]);
const t=RAYCAST_TUNING;
const carShape=new Ammo.btBoxShape(vector(t.chassisHalfWidth,t.chassisHalfHeight,t.chassisHalfLength));
const native=body(carShape,t.massKg,[0,t.startHeightAboveRoad,0]);
native.setDamping(.10,.24); native.setAngularFactor(vector(.25,1,.25));
const entity={rigidbody:{body:native}};
const rig=createRaycastVehicle({systems:{rigidbody:{dynamicsWorld:world}}},entity,Ammo,t);
const car={raycast:rig};
const dt=1/120;
const log=[];
let steering=0,maxY=-Infinity,boostObserved=false,hopTriggered=false;
for(let i=0;i<120*7;i++){
 const turn=i>=120*2 && i<120*5 ? 1:0;
 const reverse=i>=120*5;
 const input={throttle:reverse?-1:1,steer:turn};
 const linear=native.getLinearVelocity(),tr=native.getWorldTransform();const rot=tr.getRotation();
 // Derive heading from the native forward axis by multiplying quaternion.
 const qx=rot.x(),qy=rot.y(),qz=rot.z(),qw=rot.w();
 const fz=1-2*(qx*qx+qy*qy),fx=2*(qx*qz+qy*qw),fy=2*(qy*qz-qx*qw);
 const forward=linear.x()*fx+linear.y()*fy+linear.z()*fz;
 const boostedInput=i>=120*5&&i<120*6?{...input,throttle:1,boostActive:true}:input;
 const cmd=raycastCommands(boostedInput,forward,steering,dt,rig.drift,t);
 if(boostedInput.boostActive){boostObserved ||= cmd.engine>t.engineForcePerRearWheel;}
 if(i===120*5+12){native.applyCentralImpulse(vector(0,t.jumpImpulse,0));hopTriggered=true;}
 steering=cmd.steeringValue;rig.drift=cmd.drift;
 applyRaycastAxleControls(rig.vehicle,cmd,cmd.tireGrip);
 world.stepSimulation(dt,2,dt);
 maxY=Math.max(maxY,native.getWorldTransform().getOrigin().y());
 if(i%120===119){const p=native.getWorldTransform().getOrigin();
  const contacts=[0,1,2,3].map(k=>Boolean(rig.vehicle.getWheelInfo(k).get_m_raycastInfo().get_m_isInContact()));
  log.push({sec:(i+1)/120,x:Number(p.x().toFixed(2)),y:Number(p.y().toFixed(2)),z:Number(p.z().toFixed(2)),wheelContacts:contacts.filter(Boolean).length});
 }
}
console.log('NATIVE BULLET TEST',JSON.stringify(log));
const p=native.getWorldTransform().getOrigin();
assert(Number.isFinite(p.x())&&Number.isFinite(p.y())&&Number.isFinite(p.z()));
assert(log.some(s=>s.wheelContacts>=2),'raycast wheels never contacted ground');
assert(Math.hypot(log[4].x-log[1].x,log[4].z-log[1].z)>1,'car did not move during steering');
assert(log.some(s=>Math.abs(s.x)>0.5),'steering never produced a lateral turn');
assert(boostObserved,'Nitro never increased rear-wheel engine force');
assert(hopTriggered&&maxY>0.54,'Hop did not lift the native Bullet chassis');
console.log('PASS Native Ammo contacts, drive and steering generated finite motion');
disposeRaycastVehicle(car);
assert.equal(car.raycast,null);
console.log('PASS Native raycast action cleanup without invalid tuning destructor');
rmSync(temp,{recursive:true,force:true});
