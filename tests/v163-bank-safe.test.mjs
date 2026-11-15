import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const text=readFileSync(new URL('../blender_addon/lab5_splat_packager/track_builder.py',import.meta.url),'utf8');

test('both walls use local cross section offsets and not world-up tangent offsets',()=>{
  assert.match(text,/float\(barrier_offset\), \+\.07, 0/);
  assert.match(text,/float\(barrier_offset\), -float\(height\), 0/);
  assert.doesNotMatch(text,/GeometryNodeSetPosition/);
  assert.doesNotMatch(text,/GeometryNodeInputTangent/);
  assert.doesNotMatch(text,/CROSS_PRODUCT/);
  assert.match(text,/curve\.data\.twist_mode='Z_UP'/);
});

test('repair leaves existing curve and named generated mesh objects intact',()=>{
  assert.match(text,/def _repair_generated_profiles\(scene\)/);
  assert.match(text,/mod\.node_group=_profile_geometry_nodes/);
  assert.match(text,/def update_generated_dimensions\(scene\):[\s\S]*?_repair_generated_profiles\(scene\)/);
  assert.match(text,/refresh_markers\(scene\)/);
});

test('road and wall profile alignment is invariant under climbing and banking in a shared frame',()=>{
  function norm(v){const d=Math.hypot(...v);return v.map(x=>x/d);}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function rotate(v,axis,tilt){const a=norm(axis),c=Math.cos(tilt),s=Math.sin(tilt),cx=cross(a,v),dot=a.reduce((t,x,i)=>t+x*v[i],0);return v.map((x,i)=>x*c+cx[i]*s+a[i]*dot*(1-c));}
  const w=5,delta=w*.03;
  for(const tangent of [[0,1,0],[0,.95,.31],[.75,.53,.38],[-.60,.74,-.3]]){
    const t=norm(tangent),lat0=norm([t[1],-t[0],0]);
    for(const bank of [-.24,0,.16,.30]){
      const lateral=rotate(lat0,t,bank),up=norm(cross(lateral,t));
      const roadEdge=lateral.map(x=>x*w/2);
      const wallBase=lateral.map((x,i)=>x*(w/2+delta)-up[i]*.07);
      const diff=roadEdge.map((x,i)=>x-wallBase[i]);
      assert.ok(Math.abs(Math.hypot(...diff)-Math.hypot(delta,.07))<1e-10);
    }
  }
});
