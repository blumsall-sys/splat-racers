"""Export editable Blender RACE_* collections to browser-ready assets/track.json.

Scripting -> open this script -> Run Script. The result is an editable JSON sidecar,
NOT a .blend conversion. Existing Physics Rig Builder / Walkthrough add-ons untouched.
Blender X,-Y,Z -> browser X,Z,Y (the browser vertical axis is game Y).
"""
import bpy, json, os, math, sys
from mathutils import Vector

def arg(name, default=None):
    if '--' in sys.argv:
        args=sys.argv[sys.argv.index('--')+1:]
        if name in args and args.index(name)+1<len(args): return args[args.index(name)+1]
    return default

def script_location():
    t=getattr(bpy.context.space_data,'text',None)
    return bpy.path.abspath(t.filepath) if t and t.filepath else globals().get('__file__', os.path.join(os.getcwd(),'export_race_track.py'))

base=os.path.normpath(os.path.join(os.path.dirname(script_location()),'..','..'))
source=arg('--template',os.path.join(base,'assets','track.json'))
output=arg('--out',os.path.join(base,'assets','track.json'))
with open(source,'r',encoding='utf8') as f: track=json.load(f)

def objects(name):
    col=bpy.data.collections.get(name)
    if not col:raise RuntimeError('Missing collection '+name+'; run create_training_circuit.py first')
    return sorted(col.objects,key=lambda o:o.name)

def planar(o):
    p=o.matrix_world.translation
    return {'x':round(float(p.x),5),'z':round(float(-p.y),5)}

def box(o):
    if o.type!='MESH':raise RuntimeError('Only mesh cubes allowed in collision/visual collections: '+o.name)
    rot=o.matrix_world.to_euler('XYZ')
    if abs(rot.x)>1e-4 or abs(rot.y)>1e-4:raise RuntimeError(o.name+' is pitched/rolled. Apply only Z-axis yaw to boxes; ramps need heightfield.')
    bounds=[Vector(v) for v in o.bound_box]
    scales=o.matrix_world.to_scale()
    dims=[(max(v[i] for v in bounds)-min(v[i] for v in bounds))*abs(scales[i]) for i in range(3)]
    centre=o.matrix_world@Vector(tuple((max(v[i] for v in bounds)+min(v[i] for v in bounds))/2 for i in range(3)))
    return {'x':round(float(centre.x),5),'z':round(float(-centre.y),5),'y':round(float(centre.z),5),
      'w':round(float(dims[0]),5),'d':round(float(dims[1]),5),'h':round(float(dims[2]),5),
      'yaw':round(float(rot.z),6)}

walls=[]
for o in objects('RACE_WALLS'):
    p=box(o)
    if min(p['w'],p['d'],p['h'])<=.001:raise RuntimeError('Zero-thickness wall '+o.name)
    walls.append({'id':o.name,'x':p['x'],'z':p['z'],'hx':p['w']/2,'hz':p['d']/2,'yaw':p['yaw'],'height':p['h'],'y':p['y']})
track['collision']['walls']=walls
track['visuals']={'mode':'boxes','boxes':[]}
for o in objects('RACE_VISUALS'):
    p=box(o)
    track['visuals']['boxes'].append({**p,'color':'#697f75','id':o.name})
markers=objects('RACE_WAYPOINTS')
if len(markers)<8:raise RuntimeError('Need >=8 WP_### marker empties')
track['race']['waypoints']=[planar(o) for o in markers]
group={o.name:o for o in objects('RACE_GATES')}
pairs=[]
for name in group:
    if name.endswith('_A'):
        baseName=name[:-2];b=group.get(baseName+'_B')
        if b is None:raise RuntimeError('Missing gate endpoint '+baseName+'_B')
        pairs.append((baseName,group[name],b))
pairs.sort(key=lambda g:(0 if g[0]=='GATE_START' else 1,g[0]))
if len(pairs)<3:raise RuntimeError('Need START gate and >=2 directional checkpoints')
track['race']['gates']=[{'id':a[0].replace('GATE_',''), 'a':planar(a[1]),'b':planar(a[2])} for a in pairs]
sp={o.name:o for o in objects('RACE_SPAWNS')}
for id in ('p1','p2'):
    o=sp.get('SPAWN_'+id.upper())
    if not o:raise RuntimeError('Missing SPAWN_'+id.upper())
    track['spawns'][id]={**planar(o),'yaw':round(float(o.matrix_world.to_euler('XYZ').z),6)}
try:
    props=objects('RACE_DYNAMIC')
    track['collision']['obstacles']=[]
    for o in props:
        p=box(o)
        track['collision']['obstacles'].append({'id':o.name.removeprefix('DYN_'),'x':p['x'],'z':p['z'],'yaw':p['yaw'],'hx':p['w']/2,'hz':p['d']/2,'mass':45,'color':'#eac783'})
except RuntimeError:pass
# If you added heightfield overlay already, keep it unless explicitly removed.
os.makedirs(os.path.dirname(os.path.abspath(output)),exist_ok=True)
with open(output,'w',encoding='utf8') as f:json.dump(track,f,indent=2)
print('SPLAT RACERS: exported',output,'(',len(walls),'walls,',len(markers),'waypoints,',len(pairs),'gates)')
