import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 chooseWallMode,isWallMeshName,isRoadMeshName,wallProxy,
 collisionObjectName,isMarkerName
} from '../src/v14/collision-policy.js';

test('markers are metadata only, not static collision geometry',()=>{
 for(const n of ['WP_000','WP_032','SPAWN_P1','SPAWN_P2','GATE_START_A','GATE_START_B','GATE_01_A']){
  assert.equal(isMarkerName(n),true);assert.equal(isWallMeshName(n),false);assert.equal(isRoadMeshName(n),false);
 }
 const exporter=fs.readFileSync('blender_addon/lab5_splat_packager/exporter.py','utf8');
 assert.match(exporter,/staticmeshes=mesh_objects\('RACE_COLLISION'\)\+mesh_objects\('RACE_WALLS'\)/);
 assert.doesNotMatch(exporter,/staticmeshes=.*(?:RACE_GATES|RACE_WAYPOINTS|RACE_SPAWNS)/);
});
test('box walls are the default and either box or mesh collision can be selected, never both',()=>{
 const track={collision:{walls:[{id:'GEN_OuterWall_000'}]}};
 assert.equal(chooseWallMode('?debug=1',track),'boxes');
 assert.equal(chooseWallMode('?walls=mesh',track),'mesh');
 assert.equal(chooseWallMode('?walls=boxes',track),'boxes');
 assert.equal(chooseWallMode('',{collision:{walls:[]}}),'mesh');
 for(const n of ['EXPORTED_GEN_OuterWall','COL_Barrier','GEN_InnerWall','fence','Guardrail_01'])assert.equal(isWallMeshName(n),true);
 assert.equal(isRoadMeshName('EXPORTED_GEN_RoadCollision'),true);
 assert.equal(isRoadMeshName('EXPORTED_GEN_OuterWall'),false);
 const source=fs.readFileSync('src/v14/pc-scene.js','utf8');
 assert.match(source,/skipWalls && \(isWallMeshName\(entity.name\)\|\|isWallMeshName\(renderAsset\?\.name\)\)/);
 assert.match(source,/wallMode==='boxes' \? attachWallBoxColliders/);
 assert.match(source,/type:'static'/);
});
test('guardrail proxy preserves authored bottom while extending an old low wall to 2m',()=>{
 const b=wallProxy({id:'GEN_InnerWall_002',x:11,z:-5,hx:.13,hz:1.8,y:8.7,height:1.4,yaw:Math.PI/2});
 assert.deepEqual(b.position,[11,9,-5]);
 assert.equal(b.halfExtents[0],.22);
 assert.equal(b.halfExtents[1],1);
 assert.equal(b.halfExtents[2],1.86);
 assert.equal(b.originalHeight,1.4);
 assert.ok(Math.abs(b.yawRadians-Math.PI/2)<1e-10);
});
test('guardrail without height is placed from terrain zero in bundled test circuit',()=>{
 const b=wallProxy({id:'outer-west',x:-17,z:0,hx:.6,hz:12.5});
 assert.equal(b.position[1],1);
 assert.equal(b.halfExtents[1],1);
});
test('collision diagnostic can name dynamic crate, road, guardrail or another car',()=>{
 assert.equal(collisionObjectName({other:{name:'Dynamic: DYN_crate'}}),'Dynamic: DYN_crate');
 assert.equal(collisionObjectName({other:{name:'Wall: GEN_InnerWall_029'}}),'Wall: GEN_InnerWall_029');
 assert.equal(collisionObjectName(null),'unknown contact');
});
test('Blender guardrail boxes use bank-aware lateral frames and cover height changes',()=>{
 const s=fs.readFileSync('blender_addon/lab5_splat_packager/exporter.py','utf8');
 assert.match(s,/frames=_samples_with_frames\(curve,wall_segment_count\(length,\.60\)\)/);
 assert.match(s,/offset=half\+thickness\*\.5\+\.18/);
 assert.match(s,/a=pos\+lateral\*\(offset\*side\)/);
 assert.match(s,/b=next_pos\+next_lateral\*\(offset\*side\)/);
 assert.match(s,/make_wall_segment\(a,b,height,thickness,up,next_up\)/);
});
test('runtime diagnostic offers a crate-off test without altering racing code',()=>{
 const s=fs.readFileSync('src/v14/main.js','utf8');
 assert.match(s,/get\('props'\)!=='off'/);
 assert.match(s,/collisionObjectName\(result\)/);
 assert.match(s,/lastContact/);
});
