"""Blender headless integration test for Blender 5.1/5.2.

Example (PowerShell, from project root):
  & 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe' --background --factory-startup --python scripts/blender/test_adaptive_track.py

Does NOT alter the user's saved .blend or game assets.
"""
from pathlib import Path
import sys, json
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'blender_addon'))
import bpy
import lab5_splat_packager as addon
from lab5_splat_packager.track_builder import create_sample,update_generated_dimensions,ensure_curve_density
from lab5_splat_packager.exporter import _curve_proxy_walls

bpy.ops.wm.read_factory_settings(use_empty=True)
addon.register()
scene=bpy.context.scene
scene.lab5_pack.road_width=5.0
scene.lab5_pack.guardrail_height=2.0
scene.lab5_pack.guardrail_thickness=.36
curve=create_sample(scene)
# A 3D incline, bend and slight bank; importantly do not use a flat oval only.
sp=curve.data.splines[0]
sp.bezier_points[2].co.z=3
sp.bezier_points[2].tilt=.12
sp.bezier_points[3].co.z=5
sp.bezier_points[3].tilt=-.16
sp.bezier_points[4].co.z=2
for bp in sp.bezier_points:
 bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
count=update_generated_dimensions(scene)
dg=bpy.context.evaluated_depsgraph_get(); dg.update()
report={'marker_count':count,'curve_resolution':sp.resolution_u,'walls':len(_curve_proxy_walls(scene))}
for name in ['GEN_RoadVisual','GEN_RoadCollision','GEN_InnerWall','GEN_OuterWall']:
 obj=bpy.data.objects[name]
 ev=obj.evaluated_get(dg)
 mesh=ev.to_mesh()
 try:
  report[name]={'verts':len(mesh.vertices),'faces':len(mesh.polygons)}
  assert mesh.polygons and mesh.vertices, f'{name} has empty mesh'
 finally:ev.to_mesh_clear()
assert report['curve_resolution']>=24
assert report['walls']>=128,report
assert report['GEN_RoadCollision']['faces']>300,report
print('LAB5_BLENDER_TRACK_PASS',json.dumps(report))
addon.unregister()
