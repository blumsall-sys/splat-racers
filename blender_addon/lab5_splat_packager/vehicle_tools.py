"""Non-destructive Blender vehicle catalogue: editable native meshes, GLB-friendly PBR.
A VEHICLE_* Empty owns parts. Kart wheel meshes are tagged and exported as a
separate local-origin GLB so Bullet can animate all four wheel instances.
"""
import bpy
from mathutils import Vector
from .schema import clean_id

VEHICLE_COLLECTION='RACE_VEHICLES'
KINDS=('KART','HOVER','DRONE')

def ensure_collection(scene):
    coll=bpy.data.collections.get(VEHICLE_COLLECTION)
    if coll is None:
        coll=bpy.data.collections.new(VEHICLE_COLLECTION)
        (bpy.data.collections.get('RACE_TRACK') or scene.collection).children.link(coll)
    return coll

def materials(name,rgb,roughness=.48,metallic=0):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color=(*rgb,1)
    m.use_nodes=True
    node=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if node:
        node.inputs['Base Color'].default_value=(*rgb,1)
        node.inputs['Roughness'].default_value=roughness
        node.inputs['Metallic'].default_value=metallic
    return m

def _move_collection(obj,coll):
    if coll not in obj.users_collection:coll.objects.link(obj)
    for old in list(obj.users_collection):
        if old!=coll:old.objects.unlink(obj)

def roots():
    coll=bpy.data.collections.get(VEHICLE_COLLECTION)
    return sorted((o for o in coll.objects if o.type=='EMPTY' and o.get('lab5_vehicle_root')),key=lambda o:o.name) if coll else []

def vehicle_parts(root):
    return [o for o in root.children_recursive if o.type=='MESH' and not o.hide_get() and not o.get('lab5_vehicle_collider')]

def create_vehicle(context,kind='KART',name='Prototype'):
    if kind not in KINDS:raise ValueError('Invalid vehicle type')
    scene=context.scene;coll=ensure_collection(scene)
    base=clean_id(name or kind).replace('-','_')
    used={r.get('lab5_vehicle_id') for r in roots()}
    slug=base;index=2
    while slug in used:slug=f'{base}_{index}';index+=1
    root=bpy.data.objects.new('VEHICLE_'+slug,None);coll.objects.link(root)
    root.empty_display_type='CUBE';root.empty_display_size=.65
    root.location=context.scene.cursor.location.copy()
    root['lab5_vehicle_root']=True;root['lab5_vehicle_id']=slug
    root['lab5_vehicle_label']=name or kind.title()
    root['lab5_vehicle_type']=kind
    root['lab5_vehicle_mass']=170.0 if kind=='KART' else (140.0 if kind=='HOVER' else 70.0)
    root['lab5_vehicle_jump_speed']=5.5
    root['lab5_vehicle_hover_height']=2.45
    root['lab5_vehicle_hover_hop_interval']=0.78
    root['lab5_vehicle_hover_hop_step']=3.0
    root['lab5_vehicle_max_speed']=12.5  # shared competition cap for all three classes
    root['lab5_vehicle_acceleration']=4.5 if kind=='HOVER' else (4.0 if kind=='DRONE' else 4.0)
    root['lab5_vehicle_stability_assist']=1.0
    root['lab5_vehicle_auto_right_seconds']=2.6
    paint=materials(f'LAB5 {slug} Car Paint',(.44,.85,.28),.38,.12)
    contrast=materials(f'LAB5 {slug} Car Accent',(.07,.11,.14),.48,.22)
    glass=materials(f'LAB5 {slug} Windshield',(.40,.78,.89),.19,.07)
    tire=materials(f'LAB5 {slug} Tire Rubber',(.045,.055,.07),.92,.01)
    metal=materials(f'LAB5 {slug} Vehicle Metal',(.65,.7,.76),.28,.65)
    glow=materials(f'LAB5 {slug} Rotor Glow',(.25,.83,.93),.25,.1)
    def part(label,primitive,pos,scale,mat,rot=None,wheel=False):
        if primitive=='BOX':bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,0))
        elif primitive=='SPHERE':bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,location=(0,0,0))
        elif primitive=='CYL':bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.5,depth=1,location=(0,0,0))
        elif primitive=='TORUS':bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=8,location=(0,0,0))
        ob=context.object;ob.name=root.name+'_'+label
        _move_collection(ob,coll)
        ob.parent=root
        ob.location=pos
        ob.scale=scale
        if rot:ob.rotation_euler=rot
        ob.data.materials.append(mat)
        ob['lab5_vehicle_part']=True
        if wheel:ob['lab5_vehicle_wheel']=True
        return ob
    if kind=='KART':
        part('Chassis','BOX',(0,0,.10),(1.48,1.80,.48),paint)
        part('Roof','BOX',(0,.12,.51),(1.00,.80,.38),glass)
        part('Front_Bumper','BOX',(0,-.94,-.12),(1.63,.16,.22),contrast)
        part('Rear_Bumper','BOX',(0,.94,-.12),(1.63,.16,.20),contrast)
        part('Hood_Stripe','BOX',(0,-.60,.37),(.32,.54,.018),metal)
        for side in (-1,1):
            for aft in (-1,1):
                # Blender front=-Y -> PlayCanvas front=+Z.
                ob=part(('FRONT' if aft<0 else 'REAR')+('_L' if side<0 else '_R')+'_Wheel',
                   'CYL',(side*.79,aft*.75,-.08),(.62,.23,.62),tire,rot=(0,1.57079632679,0),wheel=True)
    elif kind=='HOVER':
        part('Hull','SPHERE',(0,0,.18),(1.75,2.32,.63),paint)
        part('Canopy','SPHERE',(0,-.12,.59),(.93,1.10,.43),glass)
        for side in (-1,1):
            part('Thruster_'+str(side),'CYL',(side*.90,.40,-.12),(.58,.75,.45),metal,rot=(1.57079632679,0,0))
            part('Skid_'+str(side),'BOX',(side*.79,0,-.21),(.30,1.90,.20),contrast)
        part('Emitter','TORUS',(0,0,-.18),(1.22,1.7,.16),glow)
    else:
        part('Core','BOX',(0,0,0),(.85,.96,.32),paint)
        part('Dome','SPHERE',(0,-.16,.28),(.62,.64,.33),glass)
        for x in (-.92,.92):
            for y in (-.92,.92):
                part('Arm_'+str(x)+'_'+str(y),'BOX',(x*.52,y*.52,.03),(1.45,.15,.11),metal,rot=(0,0,0.7854 if x*y<0 else -.7854))
                part('Rotor_'+str(x)+'_'+str(y),'TORUS',(x,y,.13),(.51,.51,.08),glow)
                part('Hub_'+str(x)+'_'+str(y),'CYL',(x,y,.12),(.19,.19,.13),contrast)
    proxy=part('Physics_Collider','BOX',(0,0,0),
        (1.98,1.92,.48) if kind=='KART' else ((1.75,2.15,.66) if kind=='HOVER' else (1.34,1.34,.54)),contrast)
    proxy['lab5_vehicle_collider']=True
    proxy.display_type='WIRE';proxy.hide_render=True
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True);context.view_layer.objects.active=root
    return root
