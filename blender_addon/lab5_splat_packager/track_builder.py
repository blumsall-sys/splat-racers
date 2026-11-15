"""LAB5 1.6.3 banked 3D curve-driven Blender track builder.

One RACE_TRACK parent groups authoring objects and exporter subcollections.
The road + wall surface are live Geometry Nodes reading TRACK_Centerline.
Marker empties are rebuilt by the Refresh Markers button after Edit Mode.
"""
import bpy, math
from mathutils import Vector, Matrix
from .exporter import COLS
from .track_quality import recommended_spline_resolution

ROOT='RACE_TRACK'
CURVE_NAME='TRACK_Centerline'
GENERATED_PREFIX='GEN_'

def _child(root,name):
    c=bpy.data.collections.get(name)
    if not c:
        c=bpy.data.collections.new(name)
        root.children.link(c)
    if c not in list(root.children):
        try: root.children.link(c)
        except RuntimeError:pass
    return c

def _link(obj, coll):
    coll.objects.link(obj)
    for c in list(obj.users_collection):
        if c!=coll:c.objects.unlink(obj)

def _mat(name, rgba):
    # Never reset an artist's edited material when refreshing the centreline.
    # In particular, preserve Principled image texture node links and UV maps.
    existing=bpy.data.materials.get(name)
    if existing:return existing
    mat=bpy.data.materials.new(name)
    mat.diffuse_color=(*rgba,1.0)
    # glTF needs a material node graph for reliable PBR colour export.
    # A viewport-only diffuse_color often produces a white GLB in PlayCanvas.
    mat.use_nodes=True
    bsdf=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if bsdf is not None:
        bsdf.inputs['Base Color'].default_value=(*rgba,1.0)
        bsdf.inputs['Roughness'].default_value=.85
        bsdf.inputs['Metallic'].default_value=0.0
    return mat

def _create_curve(coll):
    cu=bpy.data.curves.new(CURVE_NAME,'CURVE')
    cu.dimensions='3D';cu.resolution_u=24;cu.twist_mode='Z_UP'
    sp=cu.splines.new('BEZIER');sp.bezier_points.add(7);sp.use_cyclic_u=True
    sp.resolution_u=24  # Blender uses the spline resolution for Curve-to-Mesh evaluation.
    for i,b in enumerate(sp.bezier_points):
        a=-math.pi/2 + 2*math.pi*i/8
        b.co=(12.5*math.cos(a),8.0*math.sin(a),0)
        b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    obj=bpy.data.objects.new(CURVE_NAME,cu);coll.objects.link(obj)
    obj['lab5_role']='editable_centreline';return obj

def _mesh_host(coll,name):
    mesh=bpy.data.meshes.new(name+'_host');obj=bpy.data.objects.new(name,mesh)
    coll.objects.link(obj);obj['lab5_generated']=True
    return obj

