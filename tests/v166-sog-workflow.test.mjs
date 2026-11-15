import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const addon=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/__init__.py',import.meta.url),'utf8');
const exporter=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/exporter.py',import.meta.url),'utf8');

test('separate non-blocking SOG and optional voxel operators, with distinct log',()=>{
 assert.match(addon,/class LAB5_OT_convert_sog/);
 assert.match(addon,/class LAB5_OT_convert_voxel/);
 assert.match(addon,/subprocess\.Popen\(/);
 assert.match(addon,/bpy\.app\.timers\.register\(poll/);
 assert.match(addon,/kind=='sog'\s*else 'track\.voxel\.json'/);
 assert.doesNotMatch(addon,/subprocess\.run\(/);
});
test('voxel failure never clears previously successful SOG',()=>{
 assert.match(addon,/if kind=='sog':\s*props\.sog_file=dest/);
 assert.match(addon,/existing SOG is retained/);
 assert.match(addon,/Click Prepare New Conversion Folder/);
});
test('source Gaussian remains unchanged and world placement is explicit',()=>{
 assert.match(addon,/SOG_PLACEMENT/);
 assert.match(addon,/placement\.matrix_world=selected\.matrix_world\.copy\(\)/);
 assert.match(addon,/class LAB5_OT_sync_sog_placement/);
 assert.match(exporter,/C @ anchor\.evaluated_get\(bpy\.context\.evaluated_depsgraph_get\(\)\)\.matrix_world/);
 assert.match(exporter,/if props\.sog_source_is_aligned else/);
});
test('browser calibration preserved when SOG and anchor unchanged, reset on changed identity or explicit request',()=>{
 assert.match(addon,/reset_browser_calibration:BoolProperty/);
 assert.match(addon,/reset_browser_calibration:BoolProperty\([^\n]*default=False/);
 assert.match(exporter,/if props\.reset_browser_calibration or changed_sog/);
 assert.match(exporter,/old_anchor != new_anchor/);
 assert.match(exporter,/\('splat-alignment\.json',\{/);
 assert.match(exporter,/shutil\.copy2\(target,target\+'\.backup-'\+stamp\)/);
});
