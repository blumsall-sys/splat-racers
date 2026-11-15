bl_info = {
    'name':'LAB5 Splat Racers — Curve Track + Asset Packager',
    'author':'LAB5 / OpenAI',
    'version':(2,3,0),
    'blender':(4,3,0),
    'location':'View3D > Sidebar (N) > LAB5 Race',
    'description':'v2.3.0 adds flight-NPC course driveability warnings and keeps authored rings editable',
    'category':'Import-Export'
}
import bpy,os,subprocess,shutil,datetime,json,pathlib
from bpy.props import StringProperty,BoolProperty,FloatProperty,PointerProperty,EnumProperty,IntProperty
from .exporter import validate_scene,export_bundle,COLS,_verify_bundled_sog,_sha256_file
from .track_builder import create_sample,refresh_markers,refresh_air_gates,update_generated_dimensions,_repair_generated_profiles
from .vehicle_tools import create_vehicle,roots

class LAB5_PackProperties(bpy.types.PropertyGroup):
    vehicle_kind:EnumProperty(name='Vehicle base',items=[('KART','Kart','4-wheel raycast kart'),('HOVER','Hovercraft','Ray-suspended racer'),('DRONE','Drone','Full three-dimensional flying racer')],default='KART')
    vehicle_name:StringProperty(name='New vehicle name',default='Custom Racer')
    air_gate_count:IntProperty(name='Flight rings',default=8,min=0,max=64)
    air_gate_start_offset_percent:FloatProperty(name='Flight rings start offset (%)',default=4.0,min=0,max=99.9,precision=2,description='Nominal position along TRACK_Centerline after the start line. Minimum forward clearance is also enforced so ring 1 cannot appear behind the grid.')
    air_gate_min_start_clearance:FloatProperty(name='First ring minimum clearance (m)',default=8.0,min=0,max=100,precision=2,description='Minimum centreline distance from the START/FINISH line to flight ring 1; automatically also respects ring radius. Move AIR_OFFSET_00 to make further artistic adjustments.')
    air_gate_height:FloatProperty(name='Flight gate above road (m)',default=2.45,min=.5,max=30)
    air_ring_radius:FloatProperty(name='Flight ring base radius (m)',default=1.85,min=.6,max=10)
    air_ring_auto_scale:BoolProperty(name='Scale rings with road width',default=True,description='Automatically scale flight ring radius relative to Reference road width, while preserving authored per-ring offset and scale edits')
    air_ring_reference_width:FloatProperty(name='Reference road width (m)',default=2.5,min=2.5,max=20,description='Width at which the base ring radius is used; for a 10m-wide road at a 5m reference, the radius doubles')
    level_type:EnumProperty(name='Level type',items=[('RACE','Lap race','Waypoints, gates and track barriers'),('FREE_ROAM','Open world / free drive','Ground and freely placed colliders; no required lap gates')],default='RACE')
    proxy_shape:EnumProperty(name='Collision shape',items=[('BOX','Box','Fast solid box'),('SPHERE','Sphere','Fast spherical collider')],default='BOX')
    proxy_body:EnumProperty(name='Body',items=[('STATIC','Static','Environment (immovable)'),('DYNAMIC','Dynamic','Physical movable rigid body')],default='STATIC')
    proxy_drivable:BoolProperty(name='Drivable ground',default=False,description='Tag this static proxy as a wheel-contact surface (for floor / ground proxies only)')
    proxy_size:FloatProperty(name='New ground size (m)',default=60,min=2,max=10000)
    game_root:StringProperty(name='Game root',subtype='DIR_PATH',description='Root of the extracted Splat Racers v2.2.0 project')
    pack_id:StringProperty(name='Pack ID',default='my-race-track')
    splat_ply:StringProperty(name='Gaussian PLY',subtype='FILE_PATH',description='Optional edited real Gaussian PLY for conversion; not deployed')
    sog_file:StringProperty(name='SOG file',subtype='FILE_PATH',description='Optional preconverted .sog, copied into export')
    sog_source_is_aligned:BoolProperty(name='Source PLY/SOG is already aligned',default=False,description='Only enable if you adjusted coordinates in SuperSplat/source PLY itself, not merely the Blender object. Avoid double placement transforms.')
    splat_alignment_object:PointerProperty(name='SOG alignment object',type=bpy.types.Object,description='Object whose World transform locates and scales the unbaked Gaussian PLY/SOG. Explicit choice overrides SPLAT_ANCHOR. If transforms already baked into SOG, leave empty and use identity SPLAT_ANCHOR.')
    allow_no_sog_export:BoolProperty(name='Allow export without Gaussian SOG',default=False,description='Explicit opt-in: only for dummy geometry test levels. Otherwise missing SOG blocks export to prevent a blank manifest.')
    allow_clear_sog:BoolProperty(name='Explicitly remove SOG on next export',default=False,description='OFF by default: prevents an empty SOG path from deleting a previously working splat reference.')
    reset_browser_calibration:BoolProperty(name='EXPLICITLY reset browser SOG fine tuning',default=False,description='OFF by default. Keep existing assets/splat-alignment.json across Blender exports. Enable ONLY when changing to a different already-aligned source SOG to avoid double transforms.')
    conversion_stage:StringProperty(name='Conversion status',default='Idle')
    conversion_log:StringProperty(name='Conversion log',subtype='FILE_PATH')
    prepared_folder:StringProperty(name='Prepared outputs directory',subtype='DIR_PATH')
    link_kiri_preview:BoolProperty(name='Parent selected KIRI preview to Empty',default=False,description='Opt in only if the selected KIRI object has no managed parent; keeps current world pose while parenting to the placement Empty')
    voxel_json:StringProperty(name='Voxel JSON',subtype='FILE_PATH')
    voxel_bin:StringProperty(name='Voxel BIN',subtype='FILE_PATH')
    voxel_collision_glb:StringProperty(name='Voxel collision GLB',subtype='FILE_PATH')
    voxel_fill_mode:EnumProperty(name='Voxel fill strategy',description='Choose based on the scan; never silently floor-fill an indoor room',items=[('NONE','No fill (recommended initial test)','Raw voxel output only'),('INTERIOR','Interior shell seal','Optional --voxel-external-fill for a room'),('OUTDOOR','Outdoor floor fill','Optional --voxel-floor-fill for landscape scans')],default='NONE')
    voxel_source_sog:BoolProperty(name='Use existing SOG for voxel input',default=True,description='If supplied, SOG can be read directly; does not require re-compressing the original large PLY')
    conversion_error:StringProperty(name='Last conversion detail',default='')
    heightfield:BoolProperty(name='Sample legacy 2.5D heightfield (OPTIONAL)',default=False,
        description='Not needed in PlayCanvas/Ammo mode: physical road uses RACE_COLLISION GLB. If enabled, adapt grid resolution to stay under safe limit.')
    heightfield_note:StringProperty(name='Heightfield export note',default='Disabled (recommended): static road GLB supplies collision')
    cell_size:FloatProperty(name='Height cell (m)',default=0.5,min=0.1,max=5,precision=2)
    voxel_size:FloatProperty(name='Voxel cell (m)',default=0.5,min=0.05,max=2,precision=2)
    road_width:FloatProperty(name='Road width (m)',default=5.0,min=2.5,max=20,precision=2)
    force_curve_road_uv:BoolProperty(name='Generate curve-following RoadUV',default=True,description='For generated GEN_RoadVisual only: road width U and distance-along-track V on export copy; does not change Blender source mesh')
    road_uv_repeat_length:FloatProperty(name='Road texture repeat (m)',default=10.0,min=.5,max=100,precision=2,description='Lengthwise metres per full image repeat. For width 5m, 10m preserves a 3.6 x 7.2 texture aspect ratio.')
    render_exposure:FloatProperty(name='PlayCanvas exposure',default=1.0,min=.3,max=3,precision=2)
    render_fog_distance:FloatProperty(name='Fog end distance (0=off)',default=0.0,min=0,max=5000,precision=1)
    render_environment_atlas:StringProperty(name='Prefiltered environment atlas',subtype='FILE_PATH',description='Optional prefiltered PlayCanvas .ktx/.ktx2 atlas; raw HDRIs require external prefiltering first')
    guardrail_height:FloatProperty(name='Guardrail height (m)',default=2.0,min=.45,max=4.,precision=2)
    start_percent:FloatProperty(name='Start / finish on curve (%)',default=0.0,min=0.0,max=99.9,precision=1,description='Place the checkerboard, first gate, and grid at this percentage of the closed Bézier circuit; Refresh after editing')
    guardrail_thickness:FloatProperty(name='Guardrail thickness (m)',default=.36,min=.08,max=2.,precision=2)
    driveability_note:StringProperty(name='Track preflight',default='Not checked')
    track_curve:PointerProperty(name='Editable centreline',type=bpy.types.Object,description='Curve used to regenerate the road, barriers and race markers')
    target_collection:EnumProperty(name='Assign to',items=[
        ('RACE_VISUALS','Visible mesh',''),('RACE_COLLISION','Road mesh collision',''),
        ('RACE_WALLS','Wall proxy',''),('RACE_DYNAMIC','Dynamic rigid body','')])