def _profile_geometry_nodes(curve,name,width,barrier_offset=None,height=0,material=None):
    """Sweep a profile through the centerline's *same curve frame*.

    IMPORTANT: do not Set Position by cross(tangent, world-Z) for walls.
    That offset is not the frame used by Curve to Mesh on a 3D/tilted path.
    Instead place both walls at the desired cross-section X coordinate.
    The GN Curve to Mesh node transports this offset along with the road's
    local normal, so hills and Bézier control-point tilt affect both equally.
    """
    group=bpy.data.node_groups.new(name,'GeometryNodeTree')
    group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
    group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
    N=group.nodes; L=group.links
    output=N.new('NodeGroupOutput');output.location=(520,140)
    info=N.new('GeometryNodeObjectInfo');info.transform_space='RELATIVE'
    info.inputs['Object'].default_value=curve
    if 'As Instance' in info.inputs:info.inputs['As Instance'].default_value=False
    info.location=(-550,220)
    profile=N.new('GeometryNodeCurvePrimitiveLine');profile.mode='POINTS';profile.location=(-530,-110)
    if barrier_offset is not None:
        # Curve to Mesh places its +Y profile axis DOWN from the road deck
        # on the LAB5 Z_UP 3D curve frame. The road occupies profile Y=0.
        # Profile -Y therefore runs UP along the *banked* road normal.
        # Both walls share the same GN curve frame as the deck. This also
        # keeps the top on the correct side when the centerline rises/falls.
        # The foot extends 7cm under the road to avoid visual/physics seams.
        profile.inputs['Start'].default_value=(float(barrier_offset), +.07, 0)
        profile.inputs['End'].default_value=(float(barrier_offset), -float(height), 0)
    else:
        profile.inputs['Start'].default_value=(-width/2,0,0)
        profile.inputs['End'].default_value=( width/2,0,0)
    to_mesh=N.new('GeometryNodeCurveToMesh');to_mesh.location=(-130,150)
    L.new(info.outputs['Geometry'],to_mesh.inputs['Curve'])
    L.new(profile.outputs['Curve'],to_mesh.inputs['Profile Curve'])
    mesh_socket=to_mesh.outputs['Mesh']
    if material:
        assign=N.new('GeometryNodeSetMaterial');assign.location=(170,160)
        assign.inputs['Material'].default_value=material
        L.new(mesh_socket,assign.inputs['Geometry'])
        mesh_socket=assign.outputs['Geometry']
    L.new(mesh_socket,output.inputs['Geometry'])
    return group


def ensure_curve_density(curve, max_segment_m=.50):
    """Adjust evaluated Bezier density to approximate a half-metre road grid.

    Uses the entire evaluated path, not a fixed face count independent of scale.
    The GLB collision/visual geometry is exported from the SAME evaluated GN
    surface. This is deliberately not a SOG or voxel collision step.
    """
    if not curve or curve.type != 'CURVE': return 0
    highest=0
    for spline in curve.data.splines:
        if spline.type != 'BEZIER': continue
        points=list(spline.bezier_points)
        for i, start in enumerate(points):
            if i==len(points)-1 and not spline.use_cyclic_u: break
            end=points[(i+1)%len(points)]
            # Estimate actual arc, not just distance between handles/endpoints.
            pts=[]
            for j in range(33):
                t=j/32;u=1-t
                local=(start.co*u**3 + start.handle_right*(3*u*u*t)
                       + end.handle_left*(3*u*t*t) + end.co*t**3)
                pts.append(curve.matrix_world @ local)
            length=sum((v-pts[k-1]).length for k,v in enumerate(pts) if k)
            highest=max(highest,recommended_spline_resolution(length,max_segment_m))
        spline.resolution_u=max(24,highest)
    curve.data.resolution_u=max(24,highest)
    return highest


def _repair_generated_profiles(scene):
    """Replace only the four LAB5-generated GN groups in-place, preserving
    the editable curve, object identities, materials, artist work and anchors.
    Safe for an existing .blend file produced by v1.1.3.
    """
    curve=scene.lab5_pack.track_curve or bpy.data.objects.get(CURVE_NAME)
    if curve is None or curve.type!='CURVE':
        raise RuntimeError('Select an editable TRACK_Centerline curve first')
    # For hilly tracks, Z-up establishes an unbanked horizontal reference.
    # Users bank by rotating individual Bezier control points with Ctrl+T.
    curve.data.dimensions='3D'
    curve.data.twist_mode='Z_UP'
    ensure_curve_density(curve)
    width=float(scene.lab5_pack.road_width)
    road_ob=bpy.data.objects.get('GEN_RoadVisual')
    wall_ob=bpy.data.objects.get('GEN_InnerWall')
    road_mat=(road_ob.data.materials[0] if road_ob and road_ob.data.materials else None) or _mat('LAB5 Tarmac',(0.14,0.18,0.23))
    wall_mat=(wall_ob.data.materials[0] if wall_ob and wall_ob.data.materials else None) or _mat('LAB5 Safety Wall',(0.92,.36,.23))
    ref=bpy.data.objects.get('ASSET_Barrier')
    height=float(scene.lab5_pack.guardrail_height)
    wall_thickness=max(.08,float(scene.lab5_pack.guardrail_thickness))
    specs=(
        ('GEN_RoadVisual',None,road_mat),
        ('GEN_RoadCollision',None,road_mat),
        ('GEN_InnerWall',-width*.53,wall_mat),
        ('GEN_OuterWall', width*.53,wall_mat),
    )
    for name,offset,mat in specs:
        obj=bpy.data.objects.get(name)
        if obj is None or not obj.get('lab5_generated'):
            raise RuntimeError(name+' is not a LAB5 generated object; cannot repair safely')
        mod=next((m for m in obj.modifiers if m.type=='NODES'),None)
        if mod is None:raise RuntimeError('Missing Geometry Nodes modifier on '+name)
        old_group=mod.node_group
        mod.node_group=_profile_geometry_nodes(
            curve,'LAB5 3D Bank-Safe '+name,width,offset,height,mat)
        if old_group and old_group.users==0:
            bpy.data.node_groups.remove(old_group)
        solid=next((m for m in obj.modifiers if m.type=='SOLIDIFY'),None)
        if solid and offset is not None:
            solid.thickness=wall_thickness
            solid.offset=0
    return curve


