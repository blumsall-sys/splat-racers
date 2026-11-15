import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src = readFileSync(new URL('../blender_addon/lab5_splat_packager/track_builder.py',import.meta.url),'utf8');
test('curve rails extend up from a banked deck rather than down',()=>{
  assert.match(src,/profile\.inputs\['Start'\]\.default_value=\(float\(barrier_offset\), \+\.07, 0\)/);
  assert.match(src,/profile\.inputs\['End'\]\.default_value=\(float\(barrier_offset\), -float\(height\), 0\)/);
  assert.match(src,/profile\.inputs\['Start'\]\.default_value=\(-width\/2,0,0\)/);
  assert.match(src,/profile\.inputs\['End'\]\.default_value=\( width\/2,0,0\)/);
});
test('repair operates on original curve and both generated walls',()=>{
  assert.match(src,/def _repair_generated_profiles\(scene\):/);
  assert.match(src,/\('GEN_InnerWall',-width\*\.53,wall_mat\)/);
  assert.match(src,/\('GEN_OuterWall', width\*\.53,wall_mat\)/);
  assert.match(src,/if obj is None or not obj\.get\('lab5_generated'\)/);
});
