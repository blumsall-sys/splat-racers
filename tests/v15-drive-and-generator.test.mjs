import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {driveForces,axesForYaw,signedForwardSpeed,wheelSpinStep,wheelSteerDegrees} from '../src/v14/drive-math.js';
import {fromKeys} from '../src/input/controls.js';
const close=(a,b,eps=1e-6)=>assert(Math.abs(a-b)<=eps,`expected ${a} ≈ ${b}`);
test('W creates forward thrust, without commanded yaw or lateral slide',()=>{
 const input=fromKeys(new Set(['KeyW']),'p1');
 const f=driveForces({yaw:0,vx:0,vz:0,omega:0,...input});
 assert(f.fz>2500,'Motor thrust must exceed ordinary wheel/chassis contact friction');close(f.fx,0);close(f.torque,0);close(f.desiredYawRate,0);
});
test('forward force follows heading and never produces a turn at neutral steer',()=>{
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/3]){
  const f=driveForces({yaw,vx:0,vz:0,omega:0,throttle:1,steer:0});
  const axis=axesForYaw(yaw).forward;
  assert(f.fx*axis.x+f.fz*axis.z>100);
  close(f.fx*axis.z-f.fz*axis.x,0);
  close(f.torque,0);
 }
});
test('D goes right relative to chase camera; A left; reverse steer reverses yaw',()=>{
 const baseline={yaw:0,vx:0,vz:6,omega:0,throttle:1};
 const right=driveForces({...baseline,steer:1});
 const left=driveForces({...baseline,steer:-1});
 assert(right.torque<0);assert(left.torque>0);
 close(right.torque,-left.torque);
 const reverse=driveForces({yaw:0,vx:0,vz:-6,omega:0,throttle:-1,steer:1});
 assert(reverse.torque>0);
});
test('S reverses thrust and signed tire spin when moving backward',()=>{
 const b=driveForces({yaw:0,vx:0,vz:-3,omega:0,throttle:-1});
 assert(b.fz<0);assert(signedForwardSpeed({yaw:0,vx:0,vz:-3})<0);
 assert(wheelSpinStep(-3,1/60)<0);assert(wheelSpinStep(3,1/60)>0);
});
test('live Bullet vehicle steers front raycast wheels and uses true wheel transforms',()=>{
 const code=fs.readFileSync(new URL('../src/v17/raycast-kart.js',import.meta.url),'utf8');
 assert.match(code,/vehicle\.setSteeringValue\(command\.steeringValue,index\)/);
 assert.match(code,/if\(front\)vehicle\.setSteeringValue\(command\.steeringValue,index\)/);
 assert.match(code,/getWheelTransformWS\(i\)/);
 const scene=fs.readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
 assert.match(scene,/tire\.setLocalEulerAngles\(0,0,90\)/);
 assert.match(scene,/createRaycastVehicle\(app,chassis,ammo(?:,T)?\)/);
});
test('P1 W/A/S/D does not overwrite P2 arrow keys',()=>{
 const keys=new Set(['KeyW','ArrowDown','KeyA','ArrowRight']);
 const p1=fromKeys(keys,'p1'),p2=fromKeys(keys,'p2');
 assert.equal(p1.throttle,1);assert.equal(p1.steer,-1);assert.equal(p2.throttle,-1);assert.equal(p2.steer,1);
});
test('Blender generator preserves RACE_TRACK parent and GN source while procedural markers are distinct',()=>{
 const code=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/track_builder.py',import.meta.url),'utf8');
 for(const name of ['RACE_TRACK','TRACK_Centerline','GeometryNodeObjectInfo','GeometryNodeCurveToMesh','RACE_COLLISION','RACE_WALLS','RACE_WAYPOINTS','RACE_GATES','RACE_SPAWNS'])assert(code.includes(name),name);
 assert.match(code,/_samples_with_frames\(curve,32,float\(scene\.lab5_pack\.start_percent\)\/100\.0\)/);assert.match(code,/refresh_markers\(scene\)/);
 assert.match(code,/_repair_generated_profiles\(scene\)/);
 assert.doesNotMatch(code,/GeometryNodeSetPosition/);
 assert.match(code,/profile\.inputs\['Start'\]\.default_value=\(float\(barrier_offset\), \+\.07, 0\)/);
 const exp=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/exporter.py',import.meta.url),'utf8');
 assert.match(exp,/bpy\.data\.meshes\.new_from_object\(evaluated/);
});