class LAB5_OT_assign(bpy.types.Operator):
    bl_idname='lab5_race.assign_collection';bl_label='Move selected meshes into Race collection';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        selection=[o for o in context.selected_objects if o.type=='MESH']
        if not selection:self.report({'ERROR'},'Select at least one mesh');return {'CANCELLED'}
        name=context.scene.lab5_pack.target_collection
        c=bpy.data.collections.get(name)
        if not c:c=bpy.data.collections.new(name);context.scene.collection.children.link(c)
        for o in selection:
            if c not in o.users_collection:c.objects.link(o)
            for old in list(o.users_collection):
                if old!=c and old.name.startswith('RACE_'):old.objects.unlink(o)
            if name=='RACE_DYNAMIC' and not o.rigid_body:
                bpy.context.view_layer.objects.active=o
                bpy.ops.rigidbody.object_add()
                o.rigid_body.type='ACTIVE';o.rigid_body.collision_shape='BOX'
        self.report({'INFO'},f'Assigned {len(selection)} meshes to {name}');return {'FINISHED'}

def _ensure_race_collection(context,name):
    c=bpy.data.collections.get(name)
    if not c:
        c=bpy.data.collections.new(name)
        owner=bpy.data.collections.get('RACE_TRACK') or context.scene.collection
        owner.children.link(c)
    return c

def _place_proxy(context,obj,shape,body,drivable=False):
    name='RACE_PROXY_'+body
    coll=_ensure_race_collection(context,name)
    if coll not in obj.users_collection:coll.objects.link(obj)
    for old in list(obj.users_collection):
        if old!=coll and old.name.startswith('RACE_'):old.objects.unlink(obj)
    obj['lab5_collider_shape']=shape
    obj['lab5_drivable']=bool(drivable and body=='STATIC')
    obj.display_type='WIRE'
    obj.hide_render=True  # exported as JSON instead of GLB geometry
    # Existing rigidbodies are metadata only, not Blender simulation setup.
    return obj

class LAB5_OT_create_ground(bpy.types.Operator):
    bl_idname='lab5_race.create_collision_ground';bl_label='Add Editable Ground Mesh';bl_options={'REGISTER','UNDO'}
    bl_description='Create a thin static triangle-mesh floor in RACE_COLLISION; resize/edit mesh to approximate the splat ground.'
    def execute(self,context):
        size=context.scene.lab5_pack.proxy_size
        cursor=context.scene.cursor.location.copy()
        bpy.ops.mesh.primitive_cube_add(size=1,location=(cursor.x,cursor.y,cursor.z-.15))
        ob=context.object;ob.name='GROUND_DrivableCollision'
        ob.scale=(size,size,.30)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        coll=_ensure_race_collection(context,'RACE_COLLISION')
        if coll not in ob.users_collection:coll.objects.link(ob)
        for old in list(ob.users_collection):
            if old!=coll and old.name.startswith('RACE_'):old.objects.unlink(ob)
        ob.display_type='WIRE'
        self.report({'INFO'},'Created invisible-in-game drivable mesh. Edit vertices/top to fit actual terrain; move spawns onto it.')
        return {'FINISHED'}

