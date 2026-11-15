"""Blender 5.x Scripting > Run Script. Makes an editable demo scene, does NOT touch addons."""
import bpy, json, os, math
from mathutils import Vector

# File relative to this script in extracted Splat Racers project.
PROJECT = os.path.normpath(os.path.join(os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()))
# Existing assets/track.json may be in same folder as this script's source parent;
# when using Blender GUI paste/edit the absolute TRACK_JSON path below if needed.
TRACK_JSON = os.environ.get('SPLAT_TRACK_JSON', '')
if not TRACK_JSON:
    script_path = getattr(bpy.context.space_data, 'text', None)
    file_path = bpy.path.abspath(script_path.filepath) if script_path and script_path.filepath else globals().get('__file__', os.path.join(os.getcwd(),'create_training_circuit.py'))
    TRACK_JSON = os.path.normpath(os.path.join(os.path.dirname(file_path), '..', '..', 'assets', 'track.json'))
with open(TRACK_JSON, 'r', encoding='utf8') as handle:
    track = json.load(handle)

# All objects live under RACE_* collections. Other artist-owned objects untouched.
def coll(name):
    found=bpy.data.collections.get(name)
    if found is None:
        found=bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(found)
    return found

def block(name,x,z,y,w,h,d,target,color):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y))
    ob=bpy.context.object;ob.name=name
    ob.dimensions=(w,d,h)  # Browser z = -Blender y, so swap dimension axes.
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for old in list(ob.users_collection): old.objects.unlink(ob)
    target.objects.link(ob)
    mat=bpy.data.materials.new(name+' Material');mat.diffuse_color=(*color,1)
    ob.data.materials.clear();ob.data.materials.append(mat)
    return ob

def marker(name,x,z,y=0,yaw=0,target=None):
    ob=bpy.data.objects.new(name,None);(target or coll('RACE_MARKERS')).objects.link(ob)
    ob.location=(x,-z,y);ob.rotation_euler.z=yaw
    ob.empty_display_type='ARROWS';ob.empty_display_size=.9
    return ob

walls=coll('RACE_WALLS');art=coll('RACE_VISUALS');way=coll('RACE_WAYPOINTS');gates=coll('RACE_GATES');spawns=coll('RACE_SPAWNS');props=coll('RACE_DYNAMIC')
for w in track['collision']['walls']:
    block(w['id'],w['x'],w['z'],.46,w['hx']*2,.92,w['hz']*2,walls,(.75,.38,.30) if w['id'].startswith('outer') else (.85,.75,.30))
# Simple floor and centre island are visual geometry; physics floor is default y=0.
block('VIS_Tarmac',0,0,-.125,35,.20,24.6,art,(.24,.28,.35))
block('VIS_Island',0,0,.025,18.9,.20,8.95,art,(.23,.50,.33))
for i,w in enumerate(track['race']['waypoints']):marker(f'WP_{i+1:03}',w['x'],w['z'],target=way)
for i,g in enumerate(track['race']['gates']):
    gid='START' if i==0 else f'{i:02}'
    marker(f'GATE_{gid}_A',g['a']['x'],g['a']['z'],target=gates)
    marker(f'GATE_{gid}_B',g['b']['x'],g['b']['z'],target=gates)
for p in ('p1','p2'):
    s=track['spawns'][p];marker(f'SPAWN_{p.upper()}',s['x'],s['z'],yaw=s['yaw'],target=spawns)
for v in track['collision'].get('obstacles',[]):
    block('DYN_'+v['id'],v['x'],v['z'],.65,v['hx']*2,1.2,v['hz']*2,props,(.85,.63,.33))
marker('TRACK_ORIGIN',0,0)
print('SPLAT RACERS: created test track; edit RACE_* collections, then run export_race_track.py')
