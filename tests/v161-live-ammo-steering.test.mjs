import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fromKeys} from '../src/input/controls.js';
import {kartControlStep,emptyDrift} from '../src/v16/kart64.js';
import {observeKartSteering,resetSteeringWatchdog,trackKartYawCommand,wrappedDelta} from '../src/v16/steering-watchdog.js';

const sceneSource=readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
const mainSource=readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
function mockCar(){
 const rb={linearVelocity:{x:0,y:0,z:2},angularVelocity:{x:0,y:0,z:0},teleports:[],
   teleport(p,yaw){this.teleports.push([p,yaw]);},activate(){}};
 const car={id:'p1',yaw:0,vx:0,vz:2,input:{steer:1},entity:{rigidbody:rb,getPosition:()=>({x:2,y:.5,z:0})}};
 resetSteeringWatchdog(car);return car;
}
const pc={Vec3:class{constructor(x,y,z){Object.assign(this,{x,y,z});}}};

test('regression: v1.6 had angular damping 2.5; v1.6.1 keeps chassis damping below 1 and Y axis unlocked',()=>{
 const m=sceneSource.match(/chassis\.addComponent\('rigidbody',\{([^}]+)\}\)/);
 assert(m,'chassis rigidbody addComponent missing');
 const damping=Number(m[1].match(/angularDamping:\s*([\d.]+)/)?.[1]);
 assert(damping>0&&damping<1,`invalid angularDamping ${damping}; Bullet clamps values >=1 to 1, eliminating yaw`);
 assert.match(sceneSource,/angularFactor=new pc\.Vec3\(\.25,1,\.25\)/);
 assert.match(mainSource,/driveRaycastVehicle\(car,input,dt,pc\)/);
 assert.doesNotMatch(mainSource,/trackKartYawCommand\(car,applied\.commandedYaw\)/);
});

test('Bullet damping behavior: 2.5 (clamped to 1) extinguishes yaw, 0.12 preserves it',()=>{
 const bulletAngularStep=(velocity,damping,dt)=>velocity*Math.pow(1-Math.max(0,Math.min(1,damping)),dt);
 assert(Math.abs(bulletAngularStep(-1.4,2.5,1/60))===0);
 assert(Math.abs(bulletAngularStep(-1.4,.12,1/60))>1.39);
});

test('both player steering requests survive the input pipeline and have opposite yaw signs',()=>{
 const keys=new Set(['KeyW','KeyD','ArrowUp','ArrowLeft']);
 const p1=fromKeys(keys,'p1'),p2=fromKeys(keys,'p2');
 const car={yaw:0,vx:0,vz:2.5,omega:0};
 const a=kartControlStep(car,p1,emptyDrift(),1/60);
 const b=kartControlStep(car,p2,emptyDrift(),1/60);
 assert(a.commandedYaw<-.10,`p1 ${a.commandedYaw}`);
 assert(b.commandedYaw>.10,`p2 ${b.commandedYaw}`);
});

test('live heading observer stays out of healthy Ammo steering; no teleports',()=>{
 const c=mockCar();observeKartSteering(c,1/60,pc);
 trackKartYawCommand(c,-1.1);
 for(let i=0;i<40;i++){
  c.yaw-=1.1/60;
  observeKartSteering(c,1/60,pc);
 }
 assert.equal(c.steeringWatchdog.assisted,false);
 assert.equal(c.entity.rigidbody.teleports.length,0);
 assert(c.steeringWatchdog.measuredYawRate<-.9);
});

test('stalled physical heading triggers bounded arcade heading assist after sustained mismatch',()=>{
 const c=mockCar();observeKartSteering(c,1/60,pc);
 trackKartYawCommand(c,-1.1);
 for(let i=0;i<30;i++){observeKartSteering(c,1/60,pc);}
 assert.equal(c.steeringWatchdog.warning,true);
 assert.equal(c.steeringWatchdog.assisted,true);
 assert(c.entity.rigidbody.teleports.length>0);
 const move=wrappedDelta(c.yaw,0);
 assert(move<-.03,`fallback must physically turn the chassis ${move}`);
 assert.equal(c.entity.rigidbody.linearVelocity.z,2,'fallback preserves translation');
});

test('if car is parked, no heading correction forces stationary turn',()=>{
 const c=mockCar();c.vz=0;observeKartSteering(c,1/60,pc);trackKartYawCommand(c,1.2);
 for(let i=0;i<40;i++){observeKartSteering(c,1/60,pc);}
 assert.equal(c.entity.rigidbody.teleports.length,0);
});


test('Blender 5.1 generator no longer references removed ResampleCurve.mode property',()=>{
 const curve=readFileSync(new URL('../blender_addon/lab5_splat_packager/track_builder.py',import.meta.url),'utf8');
 assert(!/sampled\.mode\s*=/.test(curve),'obsolete Blender 5.1 API');
 assert.match(curve,/L\.new\(info\.outputs\['Geometry'\],to_mesh\.inputs\['Curve'\]\)/);
 assert.match(curve,/GeometryNodeCurveToMesh/);
});