class LAB5_OT_create_proxy(bpy.types.Operator):
    bl_idname='lab5_race.create_primitive_collider';bl_label='Add Box / Sphere Collider';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.lab5_pack
        if p.proxy_shape=='SPHERE':bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=context.scene.cursor.location)
        else:bpy.ops.mesh.primitive_cube_add(size=1,location=context.scene.cursor.location)
        obj=context.object;obj.name=('STATIC_' if p.proxy_body=='STATIC' else 'DYNAMIC_')+p.proxy_shape+'_Collider'
        _place_proxy(context,obj,p.proxy_shape,p.proxy_body,p.proxy_drivable)
        self.report({'INFO'},'Proxy is editable wireframe in Blender and exports as a PlayCanvas/Ammo primitive.')
        return {'FINISHED'}

class LAB5_OT_assign_proxy(bpy.types.Operator):
    bl_idname='lab5_race.assign_primitive_collider';bl_label='Convert Selection to Box / Sphere Colliders';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.lab5_pack
        selection=[o for o in context.selected_objects if o.type=='MESH']
        if not selection:self.report({'ERROR'},'Select mesh objects first');return {'CANCELLED'}
        for obj in selection:_place_proxy(context,obj,p.proxy_shape,p.proxy_body,p.proxy_drivable)
        self.report({'INFO'},f'Assigned {len(selection)} editable primitive colliders')
        return {'FINISHED'}