def update_generated_dimensions(scene):
    """Refresh bank-safe sweep profiles and resample marker positions.

    Refresh intentionally repairs legacy world-up-offset node graphs as well
    as adjusting road width; it does not recreate the artist's centerline.
    """
    _repair_generated_profiles(scene)
    return refresh_markers(scene)

def _attach(obj,group,mat,solidify=.15,offset=-1):
    mod=obj.modifiers.new('LIVE Geometry Nodes from TRACK_Centerline','NODES');mod.node_group=group
    obj.data.materials.append(mat)
    solid=obj.modifiers.new('Track volume (stable Ammo static trimesh)','SOLIDIFY')
    solid.thickness=solidify;solid.offset=offset


def _curve_samples_with_tilt(curve, per_segment=48):
    """Return sampled world positions and interpolated control-point tilt."""
    if curve.type!='CURVE':raise ValueError('Select a curve object')
    samples=[]
    for spline in curve.data.splines:
        if spline.type=='BEZIER':
            bs=list(spline.bezier_points);n=len(bs)
            ends=n if spline.use_cyclic_u else n-1
            for i in range(ends):
                a=bs[i];b=bs[(i+1)%n]
                for j in range(per_segment):
                    t=j/per_segment;u=1-t
                    v=(a.co*(u**3)+a.handle_right*(3*u*u*t)
                       +b.handle_left*(3*u*t*t)+b.co*(t**3))
                    tilt=float(a.tilt)*(1-t)+float(b.tilt)*t
                    samples.append((curve.matrix_world@v, tilt))
        elif spline.type=='POLY':
            samples.extend((curve.matrix_world@Vector(p.co[:3]),float(p.tilt))
                           for p in spline.points)
    if len(samples)<8:raise ValueError('Curve requires at least eight sample points')
    return samples


def sample_curve(curve, per_segment=48):
    """Sample Bezier handles in world space (supports hills and banking)."""
    return [p for p,tilt in _curve_samples_with_tilt(curve,per_segment)]


