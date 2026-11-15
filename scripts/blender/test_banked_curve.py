"""Blender 5.2+ integration smoke test for LAB5's banked Geometry Nodes track.

Windows example (PowerShell, from project directory):
  & 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe' -b --factory-startup --python scripts/blender/test_banked_curve.py

Creates a temporary scene in memory; does NOT save or alter the artist's .blend.
"""
import os,sys
from pathlib import Path
import bpy
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'blender_addon'))
import lab5_splat_packager as addon
from lab5_splat_packager.track_builder import create_sample,update_generated_dimensions,_samples_with_frames

addon.register()
try:
    scene=bpy.context.scene
    scene.lab5_pack.road_width=5.0
    curve=create_sample(scene)
    spline=curve.data.splines[0]
    spline.bezier_points[2].co.z=3.0
    spline.bezier_points[3].co.z=2.0
    spline.bezier_points[4].tilt=.18
    spline.bezier_points[5].tilt=-.15
    bpy.context.view_layer.update()
    n=update_generated_dimensions(scene)
    assert n==32
    depsgraph=bpy.context.evaluated_depsgraph_get()
    positions={}
    for name in ('GEN_RoadVisual','GEN_RoadCollision','GEN_InnerWall','GEN_OuterWall'):
        obj=bpy.data.objects[name]
        ev=obj.evaluated_get(depsgraph)
        mesh=ev.to_mesh()
        try:
            assert mesh is not None and len(mesh.polygons)>16, (name,'not enough faces')
            coords=[obj.matrix_world@v.co for v in mesh.vertices]
            lo=min(v.z for v in coords);hi=max(v.z for v in coords)
            assert hi-lo>1.0, (name,'did not follow the hill',lo,hi)
            positions[name]=coords
            print('PASS',name,'faces',len(mesh.polygons),'z interval',round(lo,2),round(hi,2))
        finally:
            ev.to_mesh_clear()
    # Local swept profiles should remain within a small distance of the road's
    # edge even over the tallest segment and a bank transition.
    from mathutils.kdtree import KDTree
    road=positions['GEN_RoadVisual']
    kdt=KDTree(len(road))
    for i,pos in enumerate(road):kdt.insert(pos,i)
    kdt.balance()
    for name in ('GEN_InnerWall','GEN_OuterWall'):
        wall=positions[name]
        distances=sorted(kdt.find(p)[2] for p in wall)
        close=sum(d<.5 for d in distances)
        # Each wall includes a top edge, which is naturally farther from road.
        assert close>12,(name,'wall base did not follow the road edge',close)
        print('PASS',name,'wall vertices near road:',close)
    print('SUCCESS: banked 3D curve created, barriers move vertically with road, 32 waypoints refreshed')
finally:
    addon.unregister()
