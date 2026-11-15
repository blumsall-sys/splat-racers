import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkRacePack} from '../src/v14/pack-contract.js';
import {checkColliderProxies} from '../src/v14/collider-proxies.js';
import {validateTrack} from '../src/track/track.js';

const floor={id:'GROUND_P',bodyType:'static',shape:'BOX',position:[0,-.15,0],rotation:[0,0,0,1],halfExtents:[40,.15,40],drivable:true};
const ball={id:'BALL_P',bodyType:'dynamic',shape:'SPHERE',position:[1,2,0],rotation:[0,0,0,1],radius:.5,mass:15};
const makeTrack=()=>({version:1,levelType:'FREE_ROAM',spawns:{p1:{x:0,z:0,yaw:0},p2:{x:2,z:0,yaw:0}},collision:{walls:[],obstacles:[]},race:{waypoints:[],gates:[],lapsToWin:3},visuals:{boxes:[]}});
test('free roam accepts collision proxies without a static GLB or circuit gates',()=>{
 const track=validateTrack(makeTrack());
 const pack={version:1,packId:'world',dynamic:[],splat:{},staticCollisionGlb:null,colliders:[floor,ball]};
 assert.deepEqual(checkColliderProxies(pack.colliders),{count:2,static:1,dynamic:1});
 const result=checkRacePack(pack,track);assert.equal(result.collisionSource,'staticProxy');assert.equal(result.dynamicCount,1);
});
test('free roam refuses world with no drivable surface, but accepts an authored GLB',()=>{
 const track=validateTrack(makeTrack());
 assert.throws(()=>checkRacePack({version:1,packId:'world',colliders:[],splat:{}},track),/staticCollisionGlb/);
 assert.doesNotThrow(()=>checkRacePack({version:1,packId:'world',staticCollisionGlb:'packs/world/ground.glb',colliders:[]},track));
});
test('rejects invalid dynamic shape, nonuniform rotation and duplicate proxy IDs',()=>{
 for(const items of [[floor,floor],[{...ball,mass:0}],[{...floor,rotation:[0,0,0,3]}],[{...floor,halfExtents:[-1,1,1]}],[{...ball,drivable:true}]]){
  assert.throws(()=>checkColliderProxies(items));
 }
});
test('race-only rules still reject no checkpoint track',()=>{
 const track=makeTrack();delete track.levelType;assert.throws(()=>validateTrack(track),/walls|waypoints|gates/);
});
test('Blender exports edit-ready wireframe colliders and refuses accidental empty SOG',()=>{
 const addon=fs.readFileSync('blender_addon/lab5_splat_packager/__init__.py','utf8');
 const exporter=fs.readFileSync('blender_addon/lab5_splat_packager/exporter.py','utf8');
 const browser=fs.readFileSync('src/v14/pc-scene.js','utf8');
 const main=fs.readFileSync('src/v14/main.js','utf8');
 const html=fs.readFileSync('index.html','utf8');
 assert.match(addon,/Add Editable Ground Mesh/);
 assert.match(addon,/Add Box \/ Sphere Collider/);
 assert.match(addon,/allow_no_sog_export/);
 assert.match(exporter,/NO SOG LINKED/);
 assert.match(exporter,/colliders':proxies/);
 assert.match(browser,/addPrimitiveColliders/);
 assert.match(browser,/type:'sphere'/);
 assert.match(browser,/lab5-drivable-road/);
 assert.match(main,/mode!=='explore'\)\s*\{\s*const roadEvents=updateLaps/);
 assert.match(html,/id="explore-btn"/);
});