def _samples_with_frames(curve,count,start_fraction=0.0):
    """Approximate road frame for gate/spawn positioning from centerline.

    GN geometry itself is authoritative. The marker frame is independently
    resampled and kept perpendicular to the three-dimensional tangent; its
    tilted lateral spans grade and modest banking. Avoid near-vertical tracks.
    """
    from mathutils import Quaternion
    samples=_curve_samples_with_tilt(curve)
    positions=[p for p,t in samples]
    output=[]
    lengths=[(positions[(i+1)%len(positions)]-p).length for i,p in enumerate(positions)]
    total=sum(lengths)
    for k in range(count):
        distance=total*((k/count+start_fraction)%1.0)
        for i,L in enumerate(lengths):
            if distance<=L or i==len(lengths)-1:
                ratio=max(0,min(1,distance/max(L,1e-8)))
                j=(i+1)%len(positions)
                pos=positions[i].lerp(positions[j],ratio)
                tilt=samples[i][1]*(1-ratio)+samples[j][1]*ratio
                # Follow the LOCAL centreline segment; a wide central
                # difference can point across a hairpin rather than along the
                # gate's correct directed entry face.
                tangent=(positions[j]-positions[i]).normalized()
                lateral=Vector((tangent.y,-tangent.x,0))
                if lateral.length<1e-5:raise ValueError('Near-vertical track curve: unsupported road frame')
                lateral.normalize()
                lateral=Quaternion(tangent,tilt) @ lateral
                up=lateral.cross(tangent).normalized()
                output.append((pos,tangent,lateral,up))
                break
            distance-=L
    return output

def _even_samples(points,count):
    length=[(points[(i+1)%len(points)]-p).length for i,p in enumerate(points)]
    total=sum(length);out=[]
    for k in range(count):
        target=total*k/count
        for i,L in enumerate(length):
            if target<=L or i==len(length)-1:
                t=target/max(L,1e-10)
                out.append(points[i].lerp(points[(i+1)%len(points)],min(t,1)))
                break
            target-=L
    return out

def _marker(collection,name,position,yaw=0):
    o=bpy.data.objects.get(name)
    if o is None:o=bpy.data.objects.new(name,None);collection.objects.link(o)
    elif collection not in o.users_collection:_link(o,collection)
    o.location=position;o.rotation_euler=(0,0,yaw)
    o.empty_display_type='ARROWS';o.empty_display_size=.6
    o['lab5_generated']=True
    return o

def _update_finish_visual(root,position,tangent,lateral,up,width):
    """Generate an actual two-row checkered mesh, lying on the swept 3D road.

    Export only via RACE_VISUALS. NO collision or rigid body component.
    """
    coll=_child(root,'RACE_VISUALS')
    name='GEN_FinishLine'
    ob=bpy.data.objects.get(name)
    if ob and not ob.get('lab5_generated'):
        raise RuntimeError('GEN_FinishLine exists but is artist-authored; rename it before refreshing')
    if ob:
        bpy.data.objects.remove(ob,do_unlink=True)
    vertices=[];faces=[];mat_ids=[]
    ncol=12; nrow=2;half=min(width*.43,width*.5-.12)
    road_normal=up.normalized()
    for row in range(nrow):
        for col in range(ncol):
            a=-half+2*half*col/ncol; b=-half+2*half*(col+1)/ncol
            c=-.38+.76*row/nrow; d=-.38+.76*(row+1)/nrow
            base=len(vertices)
            for across,along in ((a,c),(b,c),(b,d),(a,d)):
                vertices.append(tuple(position+lateral*across+tangent*along+road_normal*.055))
            faces.append((base,base+1,base+2,base+3));mat_ids.append((row+col)%2)
    mesh=bpy.data.meshes.new('LAB5 Checkered Finish Mesh')
    mesh.from_pydata(vertices,[],faces);mesh.update()
    mesh.materials.append(_mat('LAB5 Finish Black',(.035,.045,.055)))
    mesh.materials.append(_mat('LAB5 Finish White',(.94,.94,.87)))
    for poly,mi in zip(mesh.polygons,mat_ids):poly.material_index=mi
    ob=bpy.data.objects.new(name,mesh);coll.objects.link(ob)
    ob['lab5_generated']=True
    ob['lab5_finish_visual']=True
    return ob

