import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vehicleCatalog} from '../src/vehicles/library.js';
import {validateAirGates,crossFlightGate,advanceAirLap,airRespawn,legacyFlightGates} from '../src/vehicles/air-race.js';
import {gravityCorrection,hoverLift,jumpImpulseForSpeed,driveFlyingVehicle} from '../src/vehicles/flight-controls.js';
import {RAYCAST_TUNING} from '../src/v17/raycast-kart.js';
import {fromKeys,fromPad} from '../src/input/controls.js';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const custom={id:'my_kart',label:'Texture Test',type:'KART',mass:225,jumpSpeed:5.7,maxSpeed:13.5,hoverHeight:2.5,
  chassisHalfExtents:[1,.25,1],wheelTrack:.79,wheelAxle:.75,bodyGlb:'packs/id/vehicles/my_kart/body.glb',wheelGlb:'packs/id/vehicles/my_kart/wheel.glb'};

test('car catalogue always includes three prototypes and per-vehicle GLB metadata',()=>{
 const items=vehicleCatalog({vehicles:[custom]});
 assert.deepEqual(items.slice(0,3).map(x=>x.type),['KART','HOVER','DRONE']);
 assert.equal(items[3].mass,225);assert.equal(items[3].chassisHalfExtents[1],.25);
 for(const invalid of [{...custom,id:'kart'},{...custom,id:'unsafe'}, {...custom,bodyGlb:'../secret.glb'}, {...custom,mass:-1},{...custom,type:'GUNSHIP'}, {...custom,chassisHalfExtents:[1,0,1]}]){
  const pack={vehicles:[invalid]};if(invalid.id==='unsafe')pack.vehicles=[invalid,invalid];
  assert.throws(()=>vehicleCatalog(pack));
 }
});

test('flight gates count only forward 3D plane crossings through ring aperture',()=>{
 const gate=validateAirGates([{id:'r0',position:[0,4,0],normal:[0,0,4],radius:2}])[0];
 assert.equal(crossFlightGate({x:0,y:4,z:-1},{x:0,y:4,z:1},gate),true);
 assert.equal(crossFlightGate({x:0,y:4,z:1},{x:0,y:4,z:-1},gate),false);
 assert.equal(crossFlightGate({x:0,y:10,z:-1},{x:0,y:10,z:1},gate),false);
 assert.equal(crossFlightGate({x:4,y:4,z:-1},{x:4,y:4,z:1},gate),false);
 assert.equal(crossFlightGate({x:0,y:4,z:-15},{x:0,y:4,z:1},gate),false,'teleports never count');
 assert.throws(()=>validateAirGates([{id:'bad',position:[0,0,0],normal:[0,0,0],radius:1}]));
});

test('flying lap requires every ordered ring; state persists across recovery and resume',()=>{
 const gates=validateAirGates([
  {id:'first',position:[0,3,0],normal:[0,0,1],radius:2},
  {id:'second',position:[0,3,5],normal:[0,0,1],radius:2}
 ]);
 const state={laps:0,next:0,launched:false};
 const pass=(z)=>advanceAirLap(state,{x:0,y:3,z:z-1},{x:0,y:3,z:z+1},gates,1);
 assert.equal(pass(5).crossed,false,'second ring does not count before first');
 assert.equal(pass(0).crossed,true);assert.equal(state.next,1);assert.equal(state.launched,true);
 assert.equal(pass(5).crossed,true);assert.equal(state.next,0);assert.equal(state.laps,0);
 assert.equal(pass(0).won,true);assert.equal(state.laps,1);
 assert.equal(state.lastGateIndex,0);
 const restart=airRespawn(gates[state.lastGateIndex]);assert.equal(restart.z,-2.8);
 assert(legacyFlightGates(TRAINING_TRACK).length>=4);
});

test('kart jump impulse is mass-adjusted and gives visible clearance',()=>{
 const impulse=jumpImpulseForSpeed(170,0,RAYCAST_TUNING.jumpSpeed);
 assert.equal(impulse,935);
 assert.equal(jumpImpulseForSpeed(170,2,5.5),595);
 assert.equal(jumpImpulseForSpeed(170,6,5.5),0);
 const maxHeight=RAYCAST_TUNING.jumpSpeed**2/(2*9.81);
 assert(maxHeight>1.5 && RAYCAST_TUNING.hopReleaseSeconds>0.2);
 const jumpSource=read('src/v17/raycast-kart.js');
 assert.match(jumpSource,/set_m_suspensionStiffness\(0\)/);
 assert.match(jumpSource,/get_m_isInContact/);
 assert.match(jumpSource,/hopHeld/);
});

