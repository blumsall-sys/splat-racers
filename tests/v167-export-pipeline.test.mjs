import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const addon=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/__init__.py',import.meta.url),'utf8');
const exporter=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/exporter.py',import.meta.url),'utf8');
const grid=fs.readFileSync(new URL('../blender_addon/lab5_splat_packager/heightfield_grid.py',import.meta.url),'utf8');

test('the newer Ammo runtime never requires legacy road heightfield export',()=>{
 assert.match(addon,/heightfield:BoolProperty\([\s\S]{0,120}default=False/);
 assert.match(exporter,/RACE_COLLISION.*RACE_WALLS/);
 assert.match(exporter,/choose_grid\(/);
 assert.doesNotMatch(exporter,/Collision heightfield .* too large/);
 assert.match(grid,/max_cells=25000/);
});
test('optional voxel conversion uses indoor-safe defaults and a higher initial grid size',()=>{
 assert.match(addon,/voxel_size:FloatProperty\([^\n]*default=0\.5/);
 assert.match(addon,/voxel_fill_mode:EnumProperty\(/);
 assert.match(addon,/default='NONE'/);
 assert.match(addon,/if props\.voxel_fill_mode=='INTERIOR'/);
 assert.match(addon,/elif props\.voxel_fill_mode=='OUTDOOR'/);
 assert.match(addon,/args\.append\('--voxel-floor-fill'\)/);
 assert.match(addon,/args\.append\('--voxel-external-fill'\)/);
});
test('direct SuperSplat SOG is a valid visual asset, and may serve as voxel source',()=>{
 assert.match(addon,/voxel_source_sog:BoolProperty/);
 assert.match(addon,/os\.path\.isfile\(existing_sog\)/);
 assert.match(addon,/SuperSplat SOG can be used DIRECTLY/);
 assert.match(exporter,/\(props\.sog_file,'sog','track\.sog'\)/);
});
test('SOG remains available when voxelization fails and logs are easy to open',()=>{
 assert.match(addon,/existing SOG is retained/);
 assert.match(addon,/class LAB5_OT_open_conversion_log/);
 assert.match(addon,/conversion_error:StringProperty/);
 assert.match(addon,/--no-tty/);
 assert.match(addon,/--memory/);
 assert.match(addon,/layout\.operator\('lab5_race\.open_conversion_log'/);
});