def refresh_air_gates(scene,frames=None):
    """Procedural ring anchors derived from the SAME road centreline.

    Only anchor world transforms are updated by Refresh. AIR_OFFSET_* children
    preserve artist-authored local XYZ/rotation offsets (and their rings) across
    any centerline change; there is never a second editable flight spline.
    """
    curve=scene.lab5_pack.track_curve or bpy.data.objects.get(CURVE_NAME)
    if not curve:return 0
    root=bpy.data.collections.get(ROOT)
    if not root:return 0
    coll=_child(root,'RACE_AIR_GATES')
    count=int(scene.lab5_pack.air_gate_count)
    from .vehicle_tools import materials
    mat=materials('LAB5 Flight Rings',(.20,.80,.95),.27,.19)
    # Ring diameter follows road width by default; each AIR_OFFSET remains
    # artist-editable. A manually changed lab5_ring_radius is an override.
    factor=(float(scene.lab5_pack.road_width)/max(.1,float(scene.lab5_pack.air_ring_reference_width))) if scene.lab5_pack.air_ring_auto_scale else 1.0
    automatic_radius=max(.65,min(25.,float(scene.lab5_pack.air_ring_radius)*factor))
    positions=[p for p,_ in _curve_samples_with_tilt(curve)]
    perimeter=sum((positions[(i+1)%len(positions)]-p).length for i,p in enumerate(positions))
    nominal=float(getattr(scene.lab5_pack,'air_gate_start_offset_percent',4.0))/100.0
    clearance=max(float(getattr(scene.lab5_pack,'air_gate_min_start_clearance',8.0)), automatic_radius+4.0)
    if perimeter<=1:raise ValueError('Cannot position flight rings on a zero-length centreline')
    # The old percent-only offset could be smaller than the first ring itself
    # on tight tracks. The grid is behind the start line; keep AIR_00 clearly
    # beyond it without moving the road, road gates, or the player spawns.
    fraction=max(nominal,clearance/perimeter)
    if fraction>=.5:raise ValueError('Track too short for first flight-ring clearance; reduce ring radius / clearance or lengthen the centreline')
    frames=_samples_with_frames(curve,count,(float(scene.lab5_pack.start_percent)/100.0+fraction)%1.0)
    scene['lab5_effective_first_ring_offset_m']=round(fraction*perimeter,3)
    for k,(pos,tangent,lateral,up) in enumerate(frames):
        name='AIR_ANCHOR_%02d'%k
        anchor=bpy.data.objects.get(name)
        if anchor is None:
            anchor=bpy.data.objects.new(name,None);coll.objects.link(anchor)
            anchor.empty_display_type='ARROWS';anchor.empty_display_size=.9
            anchor['lab5_generated_air_anchor']=True
        anchor.rotation_mode='QUATERNION'
        # Ring primitive lies in local XY; normal +Z aligns to travel tangent.
        anchor.rotation_quaternion=Vector((0,0,1)).rotation_difference(tangent.normalized())
        anchor.location=pos+up.normalized()*float(scene.lab5_pack.air_gate_height)
        offset=bpy.data.objects.get('AIR_OFFSET_%02d'%k)
        if offset is None:
            offset=bpy.data.objects.new('AIR_OFFSET_%02d'%k,None);coll.objects.link(offset)
            offset.parent=anchor;offset.empty_display_type='SPHERE';offset.empty_display_size=.6
            offset['lab5_air_gate_offset']=True
            offset['lab5_air_gate_id']='AIR_%02d'%k
            offset['lab5_ring_radius']=automatic_radius
            offset['lab5_auto_radius_previous']=automatic_radius
        ring=bpy.data.objects.get('AIR_RING_%02d'%k)
        if ring is None:
            # Create a visible artistic ring using Blender's native torus.
            bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,
                location=(0,0,0),major_radius=float(scene.lab5_pack.air_ring_radius),minor_radius=.13)
            ring=bpy.context.object;ring.name='AIR_RING_%02d'%k
            _link(ring,coll)
            ring.parent=offset;ring.location=(0,0,0);ring.rotation_euler=(0,0,0)
            ring.data.materials.append(mat)
            ring['lab5_air_ring_visual']=True
        previous_auto=offset.get('lab5_auto_radius_previous')
        existing_radius=float(offset.get('lab5_ring_radius',automatic_radius))
        if (previous_auto is None and abs(existing_radius-float(scene.lab5_pack.air_ring_radius))<1e-4) or (previous_auto is not None and abs(existing_radius-float(previous_auto))<1e-4):
            # This offset is still automatic: resize when the road changes.
            offset['lab5_ring_radius']=automatic_radius
        # Otherwise artist customized this single gate; preserve its radius.
        offset['lab5_auto_radius_previous']=automatic_radius
        radius=float(offset['lab5_ring_radius'])
        last_visual=float(ring.get('lab5_visual_radius',scene.lab5_pack.air_ring_radius))
        if last_visual>1e-5:
            ring.scale.x*=radius/last_visual
            ring.scale.y*=radius/last_visual
        ring['lab5_visual_radius']=radius
        ring.hide_render=False
    # Old gates are deliberately preserved when count is reduced; the exporter
    # only includes offsets 0..count-1, and visuals exclude any surplus rings.
    return count

