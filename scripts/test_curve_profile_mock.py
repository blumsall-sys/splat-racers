"""Run with system Python (no Blender) to test Geometry Nodes wiring and profile offsets.

This structural test does NOT replace evaluating Geometry Nodes inside Blender.
"""
import importlib.util, sys, types, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
package=types.ModuleType('lab5_splat_packager'); package.__path__=[]
sys.modules['lab5_splat_packager']=package
bpy=types.ModuleType('bpy');mathutils=types.ModuleType('mathutils')
mathutils.Vector=lambda x:x
sys.modules['bpy']=bpy;sys.modules['mathutils']=mathutils
exp=types.ModuleType('lab5_splat_packager.exporter');exp.COLS=()
sys.modules[exp.__name__]=exp
class Socket:
 def __init__(self,n):self.name=n;self.default_value=None
class Sockets:
 def __init__(self):self.data={}
 def __getitem__(self,k):
  if k not in self.data:self.data[k]=Socket(k)
  return self.data[k]
 def __contains__(self,k):return True
class Node:
 def __init__(self,typ):self.bl_idname=typ;self.inputs=Sockets();self.outputs=Sockets();self.operation='';self.mode=''
class Nodes(list):
 def new(self,typ):
  n=Node(typ);self.append(n);return n
class Links(list):
 def new(self,o,i):self.append((o,i))
class Interface:
 def new_socket(self,**k):pass
class Group:
 def __init__(self):self.nodes=Nodes();self.links=Links();self.interface=Interface()
class NodeGroups:
 def new(self,name,typ):return Group()
bpy.data=types.SimpleNamespace(node_groups=NodeGroups())
qspec=importlib.util.spec_from_file_location('lab5_splat_packager.track_quality',ROOT/'blender_addon/lab5_splat_packager/track_quality.py')
q=importlib.util.module_from_spec(qspec);sys.modules[qspec.name]=q;qspec.loader.exec_module(q)
spec=importlib.util.spec_from_file_location('lab5_splat_packager.track_builder',ROOT/'blender_addon/lab5_splat_packager/track_builder.py')
tb=importlib.util.module_from_spec(spec);sys.modules[spec.name]=tb;spec.loader.exec_module(tb)
class TestSweeps(unittest.TestCase):
 def test_shared_curve_and_profiles(self):
  curve=object();width=6.
  for offset in (None,-width*.53,width*.53):
   g=tb._profile_geometry_nodes(curve,'test',width,offset,.85,material='mat')
   self.assertNotIn('GeometryNodeSetPosition',[n.bl_idname for n in g.nodes])
   self.assertNotIn('GeometryNodeInputTangent',[n.bl_idname for n in g.nodes])
   self.assertNotIn('ShaderNodeVectorMath',[n.bl_idname for n in g.nodes])
   info=next(n for n in g.nodes if n.bl_idname=='GeometryNodeObjectInfo')
   self.assertIs(info.inputs['Object'].default_value,curve)
   profile=next(n for n in g.nodes if n.bl_idname=='GeometryNodeCurvePrimitiveLine')
   a=profile.inputs['Start'].default_value;b=profile.inputs['End'].default_value
   if offset is None:
    self.assertEqual(a,(-3.,0,0));self.assertEqual(b,(3.,0,0))
   else:
    self.assertAlmostEqual(a[0],offset);self.assertAlmostEqual(b[0],offset)
    self.assertEqual(a[1],-.07);self.assertEqual(b[1],.85)
   self.assertTrue(any(l[0] is info.outputs['Geometry'] for l in g.links))
 def test_repair_exposed_on_refresh(self):
  import inspect
  source=inspect.getsource(tb.update_generated_dimensions)
  self.assertIn('_repair_generated_profiles(scene)',source)
  self.assertIn('refresh_markers(scene)',source)
if __name__=='__main__':unittest.main()
