"""Run in a NEW Blender process:
blender -b --factory-startup --python scripts/blender/verify_upright_guardrails.py
No user .blend file is modified. Uses project-local add-on and a temporary scene.
"""
import sys
from pathlib import Path
from mathutils import Vector
import bpy

root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'blender_addon'))
import lab5_splat_packager as addon
from lab5_splat_packager.track_builder import create_sample,update_generated_dimensions

addon.register()
scene=bpy.context.scene
scene.lab5_pack.road_width=10.0
scene.lab5_pack.guardrail_height=2.0
curve=create_sample(scene)

def z_bounds(name):
    obj=bpy.data.objects[name]
    deps=bpy.context.evaluated_depsgraph_get()
    evaluated=obj.evaluated_get(deps)
    mesh=evaluated.to_mesh()
    try:
        if not mesh or not len(mesh.vertices): raise AssertionError(name+' evaluated empty')
        zs=[(evaluated.matrix_world@v.co).z for v in mesh.vertices]
        return min(zs),max(zs)
    finally:
        evaluated.to_mesh_clear()

road=z_bounds('GEN_RoadCollision')
for name in ('GEN_InnerWall','GEN_OuterWall'):
    low,high=z_bounds(name)
    assert high > road[1]+1.5,(name,low,high,road)
    assert low > road[0]-.6,(name,low,high,road)
    print('PASS FLAT WALL RISES',name,'road',road,'wall',(low,high))

# Test raised and tilted points without altering road source objects.
points=curve.data.splines[0].bezier_points
points[1].co.z=2.0;points[1].tilt=.12
points[2].co.z=3.0;points[2].tilt=-.2
update_generated_dimensions(scene)
road=z_bounds('GEN_RoadCollision')
for name in ('GEN_InnerWall','GEN_OuterWall'):
    low,high=z_bounds(name)
    assert high > road[1]+1.0,(name,low,high,road)
    print('PASS BANKED WALL EXTENDS UP',name,'road',road,'wall',(low,high))
print('GUARDRAIL CHECKS PASSED')