def refresh_markers(scene):
    curve=scene.lab5_pack.track_curve or bpy.data.objects.get(CURVE_NAME)
    if not curve:raise RuntimeError('TRACK_Centerline is missing')
    frames=_samples_with_frames(curve,32,float(scene.lab5_pack.start_percent)/100.0)
    root=bpy.data.collections.get(ROOT)
    if not root:raise RuntimeError('RACE_TRACK root collection is missing')
    way=_child(root,'RACE_WAYPOINTS');gates=_child(root,'RACE_GATES');spawns=_child(root,'RACE_SPAWNS')
    for coll in (way,gates,spawns):
        for obj in list(coll.objects):
            if obj.get('lab5_generated'):
                bpy.data.objects.remove(obj,do_unlink=True)
    for i,(p,t,l,n) in enumerate(frames):
        _marker(way,'WP_%03d'%i,p)
    half=max(2.,float(scene.lab5_pack.road_width)*.44)
    for k,index in enumerate((0,8,16,24)):
        p,t,lateral,up=frames[index]
        name='GATE_START' if k==0 else 'GATE_%02d'%k
        _marker(gates,name+'_A',p-lateral*half)
        _marker(gates,name+'_B',p+lateral*half)
    p,t,lateral,up=frames[0]
    _update_finish_visual(root, p,t,lateral,up,float(scene.lab5_pack.road_width))
    browser_yaw=math.atan2(t.x,-t.y)
    # Spawns are lifted relative to the banked road normal and behind the gate.
    # The kart backend supports yaw-only physics; steep inclines/bank angles
    # require a future fully articulated suspension implementation.
    # Four staggered grid positions on ONE TRACK_Centerline; front two retain
    # their original coordinates so existing 1P/2P levels do not move.
    for name,side,row in [('SPAWN_P1',-1,0),('SPAWN_P2',1,0),('SPAWN_P3',-1,1),('SPAWN_P4',1,1)]:
        _marker(spawns,name,p-t*(2.5+row*3.0) + lateral*(side*1.)+up*.7,browser_yaw)
    if getattr(scene.lab5_pack,'air_gate_count',0):refresh_air_gates(scene)
    return len(frames)