class LAB5_OT_create_spawns(bpy.types.Operator):
    bl_idname='lab5_race.create_free_spawns';bl_label='Create / Place Free Drive Spawns';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        coll=_ensure_race_collection(context,'RACE_SPAWNS')
        for index,name in enumerate(('SPAWN_P1','SPAWN_P2','SPAWN_P3','SPAWN_P4')):
            if bpy.data.objects.get(name):continue
            o=bpy.data.objects.new(name,None);coll.objects.link(o)
            o.empty_display_type='ARROWS';o.empty_display_size=1.2
            o.location=context.scene.cursor.location.copy();o.location.x+=(index%2)*2.5;o.location.y-=(index//2)*3.0
        self.report({'INFO'},'Place all four spawns on top of the drivable collider and export')
        return {'FINISHED'}

class LAB5_OT_new_vehicle(bpy.types.Operator):
    bl_idname='lab5_race.generate_vehicle';bl_label='Generate Editable Vehicle';bl_options={'REGISTER','UNDO'}
    bl_description='Generate a modular kart/hovercraft/drone model from native Blender meshes and editable Principled BSDF materials'
    def execute(self,context):
        p=context.scene.lab5_pack
        try:root=create_vehicle(context,p.vehicle_kind,p.vehicle_name)
        except Exception as exc:
            self.report({'ERROR'},'Vehicle generation failed: '+str(exc));return {'CANCELLED'}
        self.report({'INFO'},root.name+' generated. Expand VEHICLE root, edit meshes/materials; export Asset Pack when ready.')
        return {'FINISHED'}

class LAB5_OT_refresh_air(bpy.types.Operator):
    bl_idname='lab5_race.refresh_air_gates';bl_label='Refresh Flight Rings From Road Curve';bl_options={'REGISTER','UNDO'}
    bl_description='Position flight rings from the same TRACK_Centerline; preserves each AIR_OFFSET local edits'
    def execute(self,context):
        try:count=refresh_air_gates(context.scene)
        except Exception as exc:
            self.report({'ERROR'},'Flight ring refresh failed: '+str(exc));return {'CANCELLED'}
        self.report({'INFO'},f'{count} rings follow TRACK_Centerline. Move AIR_OFFSET empties for individual flight-line changes.')
        return {'FINISHED'}

class LAB5_OT_new_light(bpy.types.Operator):
    bl_idname='lab5_race.add_scene_light';bl_label='Add Exportable Point Light';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        coll=_ensure_race_collection(context,'RACE_LIGHTS')
        bpy.ops.object.light_add(type='POINT',location=context.scene.cursor.location)
        light=context.object;light.name='RACE_PointLight';light.data.energy=950
        if hasattr(light.data,'use_custom_distance'):light.data.use_custom_distance=True
        if hasattr(light.data,'cutoff_distance'):light.data.cutoff_distance=30
        if coll not in light.users_collection:coll.objects.link(light)
        for old in list(light.users_collection):
            if old!=coll:old.objects.unlink(light)
        self.report({'INFO'},'Point light added to RACE_LIGHTS. Blender colour, power and range export as browser lighting.')
        return {'FINISHED'}

class LAB5_OT_sample(bpy.types.Operator):
    bl_idname='lab5_race.make_sample';bl_label='Generate Editable Curve Track';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            curve=create_sample(context.scene)
            bpy.ops.object.select_all(action='DESELECT');curve.select_set(True)
            context.view_layer.objects.active=curve
        except Exception as exc:
            self.report({'ERROR'},'Curve track creation failed: '+str(exc));return {'CANCELLED'}
        self.report({'INFO'},'RACE_TRACK ready. TAB to edit TRACK_Centerline; then Refresh Markers.')
        return {'FINISHED'}

class LAB5_OT_refresh_markers(bpy.types.Operator):
    bl_idname='lab5_race.refresh_markers';bl_label='Refresh Curve Width + Race Markers';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:count=update_generated_dimensions(context.scene)
        except Exception as exc:
            self.report({'ERROR'},'Refresh failed: '+str(exc));return {'CANCELLED'}
        self.report({'INFO'},f'Repaired bank-safe 3D wall sweeps and refreshed {count} waypoints, checkered finish, 4 gates, 4 spawns')
        return {'FINISHED'}

class LAB5_OT_guardrail_safe(bpy.types.Operator):
    bl_idname='lab5_race.raise_guardrails'
    bl_label='Raise / Rebuild Safety Guardrails'
    bl_description='Set a 2.0m high, 0.36m thick guardrail on BOTH sides, preserving the curve and all splat transforms. Rebuilds generated road/wall profiles and markers.'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.lab5_pack
        p.guardrail_height=max(p.guardrail_height,2.0)
        p.guardrail_thickness=max(p.guardrail_thickness,.36)
        try:
            count=update_generated_dimensions(context.scene)
        except Exception as exc:
            self.report({'ERROR'},'Guardrail refresh failed: '+str(exc))
            return {'CANCELLED'}
        self.report({'INFO'},f'Raised guardrails to {p.guardrail_height:.2f}m and refreshed {count} markers. Export new GLBs to game.')
        return {'FINISHED'}

class LAB5_OT_repair_3d(bpy.types.Operator):
    bl_idname='lab5_race.repair_3d_walls'
    bl_label='Repair Existing Hills / Banked Walls'
    bl_description='Rebuild only the four LAB5 Geometry Nodes groups around the current edited centerline. Keeps artist edits and repositions race markers.'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            _repair_generated_profiles(context.scene)
            refresh_markers(context.scene)
        except Exception as exc:
            self.report({'ERROR'},'3D sweep repair failed: '+str(exc))
            return {'CANCELLED'}
        self.report({'INFO'},'Existing curve preserved; road, walls, gates and spawns updated for 3D banking')
        return {'FINISHED'}

class LAB5_OT_check_driveability(bpy.types.Operator):
    bl_idname='lab5_race.check_driveability'
    bl_label='Check Track Driveability (Read Only)'
    bl_description='Review curve grade, banking and tight turns for the arcade kart. Does not modify the scene or export.'
    def execute(self,context):
        from .track_builder import _curve_samples_with_tilt
        from .driveability import analyze_samples
        p=context.scene.lab5_pack
        curve=p.track_curve or bpy.data.objects.get('TRACK_Centerline')
        if not curve:
            self.report({'ERROR'},'TRACK_Centerline is missing');return {'CANCELLED'}
        try:result=analyze_samples(_curve_samples_with_tilt(curve),p.road_width)
        except Exception as ex:
            self.report({'ERROR'},'Driveability check failed: '+str(ex));return {'CANCELLED'}
        summary=(f"{result['length_m']:.0f}m circuit; max grade {result['grade']*100:.0f}% "
                 f"bank {result['bank_degrees']:.0f}deg; minimum radius {result['tightest_radius_m']:.1f}m")
        p.driveability_note=summary
        print('[LAB5 Driveability]',summary,'WARNINGS:',result['warnings'])
        for msg in result['warnings'][:2]:self.report({'WARNING'},msg)
        if not result['warnings']:self.report({'INFO'},'Driveability preflight OK: '+summary)
        return {'FINISHED'}

class LAB5_OT_effect(bpy.types.Operator):
    bl_idname='lab5_race.add_effect'
    bl_label='Place track effect at 3D cursor'
    bl_options={'REGISTER','UNDO'}
    kind:EnumProperty(items=[('speed','Speed Blast',''),('grease','Grease Cloud','')])
    def execute(self,context):
        marker=bpy.data.objects.new('Speed Blast' if self.kind=='speed' else 'Grease Cloud',None)
        context.scene.collection.objects.link(marker)
        marker.location=context.scene.cursor.location
        marker.empty_display_type='SPHERE'
        marker.empty_display_size=2
        marker['race_effect']=self.kind
        bpy.ops.object.select_all(action='DESELECT')
        marker.select_set(True)
        context.view_layer.objects.active=marker
        return {'FINISHED'}

class LAB5_OT_validate(bpy.types.Operator):
    bl_idname='lab5_race.validate';bl_label='Validate Race Collections'
    def execute(self,context):
        errors,warnings=validate_scene(context.scene)
        for s in warnings:self.report({'WARNING'},s)
        if errors:
            for s in errors:self.report({'ERROR'},s)
            return {'CANCELLED'}
        self.report({'INFO'},f'Validation OK ({len(warnings)} advisory warnings)');return {'FINISHED'}

# Independent conversion jobs: a heavy voxel stage must NEVER discard a good SOG.
# Poll asynchronous CLI jobs using Blender timers, keeping the UI responsive.
_CONVERSION_JOBS = {}

def _splat_binary():
    return shutil.which('splat-transform.cmd') or shutil.which('splat-transform')

def _valid_gaussian_ply(path):
    if not os.path.isfile(path) or not path.lower().endswith('.ply'):
        raise ValueError('Select the original/cleaned Gaussian .ply file')
    # Validate header only. Do not read a multi-GB PLY into Blender memory.
    with open(path,'rb') as stream:
        header=stream.read(65536).split(b'end_header',1)[0]
    required=(b'scale_0',b'rot_0',b'opacity',b'f_dc_0')
    if not all(k in header for k in required):
        raise ValueError('PLY lacks true Gaussian fields scale_0, rot_0, opacity, f_dc_0')

def _conversion_folder(props,src):
    root=bpy.path.abspath(props.game_root)
    if not os.path.isfile(os.path.join(root,'package.json')):
        raise ValueError('Set Game root to the extracted Splat Racers project')
    prior=bpy.path.abspath(props.prepared_folder) if props.prepared_folder else ''
    current={'source':os.path.normcase(os.path.abspath(src)),
             'size':os.path.getsize(src),'mtime_ns':os.stat(src).st_mtime_ns}
    if prior and os.path.isdir(prior):
        meta=os.path.join(prior,'source-info.json')
        if os.path.isfile(meta):
            with open(meta,'r',encoding='utf8') as file:previous=json.load(file)
            if previous!=current:
                raise ValueError('PLY changed since previous conversion. Click Prepare New Conversion Folder before continuing.')
        else:
            with open(meta,'w',encoding='utf8') as file:json.dump(current,file,indent=2)
        return prior
    stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    safe=''.join(ch if ch.isalnum() or ch in '-_' else '-' for ch in props.pack_id)
    folder=os.path.join(root,'input-assets','prepared-'+safe+'-'+stamp)
    os.makedirs(folder,exist_ok=False)
    props.prepared_folder=folder
    with open(os.path.join(folder,'source-info.json'),'w',encoding='utf8') as file:json.dump(current,file,indent=2)
    return folder

def _log_tail(path, count=4800):
    try:
        with open(path,'rb') as stream:
            stream.seek(0,os.SEEK_END)
            stream.seek(max(0,stream.tell()-count),os.SEEK_SET)
            return stream.read().decode('utf8',errors='replace').strip()
    except OSError:
        return '(log not found)'


def _start_conversion(context,kind):
    props=context.scene.lab5_pack
    key=context.scene.as_pointer()
    job=_CONVERSION_JOBS.get(key)
    if job and job['process'].poll() is None:
        raise RuntimeError('Another conversion is running. Cancel or finish it first.')
    binary=_splat_binary()
    if not binary:
        raise RuntimeError('SplatTransform missing. In PowerShell run npm.cmd install -g @playcanvas/splat-transform and restart Blender')
    raw_ply=bpy.path.abspath(props.splat_ply) if props.splat_ply else ''
    existing_sog=bpy.path.abspath(props.sog_file) if props.sog_file else ''
    # A SuperSplat SOG is a valid final visual asset. For optional voxelization,
    # the CLI can read it directly without recompressing a multi-GB PLY.
    if kind=='voxel' and props.voxel_source_sog and os.path.isfile(existing_sog) and os.path.getsize(existing_sog)>100:
        src=existing_sog
        folder_source=raw_ply if os.path.isfile(raw_ply) else src
    else:
        if not raw_ply:
            raise ValueError('Select Gaussian PLY or, for voxelization, use a valid existing SOG')
        _valid_gaussian_ply(raw_ply)
        src=raw_ply
        folder_source=raw_ply
    folder=_conversion_folder(props,folder_source)
    dest=os.path.join(folder,'track.sog' if kind=='sog' else 'track.voxel.json')
    if os.path.exists(dest):
        raise RuntimeError('Output exists; reuse it, or click Prepare New Conversion Folder: '+dest)
    # Commands use documented SplatTransform CLI global flags and a separate
    # output-actions section. Interior scans must not auto-apply outdoor floor fill.
    args=[binary,'--memory','--no-tty',src,dest]
    if kind=='voxel':
        args.extend(['--voxel-size',str(props.voxel_size),'--voxel-opacity','0.2'])
        if props.voxel_fill_mode=='INTERIOR':
            args.append('--voxel-external-fill')
        elif props.voxel_fill_mode=='OUTDOOR':
            args.append('--voxel-floor-fill')
        args.extend(['--collision-mesh','smooth'])
    logpath=os.path.join(folder,kind+'-conversion.log')
    out=open(logpath,'w',encoding='utf8')
    try:
        out.write('LAB5 Splat Racers optional conversion\nCommand: '+subprocess.list2cmdline(args)+'\n\n')
        out.flush()
        process=subprocess.Popen(args,stdout=out,stderr=subprocess.STDOUT,
                                 cwd=folder,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    finally:
        out.close()
    props.conversion_stage=('SOG compression' if kind=='sog' else 'Optional voxel generation')+' running...'
    props.conversion_log=logpath
    props.conversion_error=''
    _CONVERSION_JOBS[key]={'process':process,'kind':kind,'dest':dest,'log':logpath}

    def poll():
        running=_CONVERSION_JOBS.get(key)
        if running is None or running['process'] is not process:return None
        code=process.poll()
        if code is None:return 0.5
        _CONVERSION_JOBS.pop(key,None)
        logdetail=_log_tail(logpath)
        if code==0 and os.path.isfile(dest) and os.path.getsize(dest)>100:
            if kind=='sog':
                props.sog_file=dest
                props.conversion_stage='SOG ready. Export pack; voxel is optional.'
            else:
                j=dest.replace('.voxel.json','.voxel.bin')
                g=dest.replace('.voxel.json','.collision.glb')
                if all(os.path.isfile(x) and os.path.getsize(x)>0 for x in [j,g]):
                    props.voxel_json=dest
                    props.voxel_bin=j
                    props.voxel_collision_glb=g
                    props.conversion_stage='Voxel outputs ready. REVIEW mesh before use.'
                else:
                    props.conversion_stage='Voxel incomplete; review log; existing SOG is retained.'
                    props.conversion_error='Expected voxel JSON, BIN and collision GLB. '+logdetail[-450:]
        else:
            props.conversion_stage=f'{kind.upper()} FAILED (exit {code}). See log; existing SOG is retained.'
            props.conversion_error=logdetail[-850:] or 'No error text; inspect log.'
        print('[LAB5 RACE]',props.conversion_stage,'Log:',logpath)
        if props.conversion_error:print('[LAB5 RACE ERROR]',props.conversion_error)
        return None
    bpy.app.timers.register(poll,first_interval=0.5)
    return logpath


class LAB5_OT_open_conversion_log(bpy.types.Operator):
    bl_idname='lab5_race.open_conversion_log'
    bl_label='Open Last Conversion Log'
    bl_description='Open the SplatTransform log using your default text editor (or print to Blender Console)'
    def execute(self,context):
        path=bpy.path.abspath(context.scene.lab5_pack.conversion_log)
        if not os.path.isfile(path):
            self.report({'ERROR'},'Conversion log missing: '+path)
            return {'CANCELLED'}
        try:
            if os.name=='nt':os.startfile(path)
            else:
                import sys
                subprocess.Popen(['open' if sys.platform=='darwin' else 'xdg-open',path])
            self.report({'INFO'},'Opened '+path)
        except Exception as exc:
            print('[LAB5 RACE LOG]\n'+_log_tail(path))
            self.report({'WARNING'},'Could not open editor; see Blender system console: '+str(exc))
        return {'FINISHED'}

class LAB5_OT_convert_sog(bpy.types.Operator):
    bl_idname='lab5_race.convert_sog';bl_label='1. Convert PLY to SOG ONLY (recommended)'
    bl_description='Prepare visual SOG only. The raw PLY is never modified; the Blender placement Empty is exported separately.'
    def execute(self,context):
        try:log=_start_conversion(context,'sog')
        except Exception as exc:self.report({'ERROR'},str(exc));return {'CANCELLED'}
        self.report({'INFO'},'SOG conversion started; Blender remains responsive. Log: '+log)
        return {'FINISHED'}

class LAB5_OT_convert_voxel(bpy.types.Operator):
    bl_idname='lab5_race.convert_voxel';bl_label='2. Optional voxel/collision generation'
    bl_description='Heavy optional GPU step; Blender RACE_COLLISION is sufficient for driving. Open log if unsuccessful.'
    def execute(self,context):
        try:log=_start_conversion(context,'voxel')
        except Exception as exc:self.report({'ERROR'},str(exc));return {'CANCELLED'}
        self.report({'INFO'},'Optional voxel generation started; progress/errors in log: '+log)
        return {'FINISHED'}

class LAB5_OT_cancel_conversion(bpy.types.Operator):
    bl_idname='lab5_race.cancel_conversion';bl_label='Cancel active conversion'
    def execute(self,context):
        job=_CONVERSION_JOBS.get(context.scene.as_pointer())
        if not job or job['process'].poll() is not None:
            self.report({'INFO'},'No active conversion');return {'FINISHED'}
        job['process'].terminate()
        self.report({'INFO'},'Cancel requested; existing completed SOG is preserved')
        return {'FINISHED'}

class LAB5_OT_sog_placement(bpy.types.Operator):
    bl_idname='lab5_race.make_sog_placement'
    bl_label='Create / Capture SOG Placement'
    bl_description='Create an unbaked Empty that stores the source Gaussian orientation, size, and placement for export. Select your un-applied KIRI imported object first.'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.lab5_pack
        selected=context.active_object
        existing=bpy.data.objects.get('SOG_PLACEMENT')
        if existing:
            p.splat_alignment_object=existing
            self.report({'INFO'},'Using existing SOG_PLACEMENT; edit its transform, do not Apply All.')
            return {'FINISHED'}
        placement=bpy.data.objects.new('SOG_PLACEMENT',None)
        context.scene.collection.objects.link(placement)
        placement.empty_display_type='ARROWS'
        placement.empty_display_size=1.0
        if selected and selected.type in {'MESH','EMPTY'} and selected.name!='SPLAT_ANCHOR':
            placement.matrix_world=selected.matrix_world.copy()
        p.splat_alignment_object=placement
        if (p.link_kiri_preview and selected and selected!=placement and
                selected.type=='MESH' and selected.parent is None):
            world=selected.matrix_world.copy()
            selected.parent=placement
            selected.matrix_world=world
        p.sog_source_is_aligned=False
        self.report({'INFO'},'SOG_PLACEMENT captured. Adjust this Empty (never Apply All). Raw PLY is unchanged. If KIRI object transforms were previously applied, reimport the original PLY or restore manually.')
        return {'FINISHED'}

class LAB5_OT_sync_sog_placement(bpy.types.Operator):
    bl_idname='lab5_race.sync_sog_placement';bl_label='Sync Empty From Selected KIRI Object'
    bl_description='After changing the visible KIRI object transform, copy its WORLD matrix onto SOG_PLACEMENT without modifying the splat or KIRI parent hierarchy.'
    bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        p=context.scene.lab5_pack
        selected=context.active_object
        placement=p.splat_alignment_object or bpy.data.objects.get('SOG_PLACEMENT')
        if not selected or selected==placement or selected.type not in {'MESH','EMPTY'}:
            self.report({'ERROR'},'Select the KIRI imported object (not SOG_PLACEMENT) before syncing.')
            return {'CANCELLED'}
        if not placement:
            self.report({'ERROR'},'First click Create / Capture SOG Placement.')
            return {'CANCELLED'}
        if selected.parent==placement:
            self.report({'WARNING'},'KIRI object is already parented to the placement Empty. Edit Empty directly; syncing its child would change the anchor twice.')
            return {'CANCELLED'}
        placement.matrix_world=selected.matrix_world.copy()
        p.splat_alignment_object=placement
        p.sog_source_is_aligned=False
        self.report({'INFO'},'Captured KIRI world transform. Export asset pack to update SOG placement; raw PLY remains unmodified.')
        return {'FINISHED'}

class LAB5_OT_new_prepared_folder(bpy.types.Operator):
    bl_idname='lab5_race.new_splat_prepared_folder';bl_label='Prepare New Conversion Folder'
    bl_description='Use a new output folder for a changed PLY. Previously generated SOG/voxel files are not deleted.'
    def execute(self,context):
        key=context.scene.as_pointer()
        job=_CONVERSION_JOBS.get(key)
        if job and job['process'].poll() is None:
            self.report({'ERROR'},'Finish or cancel the active conversion first.')
            return {'CANCELLED'}
        p=context.scene.lab5_pack
        p.prepared_folder='';p.sog_file='';p.voxel_json='';p.voxel_bin='';p.voxel_collision_glb=''
        p.conversion_stage='New conversion selected; existing files remain on disk.'
        self.report({'INFO'},'Next conversion uses new output directory. Previous files preserved.')
        return {'FINISHED'}

class LAB5_OT_check_sog_link(bpy.types.Operator):
    bl_idname='lab5_race.check_sog_link'
    bl_label='Check SOG Link / Game Root'
    bl_description='Checks the selected bundled SOG and compares its bytes and placement against the active game asset pack (read only)'
    def execute(self,context):
        p=context.scene.lab5_pack
        root=bpy.path.abspath(p.game_root)
        manifest=os.path.join(root,'assets','asset-pack.json')
        if not os.path.isfile(manifest):
            self.report({'ERROR'},'Game root has no assets/asset-pack.json');return {'CANCELLED'}
        try:
            with open(manifest,encoding='utf8') as stream:pack=json.load(stream)
            current=pack.get('splat',{})
            source=bpy.path.abspath(p.sog_file) if p.sog_file else ''
            if not source or not os.path.isfile(source):
                message='Blender SOG field is missing; active pack SOG = '+str(current.get('sog') or 'NONE')
                print('[LAB5 SOG PREFLIGHT]',message)
                self.report({'ERROR'},message[:170]);return {'CANCELLED'}
            summary=_verify_bundled_sog(source)
            digest=_sha256_file(source)
            match=(digest==current.get('sogSha256')) if current.get('sogSha256') else None
            source_anchor=p.splat_alignment_object or bpy.data.objects.get('SOG_PLACEMENT')
            print('[LAB5 SOG PREFLIGHT] file:',source,'hash:',digest,'count:',summary['gaussians'],
                  'active pack:',pack.get('packId'),'same source:',match,'anchor:',source_anchor.name if source_anchor else 'identity/source aligned')
            self.report({'INFO'},f"SOG OK: {summary['gaussians']} Gaussians; active pack source {'SAME' if match else 'DIFFERENT / legacy'}. Details in system console.")
            return {'FINISHED'}
        except Exception as exc:
            self.report({'ERROR'},'SOG validation failed: '+str(exc)[:160]);return {'CANCELLED'}

class LAB5_OT_export(bpy.types.Operator):
    bl_idname='lab5_race.export_pack';bl_label='EXPORT Asset Pack to Game'
    def execute(self,context):
        root=bpy.path.abspath(context.scene.lab5_pack.game_root)
        template=os.path.join(root,'assets','track.json')
        try:
            ident,count,warnings=export_bundle(context.scene,template)
        except Exception as exc:
            self.report({'ERROR'},'Export failed: '+str(exc));return {'CANCELLED'}
        for warning in warnings[:3]:self.report({'WARNING'},warning)
        self.report({'INFO'},f'Exported {ident} / {count} moving objects; refresh browser');return {'FINISHED'}

class LAB5_OT_show_version(bpy.types.Operator):
    bl_idname='lab5_race.show_version'
    bl_label='Check Installed Add-on Version'
    bl_description='Print the installed add-on version and path to the console'
    def execute(self,context):
        import pathlib
        here=str(pathlib.Path(__file__).resolve())
        version='.'.join(str(x) for x in bl_info['version'])
        print('[LAB5 RACE] Running add-on v'+version+' at '+here)
        self.report({'INFO'},'LAB5 Race v'+version+' (full path printed to console)')
        return {'FINISHED'}

class LAB5_OT_mark_glass(bpy.types.Operator):
    bl_idname='lab5_race.mark_playcanvas_glass';bl_label='Mark Active Material: PlayCanvas Glass';bl_options={'REGISTER','UNDO'}
    bl_description='Opt selected active mesh material into runtime glass rendering; underlying GLB textures remain intact'
    def execute(self,context):
        active=context.object.active_material if context.object and context.object.type=='MESH' else None
        if not active:
            self.report({'ERROR'},'Select a mesh with an active material first')
            return {'CANCELLED'}
        active['lab5_pc_shader']='GLASS'
        if 'lab5_pc_opacity' not in active:active['lab5_pc_opacity']=.26
        if 'lab5_pc_roughness' not in active:active['lab5_pc_roughness']=.1
        if 'lab5_pc_ior' not in active:active['lab5_pc_ior']=1.45
        self.report({'INFO'},'PlayCanvas glass enabled on '+active.name)
        return {'FINISHED'}

class LAB5_PT_panel(bpy.types.Panel):
    bl_label='LAB5 Race Assets';bl_idname='LAB5_PT_race';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='LAB5 Race'
    def draw(self,context):
        layout=self.layout;p=context.scene.lab5_pack
        box=layout.box()
        box.label(text='LAB5 Race Packager v2.2.0',icon='CHECKMARK')
        box.operator('lab5_race.show_version',text='Check Installed Add-on Version',icon='INFO')
        layout.prop(p,'game_root');layout.prop(p,'pack_id');layout.prop(p,'level_type')
        layout.label(text='0. Geometry Nodes circuit generator')
        layout.prop(p,'road_width');layout.prop(p,'guardrail_height');layout.prop(p,'guardrail_thickness');layout.operator('lab5_race.make_sample',icon='CURVE_BEZCURVE')
        layout.prop(p,'track_curve');layout.prop(p,'start_percent');layout.operator('lab5_race.refresh_markers',icon='FILE_REFRESH')
        layout.operator('lab5_race.repair_3d_walls',icon='MOD_SOLIDIFY')
        layout.operator('lab5_race.raise_guardrails',icon='MOD_SOLIDIFY')
        layout.operator('lab5_race.check_driveability',icon='INFO')
        layout.label(text=p.driveability_note[:70])
        layout.label(text='v2 exports dense NPC route + corner speed planning')
        layout.label(text='Edit curve: Tab / G Z for hills; Ctrl+T to bank.')
        layout.label(text='Road + BOTH walls share one local curve frame.')
        layout.label(text='After edits: REFRESH for dense deck, wall boxes, race markers.')
        air=layout.box();air.label(text='Flight course: same TRACK_Centerline')
        air.prop(p,'air_gate_count');air.prop(p,'air_gate_start_offset_percent');air.prop(p,'air_gate_min_start_clearance');air.prop(p,'air_gate_height');air.prop(p,'air_ring_radius');air.prop(p,'air_ring_auto_scale')
        if p.air_ring_auto_scale:air.prop(p,'air_ring_reference_width')
        air.operator('lab5_race.refresh_air_gates',icon='EMPTY_ARROWS')
        air.label(text='First ring keeps minimum forward clearance after finish')
        air.label(text='AIR_OFFSET_XX local edits + crossing direction retained')
        air.label(text='Game highlights each player next ring / road gate')
        lib=layout.box();lib.label(text='Vehicle Workshop: saved inside .blend')
        lib.prop(p,'vehicle_kind');lib.prop(p,'vehicle_name')
        lib.operator('lab5_race.generate_vehicle',icon='OUTLINER_OB_MESH')
        lib.label(text='Edit VEHICLE_* parts and materials, then Export')
        lib.label(text='Root: jump_speed, hover_hop_step / hover_hop_interval')
        lib.label(text='Hover boost has no altitude ceiling; Q/LB descends')
        lib.label(text='Also: acceleration / stability_assist / auto_right_seconds')
        lib.label(text='KART wheel parts export as animated wheel GLB')
        lightbox=layout.box();lightbox.label(text='GLB materials + scene lighting')
        lightbox.operator('lab5_race.add_scene_light',icon='LIGHT_POINT')
        lightbox.label(text='Use Principled BSDF + Image Texture for GLB')
        lightbox.prop(p,'force_curve_road_uv');lightbox.prop(p,'road_uv_repeat_length')
        lightbox.label(text='Road shader: UV Map RoadUV -> Image Texture -> Base Color')
        lightbox.prop(p,'render_exposure');lightbox.prop(p,'render_fog_distance')
        lightbox.prop(p,'render_environment_atlas')
        lightbox.label(text='Atlas requires PlayCanvas-prefiltered KTX data')
        lightbox.operator('lab5_race.mark_playcanvas_glass',icon='MATERIAL')
        glass=getattr(context.object,'active_material',None) if context.object and context.object.type=='MESH' else None
        if glass and glass.get('lab5_pc_shader')=='GLASS':
            lightbox.label(text='Glass: '+glass.name+' (adjust custom props)')
            lightbox.label(text='lab5_pc_opacity / roughness / ior')
        lightbox.label(text='Only opt-in glass changes in PlayCanvas; other GLB materials untouched')
        layout.separator();layout.label(text='1. RACE_TRACK parent contains exporter collections')
        layout.prop(p,'target_collection');layout.operator('lab5_race.assign_collection',icon='OUTLINER_COLLECTION')
        layout.label(text='RACE_WAYPOINTS / GATES / SPAWNS: empties')
        floor=layout.box();floor.label(text='Physics: visual SOG is NEVER a collider')
        floor.prop(p,'proxy_size');floor.operator('lab5_race.create_collision_ground',icon='MESH_GRID')
        floor.operator('lab5_race.create_free_spawns',icon='EMPTY_AXIS')
        floor.prop(p,'proxy_body');floor.prop(p,'proxy_shape')
        floor.prop(p,'proxy_drivable')
        floor.operator('lab5_race.create_primitive_collider',icon='MESH_CUBE')
        floor.operator('lab5_race.assign_primitive_collider',icon='MOD_PHYSICS')
        floor.label(text='Edit wireframe meshes: G / R / S, then export')
        floor.label(text='Imported collision GLB mesh: assign to RACE_COLLISION')
        layout.separator();layout.label(text='2. Gaussian PLY (non-destructive placement)')
        layout.prop(p,'splat_ply')
        layout.operator('lab5_race.convert_sog',icon='FILE_REFRESH')
        layout.prop(p,'conversion_stage')
        layout.prop(p,'conversion_log')
        layout.prop(p,'sog_file')
        layout.prop(p,'allow_no_sog_export')
        layout.prop(p,'allow_clear_sog')
        layout.operator('lab5_race.check_sog_link',icon='CHECKMARK')
        layout.label(text='SuperSplat SOG can be used DIRECTLY; PLY conversion optional')
        layout.operator('lab5_race.new_splat_prepared_folder',icon='NEWFOLDER')
        layout.label(text='SELECT the un-applied KIRI splat / proxy first')
        layout.prop(p,'link_kiri_preview')
        layout.operator('lab5_race.make_sog_placement',icon='EMPTY_AXIS')
        layout.operator('lab5_race.sync_sog_placement',icon='FILE_REFRESH')
        layout.prop(p,'splat_alignment_object')
        anchor=p.splat_alignment_object
        if anchor:
            layout.label(text='Live Blender SOG placement (DO NOT Apply)')
            layout.prop(anchor,'location',text='Position')
            layout.prop(anchor,'rotation_euler',text='Rotation')
            layout.prop(anchor,'scale',text='Scale')
        layout.prop(p,'sog_source_is_aligned')
        layout.prop(p,'reset_browser_calibration')
        layout.label(text='OFF preserves ALIGN SOG JSON on each re-export')
        layout.label(text='Use aligned toggle ONLY if PLY was exported from KIRI')
        layout.separator();layout.label(text='Optional: voxel mesh (may require lots of RAM)')
        layout.prop(p,'voxel_size')
        layout.prop(p,'voxel_fill_mode')
        layout.prop(p,'voxel_source_sog')
        layout.operator('lab5_race.convert_voxel',icon='MOD_REMESH')
        layout.operator('lab5_race.cancel_conversion',icon='CANCEL')
        layout.operator('lab5_race.open_conversion_log',icon='TEXT')
        if p.conversion_error:
            col=layout.column(align=True)
            col.label(text='Last conversion failed; read log for details',icon='ERROR')
        layout.prop(p,'voxel_collision_glb');layout.prop(p,'voxel_json');layout.prop(p,'voxel_bin')
        layout.separator();layout.label(text='3. Collision height and export')
        layout.prop(p,'heightfield');
        if p.heightfield:layout.prop(p,'cell_size')
        layout.label(text='Road collision: top-only evaluated GN mesh. No underside.')
        layout.label(text='Walls: short boxes OUTSIDE road edge in game.')
        layout.label(text='3D Ammo collision uses RACE_COLLISION GLB')
        if p.heightfield and p.heightfield_note:layout.label(text=p.heightfield_note[:90])
        for kind,label in [('speed','Place Speed Blast'),('grease','Place Grease Cloud')]:
            layout.operator('lab5_race.add_effect',text=label).kind=kind
        layout.operator('lab5_race.validate',icon='CHECKMARK')
        layout.operator('lab5_race.export_pack',icon='EXPORT')
        layout.label(text='SOG alignment uses selected object, else SPLAT_ANCHOR')
        layout.label(text='SOG rendered by v1.5 PlayCanvas game')
        layout.label(text='v1.4+ static collision GLB is authoritative')

classes=(LAB5_PackProperties,LAB5_OT_effect,LAB5_OT_mark_glass,LAB5_OT_new_vehicle,LAB5_OT_refresh_air,LAB5_OT_new_light,LAB5_OT_assign,LAB5_OT_create_ground,LAB5_OT_create_proxy,LAB5_OT_assign_proxy,LAB5_OT_create_spawns,LAB5_OT_sample,LAB5_OT_refresh_markers,LAB5_OT_repair_3d,LAB5_OT_guardrail_safe,LAB5_OT_check_driveability,LAB5_OT_validate,LAB5_OT_convert_sog,LAB5_OT_convert_voxel,LAB5_OT_open_conversion_log,LAB5_OT_cancel_conversion,LAB5_OT_sog_placement,LAB5_OT_sync_sog_placement,LAB5_OT_new_prepared_folder,LAB5_OT_check_sog_link,LAB5_OT_export,LAB5_OT_show_version,LAB5_PT_panel)
def register():
    for c in classes:bpy.utils.register_class(c)
    bpy.types.Scene.lab5_pack=PointerProperty(type=LAB5_PackProperties)
def unregister():
    if hasattr(bpy.types.Scene,'lab5_pack'):del bpy.types.Scene.lab5_pack
    for c in reversed(classes):bpy.utils.unregister_class(c)
if __name__=='__main__':register()
