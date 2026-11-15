import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RACE_SPEED_OPTIONS,raceSpeedMultiplier,kartSpeedTuning,flightSpeedTuning} from '../src/vehicles/race-speed.js';
import {flightBankTarget,bankedFlightTorque,attitudeError} from '../src/vehicles/attitude-assist.js';
import {flightSpeedLimit,cappedFlightThrust,driveFlyingVehicle} from '../src/vehicles/flight-controls.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const near=(actual,expected,tolerance=1e-7)=>assert(Math.abs(actual-expected)<tolerance,`${actual} versus ${expected}`);

test('race-speed presets scale acceleration AND speed for kart, hover and drone, without cumulative restart multiplication',()=>{
 assert.deepEqual(RACE_SPEED_OPTIONS,[.75,1,1.25,1.5,2,2.5]);
 assert.equal(raceSpeedMultiplier('2.5'),2.5);
 assert.equal(raceSpeedMultiplier('evil'),1);
 assert.equal(raceSpeedMultiplier('25'),1);
 for(const ratio of RACE_SPEED_OPTIONS){
  const k=kartSpeedTuning({type:'KART',maxSpeed:18},true,ratio);
  near(k.speedLimitMps,12.5*ratio);near(k.engineForcePerRearWheel,340*ratio);
  near(k.reverseForcePerRearWheel,240*ratio);near(k.brakingForcePerWheel,20*ratio*Math.sqrt(ratio));
  const h=flightSpeedTuning({type:'HOVER',maxSpeed:18},'HOVER',true,ratio);
  const d=flightSpeedTuning({type:'DRONE',maxSpeed:18},'DRONE',true,ratio);
  near(h.speedLimitMps,k.speedLimitMps*.87);near(d.speedLimitMps,k.speedLimitMps*.87);
  near(h.accelerationMps2,4.5*ratio*.87);near(d.accelerationMps2,4.0*ratio*.87);
  near(flightSpeedLimit({type:'DRONE',maxSpeed:18},false,true,ratio),k.speedLimitMps*.87);
  assert.equal(cappedFlightThrust({along:0,throttle:1,speedLimit:h.speedLimitMps,mass:140,acceleration:h.accelerationMps2}),140*4.5*ratio*.87);
 }
 const first=kartSpeedTuning({maxSpeed:12.5},true,2.5);
 const second=kartSpeedTuning({maxSpeed:12.5},true,2.5);
 assert.deepEqual(first,second,'changing/rerunning races cannot re-multiply current tuning');
});

test('bank targets lean into both turns and pitch in both directions',()=>{
 for(const kind of ['HOVER','DRONE']){
  const left=flightBankTarget({x:0,z:1},1,0,0,kind);
  const right=flightBankTarget({x:0,z:1},-1,0,0,kind);
  assert(left.bankDegrees<0&&right.bankDegrees>0);
  assert(left.up.x<-.1&&right.up.x>.1);
  const climb=flightBankTarget({x:0,z:1},0,0,1,kind);
  const dive=flightBankTarget({x:0,z:1},0,0,-1,kind);
  assert(climb.pitchDegrees<0&&dive.pitchDegrees>0);
  assert(climb.up.z<0&&dive.up.z>0);
  near(Math.hypot(left.up.x,left.up.y,left.up.z),1);
 }
 const bank=flightBankTarget({x:0,z:1},1,0,0,'HOVER');
 const torque=bankedFlightTorque({x:0,y:1,z:0},{x:1,y:0,z:0},{x:0,y:0,z:0},140,'HOVER',1,bank.up);
 assert(torque.torque.z>0,'left bank should torque top of craft towards -world X');
 assert.equal(torque.gateEligible,true,'controlled 16 degree bank should still count rings');
 const neutral=bankedFlightTorque({x:0,y:1,z:0},{x:1,y:0,z:0},{x:0,y:0,z:0},140,'HOVER',1,flightBankTarget({x:0,z:1},0,0,0,'HOVER').up);
 near(neutral.torque.x,0);near(neutral.torque.z,0);
 const tipped=attitudeError({x:1,y:0,z:0});assert.equal(tipped.driveAuthority,0,'true flips still disable propulsion');
});

test('flight controller applies native Ammo banking torque and shared high-speed pace',()=>{
 const forces=[],torques=[];
 const rb={linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},
   applyForce(...args){forces.push(args);},applyTorque(...args){torques.push(args);},applyImpulse(){},activate(){}};
 const ent={rigidbody:rb,up:{x:0,y:1,z:0},right:{x:1,y:0,z:0},forward:{x:0,y:0,z:-1},getPosition:()=>({x:0,y:2.5,z:0})};
 const car={id:'p1',entity:ent,spec:{type:'DRONE',mass:70,maxSpeed:12.5,acceleration:4}};
 const physics={raycastFirst:()=>null};const pc={Vec3:class V{constructor(x,y,z){Object.assign(this,{x,y,z});}}};
 const state=driveFlyingVehicle(car,{steer:1,throttle:1,drift:false,descend:false},1/60,physics,pc,{raceSpeed:2.5});
 assert(state.bankTargetDegrees<0);assert(state.pitchTargetDegrees>0);
 near(state.speedLimitMps,31.25*.87);near(state.accelerationMps2,10*.87);
 assert(torques.some(t=>t[2]>1),'steering physically rolls, not just renders the drone');
 assert(forces.some(f=>f[2]>0),'forward throttle applies actual force');
 assert.equal(state.gateEligible,true);
});

test('Blender start percent and first flight ring have independent curve percentages',()=>{
 const init=read('blender_addon/lab5_splat_packager/__init__.py');
 const builder=read('blender_addon/lab5_splat_packager/track_builder.py');
 const exporter=read('blender_addon/lab5_splat_packager/exporter.py');
 assert(init.includes("air_gate_start_offset_percent:FloatProperty"));
 assert(init.includes('default=4.0'));
 assert(init.includes("air.prop(p,'air_gate_start_offset_percent')"));
 assert(builder.includes("float(getattr(scene.lab5_pack,'air_gate_start_offset_percent',4.0))"));
 assert(builder.includes('frames=_samples_with_frames(curve,32,float(scene.lab5_pack.start_percent)/100.0)'),'road gates and grid remain at original start fraction');
 assert(builder.includes('offset.parent=anchor')&&builder.includes('Only anchor world transforms are updated'));
 assert(exporter.includes('airGateStartOffsetFraction'));
});

test('race speed setting appears in browser menu and is passed to both human and NPC controllers',()=>{
 const html=read('index.html'),main=read('src/v14/main.js'),npc=read('src/race/raycast-npc.js');
 assert(html.includes('id="race-speed"'));
 assert(main.includes("selectedRaceSpeed=raceSpeedMultiplier($('race-speed').value)"));
 assert(main.includes('Object.assign(car.raycast.t,kartSpeedTuning('));
 assert(main.includes('raceSpeed:selectedRaceSpeed'));
 assert(main.includes('car.npcState,obstacle,surface,selectedRaceSpeed'));
 assert(npc.includes('cfg.cruise*pace'));
});