def create_sample(scene):
    existing=bpy.data.collections.get(ROOT)
    curve_to_reuse=None
    if existing and any(existing.all_objects):
        # v1.6 can stop after it has created TRACK_Centerline but before the
        # first generated mesh (the old ResampleCurve.mode exception). Allow
        # that precise incomplete state to recover without deleting the user's
        # curve, splat or any manually authored objects.
        objects=list(existing.all_objects)
        candidate=bpy.data.objects.get(CURVE_NAME)
        safe_names={CURVE_NAME,'ASSET_Tarmac','ASSET_Barrier','SPLAT_ANCHOR'}
        if (candidate and candidate.type=='CURVE' and
                candidate.get('lab5_role')=='editable_centreline' and
                all(o.name in safe_names for o in objects) and
                not any(o.name.startswith('GEN_') for o in objects)):
            curve_to_reuse=candidate
        else:
            raise RuntimeError('RACE_TRACK already contains a circuit or custom objects. '
                               'Edit TRACK_Centerline and Refresh Markers; '
                               'do not overwrite the collection.')
    root=existing or bpy.data.collections.new(ROOT)
    if root not in list(scene.collection.children):scene.collection.children.link(root)
    center=_child(root,'RACE_TRACK_SOURCE')
    for name in COLS:_child(root,name)
    curve=curve_to_reuse or _create_curve(center)
    curve.data.dimensions='3D';curve.data.twist_mode='Z_UP'
    scene.lab5_pack.track_curve=curve
    ensure_curve_density(curve)
    width=float(scene.lab5_pack.road_width)
    road_mat=_mat('LAB5 Tarmac',(0.14,0.18,0.23));wall_mat=_mat('LAB5 Safety Wall',(0.92,.36,.23))
    asset_coll=_child(root,'RACE_TRACK_ASSETS')
    # Reference assets define the procedural pieces' appearance and dimensions.
    # Their materials feed the live GN trees. They are *not* exported separately.
    for name,dim,mat in [('ASSET_Tarmac',(1.,1.,.15),road_mat),('ASSET_Barrier',(float(scene.lab5_pack.guardrail_thickness),1.,float(scene.lab5_pack.guardrail_height)),wall_mat)]:
        if name not in bpy.data.objects:
            mesh=bpy.data.meshes.new(name+'_reference')
            mesh.from_pydata([(-.5,-.5,-.5),(.5,-.5,-.5),(.5,.5,-.5),(-.5,.5,-.5),(-.5,-.5,.5),(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5)], [], [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
            mesh.update();o=bpy.data.objects.new(name,mesh);asset_coll.objects.link(o)
            o.scale=dim;mesh.materials.append(mat);o.hide_render=True;o.hide_set(True)
    ref=bpy.data.objects.get('ASSET_Barrier')
    if ref:ref.scale=(float(scene.lab5_pack.guardrail_thickness),1.,float(scene.lab5_pack.guardrail_height))
    road_group=_profile_geometry_nodes(curve,'LAB5 LIVE 3D Road Width %.2f'%width,width,material=road_mat)
    for coll,name in [('RACE_VISUALS','GEN_RoadVisual'),('RACE_COLLISION','GEN_RoadCollision')]:
        o=_mesh_host(_child(root,coll),name);_attach(o,road_group,road_mat)
        if coll=='RACE_COLLISION':
            # The physics road is an open, upward-facing ribbon, never a
            # Solidify volume with additional underside/edge collision faces.
            for modifier in o.modifiers:
                if modifier.type=='SOLIDIFY': modifier.show_viewport=False;modifier.show_render=False
    for side,name in [(-1,'GEN_InnerWall'),(1,'GEN_OuterWall')]:
        group=_profile_geometry_nodes(curve,'LAB5 LIVE '+name,width,side*width*.53,height=float(scene.lab5_pack.guardrail_height),material=wall_mat)
        o=_mesh_host(_child(root,'RACE_WALLS'),name);_attach(o,group,wall_mat,solidify=float(scene.lab5_pack.guardrail_thickness),offset=0)
    if not bpy.data.objects.get('SPLAT_ANCHOR'):
        anchor=bpy.data.objects.new('SPLAT_ANCHOR',None);center.objects.link(anchor);anchor.empty_display_type='PLAIN_AXES'
    # Movable crate is optional. A positive Z mesh position is Blender height.
    dyn=_child(root,'RACE_DYNAMIC')
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,-8,0.70))
    crate=bpy.context.object;crate.name='DYN_crate';crate.dimensions=(1.1,1.1,1.1)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    _link(crate,dyn)
    bpy.ops.rigidbody.object_add();crate.rigid_body.type='ACTIVE';crate.rigid_body.collision_shape='BOX';crate.rigid_body.mass=45
    refresh_markers(scene)
    return curve
