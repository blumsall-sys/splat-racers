import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectRoadTriangles,roadQualityWarnings} from '../scripts/check-road-quality.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function mesh(tris,name='EXPORTED_GEN_RoadCollision'){
 const verts=new Float32Array(tris.flatMap(t=>t.flatMap(p=>[...p,0,1,0])));
 return {name,vertices:verts,model:new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])};
}
test('road checker detects coarse triangles, degeneracy, and upward road surface',()=>{
 const fine=mesh([[[0,0,0],[0,0,0.3],[0.4,0,0]],[[0,0,0],[0,0,0],[0,0,0]]]);
 const report=inspectRoadTriangles([fine]);
 assert.equal(report.triangles,2);
 assert.equal(report.upward,1);
 assert.equal(report.degenerate,1);
 assert.equal(report.coarse,0);
 assert(roadQualityWarnings(report).some(w=>/zero-area/.test(w)));
 const coarse=inspectRoadTriangles([mesh([[[0,0,0],[0,0,3],[2,0,0]]])]);
 assert.equal(coarse.coarse,1);
});
test('Blender GLB exporter evaluates top-only collision road, leaves visual road thick',()=>{
 const s=read('blender_addon/lab5_splat_packager/exporter.py');
 assert.match(s,/if o.name=='GEN_RoadCollision'/);
 assert.match(s,/modifier\.show_viewport=False;modifier\.show_render=False/);
 assert.match(s,/modifier\.show_viewport=viewport;modifier\.show_render=render/);
 const gen=read('blender_addon/lab5_splat_packager/track_builder.py');
 assert.match(gen,/ensure_curve_density\(curve\)/);
 assert.match(gen,/max_segment_m=\.50/);
});
test('exported guardrails sit outside the road and resample adaptively',()=>{
 const s=read('blender_addon/lab5_splat_packager/exporter.py');
 assert.match(s,/wall_segment_count\(length,\.60\)/);
 assert.match(s,/offset=half\+thickness\*\.5\+\.18/);
 assert.match(s,/make_wall_segment/);
});
test('road awareness uses four tyre probes but never applies upward lift against Ammo contact',()=>{
 const s=read('src/v14/road-support.js');
 assert.match(s,/KART_CONTACT\.wheelTrackX/);
 assert.match(s,/for\(const front of \[[-]?KART_CONTACT\.wheelAxleZ/);
 assert.match(s,/function updateKartRoadState/);
 assert.match(s,/car\.roadForce=0/);
 const main=read('src/v14/main.js');
 assert.match(main,/sampleRoadSupport\(app\.systems\.rigidbody,car,pc\.Vec3\)/);
 assert.match(main,/driveRaycastVehicle\(car,input,dt,pc\)/);
 assert(!main.includes('applyRoadSupport(app.systems.rigidbody'));
});
