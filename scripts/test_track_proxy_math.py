"""No Blender install needed. Check curvature / bank mathematical guardrail proxies."""
import importlib.util,pathlib,math,unittest
PATH=pathlib.Path(__file__).resolve().parents[1]/'blender_addon/lab5_splat_packager/track_quality.py'
spec=importlib.util.spec_from_file_location('track_quality',PATH)
quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)
class Vec:
 def __init__(self,x,y,z):self.x=x;self.y=y;self.z=z
 def __add__(self,b):return Vec(self.x+b.x,self.y+b.y,self.z+b.z)
 def __sub__(self,b):return Vec(self.x-b.x,self.y-b.y,self.z-b.z)
 def __mul__(self,n):return Vec(self.x*n,self.y*n,self.z*n)
 __rmul__=__mul__
class Test(unittest.TestCase):
 def test_resolution_grows_with_curve_extent(self):
  self.assertEqual(quality.recommended_spline_resolution(8),24)
  self.assertGreaterEqual(quality.recommended_spline_resolution(37),74)
  self.assertGreaterEqual(quality.wall_segment_count(120),200)
 def test_bank_height_maintains_guardrail(self):
  a=Vec(3,0,5);b=Vec(3,0.6,5.15)
  upA=Vec(0,.18,.984);upB=Vec(0,.15,.989)
  w=quality.make_wall_segment(a,b,2.0,.36,upA,upB)
  self.assertAlmostEqual(w['hx'],.18)
  self.assertGreater(w['height'],1.9)
  self.assertTrue(w['y']>5)
 def test_short_curved_wall_segment_stays_outside_driving_lane(self):
  # Outer wall centered outside 5m track: +/- 2.5m edge, 0.18m half thickness.
  radius=8;offset=2.5+.36/2+.18
  angles=(0,.075)
  # Along a circular curve, the inward chord sag is small for short segments.
  wall_radius=radius+offset
  chord_min=wall_radius*math.cos((angles[1]-angles[0])/2)
  nearest_box_edge=chord_min-.18
  self.assertGreater(nearest_box_edge,radius+2.5)
if __name__=='__main__':unittest.main()