test('user gravity scale affects kart mass without changing world or props gravity',()=>{
 assert.equal(gravityCorrection(170,1),0);
 assert.equal(gravityCorrection(170,0.5),170*9.81*0.5);
 assert.equal(gravityCorrection(170,2),-170*9.81);
 assert(hoverLift({mass:140,desired:2.45,altitude:.6,vy:0})>140*9.81);
 assert.equal(hoverLift({mass:140,desired:2.45,altitude:50,vy:10}),0);
});

test('flying controller applies Ammo forces and torque, not teleports',()=>{
 const forces=[],torques=[];let activated=0;
 const rb={linearVelocity:{x:0,y:-1,z:0},angularVelocity:{x:0,y:0,z:0},
  applyForce(...v){forces.push(v);},applyTorque(...v){torques.push(v);},activate(){activated++;}};
 const c={id:'p1',entity:{rigidbody:rb,forward:{x:0,y:0,z:-1},getPosition:()=>({x:0,y:3,z:0})},
  spec:{mass:70,type:'DRONE',maxSpeed:18,hoverHeight:2.5}};
 driveFlyingVehicle(c,{throttle:1,steer:1,drift:true,descend:false,boostActive:false},1/60,{},null,{gravityScale:1});
 assert(forces.some(f=>f[2]>0),'forward thrust applied');
 assert(forces.some(f=>f[1]>0),'upward motor applied');
 assert(torques.some(f=>f[1]<0),'right stick turns chase camera right');
 assert.equal(activated,1);
 assert.equal(c.wheelDiagnostics.source,'DRONE');
});

test('desktop/gamepad flight descent is isolated from backward throttle',()=>{
 assert.equal(fromKeys(new Set(['KeyQ']),'p1').descend,true);
 assert.equal(fromKeys(new Set(['KeyO']),'p2').descend,true);
 assert.equal(fromKeys(new Set(['KeyQ']),'p1').throttle,0);
 const pad={connected:true,buttons:Array.from({length:17},(_,i)=>({pressed:i===4,value:0})),axes:[0,0]};
 assert.equal(fromPad(pad).descend,true);
 assert.equal(fromPad(pad).drift,false,'LB is now descent only, so flying vehicles never receive simultaneous upward and downward commands');
});

test('Blender vehicle models and flight gates are exported, with GLB materials and lights',()=>{
 const addon=read('blender_addon/lab5_splat_packager/__init__.py');
 const exportSource=read('blender_addon/lab5_splat_packager/exporter.py');
 const track=read('blender_addon/lab5_splat_packager/track_builder.py');
 const vehicle=read('blender_addon/lab5_splat_packager/vehicle_tools.py');
 const packer=read('scripts/build-assets.mjs');
 for(const text of ['lab5_race.generate_vehicle','lab5_race.refresh_air_gates','lab5_race.add_scene_light'])assert(addon.includes(text));
 assert(track.includes('AIR_OFFSET_%02d'));
 assert(track.includes('refresh_air_gates(scene)'));
 assert(vehicle.includes('lab5_vehicle_collider'));
 assert(vehicle.includes('lab5_vehicle_wheel'));
 assert(exportSource.includes("export_image_format='AUTO'"));
 assert(exportSource.includes("LAB5_Export_UV"),'Generated GN road and wall surfaces provide export-only UVs if needed');
 assert(exportSource.includes("'vehicles':vehicles,'lights':lights"));
 assert(exportSource.includes("t['race']['airGates']=_collect_air_gates(scene)"));
 assert(packer.includes('v.bodyGlb,v.wheelGlb'));
 assert(read('scripts/check-assets-v14.mjs').includes('inspect(vehicle.bodyGlb,true)'),'Custom GLBs are checked before launching');
 assert(read('scripts/import-existing-pack.mjs').includes('before-import-'),'Working user assets have a reversible manifest migration');
});
