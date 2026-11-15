import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('read-only Blender driveability operator is registered and uses actual centerline',()=>{
 const src=read('blender_addon/lab5_splat_packager/__init__.py');
 assert.match(src,/class LAB5_OT_check_driveability\(bpy\.types\.Operator\)/);
 assert.match(src,/LAB5_OT_guardrail_safe,LAB5_OT_check_driveability,LAB5_OT_validate/);
 assert.match(src,/from \.driveability import analyze_samples/);
 assert.match(src,/layout\.operator\('lab5_race\.check_driveability'/);
 assert.match(src,/\((?:1,4,[01234]|2,0,0|2,1,0|2,2,0|2,3,0)\)/);
});
test('existing KIRI / SOG alignment, geometry exporter, and controls remain intact',()=>{
 const addon=read('blender_addon/lab5_splat_packager/__init__.py');
 for(const api of ['lab5_race.export_pack','lab5_race.convert_sog','lab5_race.raise_guardrails','lab5_race.refresh_markers','lab5_race.check_driveability']) assert(addon.includes(api));
 const road=read('src/v14/pc-scene.js');
 assert.match(road,/friction:\.40,restitution:\.64,linearDamping:\.10,angularDamping:\.34/);
 assert.match(road,/createRaycastVehicle\(app,chassis,ammo(?:,T)?\)/);
 assert.match(road,/cam\.__lab5AimY/);
});
