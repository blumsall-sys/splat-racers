"""Blender 5.x exporter, keeps game sources and other addons untouched."""
import bpy, math, os, json, shutil, tempfile, datetime, pathlib, hashlib, zipfile
from mathutils import Vector, Matrix
from .schema import clean_id,browser_point,browser_yaw,check_track
from .heightfield_grid import choose_grid
from .track_quality import wall_segment_count, make_wall_segment

COLS=('RACE_VISUALS','RACE_COLLISION','RACE_WALLS','RACE_DYNAMIC','RACE_WAYPOINTS','RACE_GATES','RACE_SPAWNS')
PROXY_COLS=('RACE_PROXY_STATIC','RACE_PROXY_DYNAMIC')

def collection(name):
    c=bpy.data.collections.get(name)
    return list(sorted(c.all_objects,key=lambda o:o.name)) if c else []

def mesh_objects(name):return [o for o in collection(name) if o.type=='MESH']

def planar(o):return browser_point(o.matrix_world.translation)

def dimensions(o):
    corners=[o.matrix_world @ Vector(v) for v in o.bound_box]
    center=sum(corners,Vector())/8
    # This is a *yaw-only* box proxy: a deliberate simplification, not a concave collider.
    sc=o.matrix_world.to_scale()
    bb=[Vector(v) for v in o.bound_box]
    dims=[(max(p[i] for p in bb)-min(p[i] for p in bb))*abs(sc[i]) for i in range(3)]
    return center,dims

def as_box(o,strict=True):
    if o.type!='MESH':raise ValueError(o.name+' must be a mesh box')
    r=o.matrix_world.to_euler('XYZ')
    if strict and (abs(r.x)>.05 or abs(r.y)>.05):raise ValueError(o.name+' rotated on X/Y; box proxy accepts yaw only')
    p,dim=dimensions(o)
    if min(dim)<.005: raise ValueError('Zero-size mesh '+o.name)
    return dict(x=round(p.x,4),z=round(-p.y,4),y=round(p.z,4),w=round(dim[0],4),d=round(dim[1],4),h=round(dim[2],4),yaw=browser_yaw(r.z))

def _proxy_entry(o,kind):
    """Export editable wireframe primitives as compact Ammo-compatible JSON.

    glTF's Y-up mapping is C @ M @ C^-1, so the quaternion conversion
    must match the mesh exporter. World bbox centre captures offset geometry.
    Mesh data is never sent to the browser for these proxy-only objects.
    """
    shape=o.get('lab5_collider_shape','BOX')
    if shape not in ('BOX','SPHERE'):
        raise ValueError(o.name+': supported proxy shapes are BOX and SPHERE')
    if o.type!='MESH':raise ValueError(o.name+': proxy must be a mesh')
    center,dims=dimensions(o)
    if min(dims)<.005:raise ValueError(o.name+': collider dimension is zero')
    C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    q=(C @ o.matrix_world.to_quaternion().to_matrix().to_4x4() @ C.inverted()).to_quaternion()
    result={'id':o.name,'bodyType':kind,'shape':shape,
        'position':[round(center.x,5),round(center.z,5),round(-center.y,5)],
        'rotation':[round(q.x,7),round(q.y,7),round(q.z,7),round(q.w,7)]}
    if shape=='BOX':result['halfExtents']=[round(v*.5,5) for v in (dims[0],dims[2],dims[1])]
    else:
        # Physics spheres must remain isotropic. The widest dimension wins.
        result['radius']=round(max(dims)*.5,5)
    rb=o.rigid_body
    result['friction']=round(float(rb.friction),4) if rb else .85
    result['restitution']=round(float(rb.restitution),4) if rb else .02
    if kind=='dynamic':result['mass']=round(float(rb.mass),4) if rb else 30.0
    if bool(o.get('lab5_drivable',False)):
        result['drivable']=True
    return result

def _write_curve_road_uv(mesh,source,scene):
    """Evaluate road UVs on the temporary mesh only; no GN or source edits.

    U measures the signed cross-track offset; V measures closed-curve distance.
    The mapping follows hills and banking via the curve frame, unlike Object
    or Generated coords. Face-corner values preserve the closed-loop seam.
    """
    from .track_builder import _curve_samples_with_tilt, _samples_with_frames
    from mathutils.kdtree import KDTree
    curve=scene.lab5_pack.track_curve or bpy.data.objects.get('TRACK_Centerline')
    if not curve or curve.type!='CURVE':return False
    samples=_curve_samples_with_tilt(curve,per_segment=32)
    positions=[p for p,_ in samples]
    length=sum((positions[(i+1)%len(positions)]-p).length for i,p in enumerate(positions))
    if length<.1:return False
    count=min(3000,max(96,math.ceil(length/.45)))
    frames=_samples_with_frames(curve,count)
    kdt=KDTree(count)
    for i,(pos,tangent,lateral,up) in enumerate(frames):kdt.insert(pos,i)
    kdt.balance()
    road_width=max(.5,float(scene.lab5_pack.road_width))
    repeat=max(.1,float(scene.lab5_pack.road_uv_repeat_length))
    repeats=length/repeat
    coords=[]
    for vertex in mesh.vertices:
        at=source.matrix_world @ vertex.co
        _,index,_=kdt.find(at)
        position,tangent,lateral,up=frames[index]
        delta=at-position
        lateral_offset=delta.dot(lateral)
        # The nearest sampled point is corrected by its longitudinal error.
        # This eliminates most half-sample longitudinal quantization.
        fractional=(index/count+delta.dot(tangent)/length)%1.0
        coords.append((.5 + lateral_offset/road_width, fractional*repeats))
    uv=mesh.uv_layers.get('RoadUV') or mesh.uv_layers.new(name='RoadUV')
    for polygon in mesh.polygons:
        corner_indices=polygon.loop_indices
        values=[coords[mesh.loops[i].vertex_index] for i in corner_indices]
        # Closed curve: seam vertices have V near 0 and near length/repeat.
        # Their values must be continuous over one triangle, not interpolate
        # through all repetitions across the track surface.
        seam=max(v for _,v in values)-min(v for _,v in values)>max(1,repeats*.5)
        for i,(u,v) in zip(corner_indices,values):
            if seam and v<repeats*.5:v+=repeats
            uv.data[i].uv=(u,v)
    mesh.uv_layers.active=uv
    return True

def _export_road_material(source_material):
    """Clone a road shader for GLB so Object/Box projection cannot escape.

    The source Blender shader tree and its TIF/PBR image data are untouched;
    GLB copies use the actual curve UV attribute baked on the export mesh.
    """
    if not source_material or not source_material.use_nodes:return None
    tex_nodes=[n for n in source_material.node_tree.nodes
               if n.type=='TEX_IMAGE' and n.image is not None]
    if not tex_nodes:return None
    copy=source_material.copy()
    copy.name='LAB5_GLTF_'+source_material.name
    tree=copy.node_tree
    uvmap=tree.nodes.new('ShaderNodeUVMap')
    uvmap.uv_map='RoadUV'
    for node in list(tree.nodes):
        if node.type=='TEX_IMAGE' and node.image is not None:
            node.projection='FLAT'
            tree.links.new(uvmap.outputs['UV'],node.inputs['Vector'])
    return copy

def _gltf_selection(objs,dest,localize=False,world_to_local=None):
    if not objs:return None
    os.makedirs(os.path.dirname(dest),exist_ok=True)
    oldactive=bpy.context.view_layer.objects.active
    selected=list(bpy.context.selected_objects)
    temporary=[]
    temporary_materials=[]
    try:
        bpy.ops.object.select_all(action='DESELECT')
        depsgraph=bpy.context.evaluated_depsgraph_get()
        selected_for_export=[]
        for o in objs:
            if localize or world_to_local is not None or o.get('lab5_generated'):
                # Geometry Nodes can leave the source mesh empty. The glTF exporter
                # must see an evaluated TRIANGLE MESH, not only the edit-mode host.
                # Use ONLY the drivable top strip for a generated road collider.
                # A road's SOLIDIFY underside and edge faces are NOT part of
                # the road physics: they introduce hidden geometry at seams.
                # Restore the artist's modifier flags even if evaluated export fails.
                disabled=[]
                if o.name=='GEN_RoadCollision':
                    for modifier in o.modifiers:
                        if modifier.type=='SOLIDIFY':
                            disabled.append((modifier,modifier.show_viewport,modifier.show_render))
                            modifier.show_viewport=False;modifier.show_render=False
                try:
                    depsgraph.update()
                    evaluated=o.evaluated_get(depsgraph)
                    mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=depsgraph)
                finally:
                    for modifier,viewport,render in disabled:
                        modifier.show_viewport=viewport;modifier.show_render=render
                    if disabled:depsgraph.update()
                if mesh is None or not len(mesh.polygons):
                    raise RuntimeError(f'Generated mesh {o.name} has no faces. Check Curve + Geometry Nodes.')
                # Preserve PBR material slots when copying evaluated GN meshes.
                # Material fields on the source object are otherwise sometimes
                # lost after new_from_object() and render white in the GLB.
                if not mesh.materials and o.data.materials:
                    for material in o.data.materials:mesh.materials.append(material)
                if o.name == 'GEN_RoadVisual' and bool(getattr(bpy.context.scene.lab5_pack,'force_curve_road_uv',True)):
                    _write_curve_road_uv(mesh,o,bpy.context.scene)
                if o.name in {'GEN_RoadVisual','GEN_InnerWall','GEN_OuterWall'}:
                    # Geometry Nodes' Curve-to-Mesh output may not carry a UV
                    # map, even when a user assigns a Principled image texture.
                    # Make a deterministic per-face planar UV on the *temporary*
                    # evaluated export mesh only. The editable GN graph and
                    # original artist materials are left untouched.
                    uv=mesh.uv_layers.active
                    needs_uv=not uv or (len(uv.data)>1 and all(
                        (v.uv-uv.data[0].uv).length<1e-6 for v in list(uv.data)[:min(32,len(uv.data))]))
                    if needs_uv:
                        if uv is None:uv=mesh.uv_layers.new(name='LAB5_Export_UV')
                        for polygon in mesh.polygons:
                            normal=(o.matrix_world.to_3x3() @ polygon.normal).normalized()
                            planar=abs(normal.z)>0.55
                            vertical_x=abs(normal.x)>abs(normal.y)
                            for idx in polygon.loop_indices:
                                vert=mesh.vertices[mesh.loops[idx].vertex_index]
                                p=o.matrix_world @ vert.co
                                if planar:u,v=p.x/4,p.y/4
                                elif vertical_x:u,v=p.y/4,p.z/4
                                else:u,v=p.x/4,p.z/4
                                uv.data[idx].uv=(u,v)
                if o.name=='GEN_RoadVisual' and mesh.uv_layers.get('RoadUV'):
                    for material_index,source_material in enumerate(list(mesh.materials)):
                        rendered=_export_road_material(source_material)
                        if rendered:
                            mesh.materials[material_index]=rendered
                            temporary_materials.append(rendered)
                dup=bpy.data.objects.new('EXPORTED_'+o.name,mesh)
                bpy.context.scene.collection.objects.link(dup)
                if world_to_local is not None:
                    dup.matrix_world=world_to_local @ o.matrix_world
                elif localize:
                    dup.matrix_world=Matrix.Diagonal((*o.matrix_world.to_scale(),1.0))
                else:
                    dup.matrix_world=o.matrix_world.copy()
                dup.select_set(True);temporary.append(dup)
                selected_for_export.append(dup)
            else:
                o.select_set(True);selected_for_export.append(o)
        bpy.context.view_layer.objects.active=selected_for_export[0]
        bpy.ops.export_scene.gltf(filepath=dest,export_format='GLB',use_selection=True,
            export_yup=True,export_animations=False,export_cameras=False,export_lights=False,
            export_apply=False,export_materials='EXPORT',export_image_format='AUTO',
            export_texcoords=True,export_normals=True,check_existing=False,export_extras=True)
    finally:
        for tmp in temporary:
            mesh=tmp.data;bpy.data.objects.remove(tmp,do_unlink=True)
            if mesh.users==0:bpy.data.meshes.remove(mesh)
        for mat in temporary_materials:
            if mat.users==0:bpy.data.materials.remove(mat)
        bpy.ops.object.select_all(action='DESELECT')
        for o in selected:
            if o.name in bpy.data.objects:o.select_set(True)
        if oldactive and oldactive.name in bpy.data.objects:bpy.context.view_layer.objects.active=oldactive
    if not os.path.isfile(dest) or os.path.getsize(dest)<20:raise RuntimeError('GLB export missing '+dest)
    return dest

def _sample_heightfield(objs,points=0.5,max_cells=25000):
    # Blender raycasts against evaluated collision meshes, never moving props/walls.
    if not objs:return None
    from mathutils.bvhtree import BVHTree
    dg=bpy.context.evaluated_depsgraph_get()
    surfaces=[];xs=[];ys=[]
    for obj in objs:
        tree=BVHTree.FromObject(obj,dg)
        if not tree:continue
        mat=obj.matrix_world.copy();inv=mat.inverted_safe()
        surfaces.append((tree,mat,inv))
        evaluated=obj.evaluated_get(dg)
        for v in evaluated.bound_box:
            pt=mat @ Vector(v);xs.append(pt.x);ys.append(pt.y)
    if not surfaces:return None
    minx,maxx=min(xs),max(xs);miny,maxy=min(ys),max(ys)
    # Legacy heightfield is OPTIONAL for the PlayCanvas/Ammo game: the static
    # RACE_COLLISION GLB supplies the actual 3D road. When explicitly requested,
    # choose a coarser effective spacing instead of blocking the whole asset pack.
    step,width,depth=choose_grid(maxx-minx,maxy-miny,points,max_cells)
    if step>points*1.001:
        print(f'[LAB5 RACE] Legacy heightfield coarsened from {points:.2f}m to {step:.3f}m ({width}x{depth}); GLB collision remains authoritative')
    values=[]
    for j in range(depth):
        by=miny+j*step
        for i in range(width):
            bx=minx+i*step
            highest=None
            for tree,mat,inv in surfaces:
                start=inv @ Vector((bx,by,1000))
                localdir=inv.to_3x3() @ Vector((0,0,-1))
                hit,normal,index,distance=tree.ray_cast(start,localdir,2000)
                if hit is not None:
                    h=(mat @ hit).z
                    if highest is None or h>highest:highest=h
            values.append(round(highest if highest is not None else 0.0,4))
    return dict(origin={'x':round(minx,4),'z':round(-maxy,4)}, cellSize=round(step,4),
        width=width,depth=depth,samples=[values[(depth-1-j)*width+i] for j in range(depth) for i in range(width)])

def _sorted_gates():
    group={o.name:o for o in collection('RACE_GATES')}
    prefixes=sorted([n[:-2] for n in group if n.endswith('_A')],key=lambda n:(0 if n=='GATE_START' else 1,n))
    result=[]
    for pre in prefixes:
        if pre+'_B' not in group:raise ValueError('Missing endpoint '+pre+'_B')
        result.append({'id': 'START_FINISH' if pre=='GATE_START' else pre.replace('GATE_',''),
            'a':planar(group[pre+'_A']),'b':planar(group[pre+'_B'])})
    return result

def _curve_proxy_walls(scene):
    """Short, OUTSIDE-the-road box segments, matching the 3D curve frame.

    The old 64 large box segments cut across bends and entered the road lane.
    Boxes follow the sampled centreline with <=0.6m chord length, and their
    near side sits outside the authored road width. This creates more boxes,
    but each primitive is cheap and isolated from the road triangle mesh.
    """
    from .track_builder import _samples_with_frames, _curve_samples_with_tilt
    curve=scene.lab5_pack.track_curve or bpy.data.objects.get('TRACK_Centerline')
    if curve is None:return []
    points=[point for point,_ in _curve_samples_with_tilt(curve)]
    length=sum((points[(i+1)%len(points)]-p).length for i,p in enumerate(points))
    frames=_samples_with_frames(curve,wall_segment_count(length,.60))
    half=float(scene.lab5_pack.road_width)*.5
    height=max(2.,float(scene.lab5_pack.guardrail_height))
    thickness=max(.36,float(scene.lab5_pack.guardrail_thickness))
    walls=[]
    for i,(pos,tangent,lateral,up) in enumerate(frames):
        next_pos,next_tangent,next_lateral,next_up=frames[(i+1)%len(frames)]
        for side,label in ((-1,'INNER'),(1,'OUTER')):
            # Shift outward from the ROAD EDGE, not toward the driving lane.
            offset=half+thickness*.5+.18
            a=pos+lateral*(offset*side)
            b=next_pos+next_lateral*(offset*side)
            seg=make_wall_segment(a,b,height,thickness,up,next_up)
            if seg is None:continue
            seg['id']=f'GEN_{label}_{i:03d}'
            walls.append(seg)
    return walls

def _collect_navigation_corridor(scene):
    """Export a dense driving corridor from the SAME editable Bezier path.

    This data is for NPC speed planning only: it cannot add physics, move the
    road, change a gate, or affect the visual splat.  Blender remains the
    source of truth when artists move handles or adjust a tight corner.
    """
    from .track_builder import _curve_samples_with_tilt, _samples_with_frames
    from .driveability import analyze_samples
    curve=scene.lab5_pack.track_curve or bpy.data.objects.get('TRACK_Centerline')
    if curve is None or curve.type!='CURVE':return None
    samples=_curve_samples_with_tilt(curve,per_segment=32)
    drive=analyze_samples(samples,scene.lab5_pack.road_width)
    count=min(800,max(96,math.ceil(drive['length_m']/.65)))
    frames=_samples_with_frames(curve,count,float(scene.lab5_pack.start_percent)/100.0)
    half=max(1.0,float(scene.lab5_pack.road_width)*.5-.25)
    total=float(drive['length_m'])
    nav=[]
    for index,(p,t,lateral,up) in enumerate(frames):
        # Browser Y-up mapping = (Blender X, Blender Z, -Blender Y).
        nav.append({'x':round(p.x,5),'y':round(p.z,5),'z':round(-p.y,5),
            's':round(total*index/count,5),'left':round(half,4),'right':round(half,4),
            'heading':round(math.atan2(t.x,-t.y),6)})
    return {'version':1,'points':nav,'length':round(total,4),
        'source':'TRACK_Centerline','spacingMeters':round(total/count,4),
        'driveability':{'tightestRadiusMeters':round(float(drive['tightest_radius_m']),3),
         'maximumGrade':round(float(drive['grade']),4),'warnings':drive['warnings']}}

def _collect_track(scene,template):
    t=json.loads(json.dumps(template))
    walls=[]
    for o in mesh_objects('RACE_WALLS'):
        if o.get('lab5_generated'):continue # real GN wall mesh exported via GLB
        p=as_box(o)
        walls.append(dict(id=o.name,x=p['x'],z=p['z'],hx=p['w']/2,hz=p['d']/2,
            yaw=p['yaw'],y=p['y'],height=p['h']))
    walls.extend(_curve_proxy_walls(scene))
    t['collision']['walls']=walls
    t['levelType']=scene.lab5_pack.level_type
    t['collision']['obstacles']=[]
    t['collision']['bumps']=[] # Replace rather than retain stale hand-authored bumps.
    if scene.lab5_pack.heightfield:
        hf=_sample_heightfield(mesh_objects('RACE_COLLISION'),scene.lab5_pack.cell_size)
        if hf:
            t['collision']['heightfield']=hf
            scene.lab5_pack.heightfield_note=f"Heightfield {hf['width']}x{hf['depth']}, actual {hf['cellSize']:.3f}m (optional; GLB is physics)"
        else:
            t['collision'].pop('heightfield',None)
            scene.lab5_pack.heightfield_note='No road to sample; Ammo still uses exported collision.glb'
    else:
        t['collision'].pop('heightfield',None)
        scene.lab5_pack.heightfield_note='Disabled (recommended): Ammo uses exported collision.glb'
    t['race']['effects']=[dict(kind=o['race_effect'],**planar(o),y=float(o.matrix_world.translation.z),
                              radius=max(.1,o.empty_display_size*max(abs(v) for v in o.matrix_world.to_scale())))
                          for o in scene.objects if o.get('race_effect') in ('speed','grease')]
    t['race']['waypoints']=[planar(o) for o in collection('RACE_WAYPOINTS') if o.name.startswith('WP_')]
    t['race']['gates']=_sorted_gates()
    t['race']['finishLineInVisuals']=bool(bpy.data.objects.get('GEN_FinishLine'))
    t['race']['startFraction']=round(float(scene.lab5_pack.start_percent)/100,5)
    t['race']['airGateStartOffsetFraction']=round(float(getattr(scene.lab5_pack,'air_gate_start_offset_percent',0.0))/100,5)
    t['race']['airGates']=_collect_air_gates(scene)
    t['race']['firstAirRingDistanceMeters']=float(scene.get('lab5_effective_first_ring_offset_m',0))
    t['race']['airGateVisuals']=bool(t['race']['airGates'])
    t['race']['roadWidth']=float(scene.lab5_pack.road_width)
    navigation=_collect_navigation_corridor(scene)
    if navigation:t['race']['navigation']=navigation
    sp={o.name:o for o in collection('RACE_SPAWNS')}
    for k in ('p1','p2','p3','p4'):
        ob=sp.get('SPAWN_'+k.upper())
        if not ob:
            if k in ('p3','p4'):continue  # Older Blender scenes remain exportable: runtime derives back row.
            raise ValueError('Missing SPAWN_'+k.upper())
        t['spawns'][k]={**planar(ob),'y':round(float(ob.matrix_world.translation.z),5),
            'yaw':browser_yaw(ob.matrix_world.to_euler('XYZ').z)}
    # All visible meshes are GLB; conservative box fallback for software renderer.
    t['visuals']={'mode':'asset','boxes':[]}
    for o in mesh_objects('RACE_VISUALS'):
        if o.get('lab5_generated'):continue # GN road mesh is visual GLB
        b=as_box(o,strict=False)
        t['visuals']['boxes'].append({**b,'id':o.name,'color':'#667a70'})
    return check_track(t)

def _collect_air_gates(scene):
    """Export 3D gate centers and forward normal from authored offset Empties.
    Rings have no physics collider: the game tests oriented plane crossings.
    """
    from .track_builder import refresh_air_gates
    count=int(scene.lab5_pack.air_gate_count)
    if count<=0:return []
    if scene.lab5_pack.level_type=='FREE_ROAM' and not (scene.lab5_pack.track_curve or bpy.data.objects.get('TRACK_Centerline')):return []
    expected=['AIR_OFFSET_%02d'%k for k in range(count)]
    # Always refresh generated ANCHOR transforms before exporting, even when
    # the Empties already exist. Changes to start %, clearance or curve shape
    # otherwise leave stale rings, while AIR_OFFSET local edits stay intact.
    if refresh_air_gates(scene)<count:
        raise ValueError('Cannot refresh flight rings: missing TRACK_Centerline or RACE_TRACK collection. Assign a track curve or set Flight Rings to 0.')
    bpy.context.view_layer.update()
    entries=[]
    for k,name in enumerate(expected):
        ob=bpy.data.objects.get(name)
        if not ob:raise ValueError('Air checkpoint offset missing: '+name)
        m=ob.matrix_world
        center=m.translation
        direction=(m.to_3x3() @ Vector((0,0,1))).normalized()
        scale=m.to_scale()
        radius=float(ob.get('lab5_ring_radius',scene.lab5_pack.air_ring_radius))*min(abs(scale.x),abs(scale.y))
        if radius<=.4:raise ValueError(name+' radius must exceed 0.4m')
        entries.append({'id':'AIR_%02d'%k,'position':[round(center.x,5),round(center.z,5),round(-center.y,5)],
                        'normal':[round(direction.x,7),round(direction.z,7),round(-direction.y,7)],
                        'radius':round(radius,4)})
    return entries

def _collect_lights():
    lights=[]
    C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    for ob in collection('RACE_LIGHTS'):
        if ob.type!='LIGHT' or ob.data.type not in {'POINT','SUN','SPOT'}:continue
        data=ob.data;matrix=C @ ob.matrix_world @ C.inverted()
        q=matrix.to_quaternion();p=ob.matrix_world.translation
        entry={'id':ob.name,'type':{'POINT':'omni','SUN':'directional','SPOT':'spot'}[data.type],
           'position':[round(p.x,5),round(p.z,5),round(-p.y,5)],
           'rotation':[round(q.x,7),round(q.y,7),round(q.z,7),round(q.w,7)],
           'color':[round(max(0,min(1,float(v))),5) for v in data.color],
           'intensity':round(max(.01,min(12,float(data.energy) if data.type=='SUN' else float(data.energy)/800)),4),
           'range':round(max(1,min(150,float(getattr(data,'cutoff_distance',35)) if getattr(data,'use_custom_distance',False) else 35)),3),
           'castShadows':bool(getattr(data,'use_shadow',True))}
        if data.type=='SPOT':
            entry['outerConeAngle']=round(float(data.spot_size)*180/3.141592653589793*.5,4)
            entry['innerConeAngle']=round(entry['outerConeAngle']*(1-float(data.spot_blend)),4)
        lights.append(entry)
    if len(lights)>64:raise ValueError('Too many Blender lights (max 64)')
    return lights

def _export_vehicles(scene,dest,relative):
    from .vehicle_tools import roots,vehicle_parts,KINDS
    entries=[];seen=set()
    for root in roots():
        ident=clean_id(root.get('lab5_vehicle_id') or root.name)
        if ident in seen:raise ValueError('Duplicate vehicle ID '+ident)
        seen.add(ident)
        kind=str(root.get('lab5_vehicle_type','KART')).upper()
        if kind not in KINDS:raise ValueError(root.name+' unknown vehicle type '+kind)
        meshes=vehicle_parts(root)
        body=[ob for ob in meshes if not ob.get('lab5_vehicle_wheel')]
        wheels=[ob for ob in meshes if ob.get('lab5_vehicle_wheel')]
        if not body:raise ValueError(root.name+' has no body meshes to export')
        folder=os.path.join(dest,'vehicles',ident)
        root_inv=root.matrix_world.inverted_safe()
        _gltf_selection(body,os.path.join(folder,'body.glb'),world_to_local=root_inv)
        entry={'id':ident,'label':str(root.get('lab5_vehicle_label') or root.name)[:75],
               'type':kind,'bodyGlb':relative+'/vehicles/'+ident+'/body.glb',
               'mass':round(max(15,min(2000,float(root.get('lab5_vehicle_mass',170)))),3),
               'jumpSpeed':round(max(1,min(14,float(root.get('lab5_vehicle_jump_speed',5.5)))),3),
               'hoverHeight':round(max(.6,min(12,float(root.get('lab5_vehicle_hover_height',2.45)))),3),
               'hoverHopInterval':round(max(.35,min(2,float(root.get('lab5_vehicle_hover_hop_interval',.78)))),3),
               'hoverHopStep':round(max(1,min(8,float(root.get('lab5_vehicle_hover_hop_step',3)))),3),
               'maxSpeed':round(max(3,min(55,float(root.get('lab5_vehicle_max_speed',12.5)))),3),
               'acceleration':round(max(1,min(10,float(root.get('lab5_vehicle_acceleration',4.5)))),3),
               'stabilityAssist':round(max(.5,min(2,float(root.get('lab5_vehicle_stability_assist',1)))),3),
               'autoRightSeconds':round(max(1.2,min(6,float(root.get('lab5_vehicle_auto_right_seconds',2.6)))),3)}
        proxy=next((o for o in root.children_recursive if o.type=='MESH' and o.get('lab5_vehicle_collider')),None)
        if proxy:
            local=root_inv @ proxy.matrix_world
            dim=proxy.dimensions.copy()
            # proxy.dimensions already accounts for its local object scale.
            entry['chassisHalfExtents']=[round(max(.1,dim.x/2),4),round(max(.1,dim.z/2),4),round(max(.1,dim.y/2),4)]
        if kind=='KART' and wheels:
            # Recenter a single wheel prototype; Ammo's four wheel transforms
            # position and animate copies. Remaining preview wheels stay in .blend.
            first=wheels[0]
            front=next((o for o in wheels if '_FRONT_' in o.name),None)
            rear=next((o for o in wheels if '_REAR_' in o.name),None)
            if front and rear:
                fp=root_inv @ front.matrix_world.translation;rp=root_inv @ rear.matrix_world.translation
                entry['wheelTrack']=round(max(.3,abs(fp.x)),4)
                entry['wheelAxle']=round(max(.3,(abs(fp.y)+abs(rp.y))*.5),4)
            local_center=root_inv @ first.matrix_world.translation
            local_matrix=Matrix.Translation(-local_center) @ root_inv
            _gltf_selection([first],os.path.join(folder,'wheel.glb'),world_to_local=local_matrix)
            entry['wheelGlb']=relative+'/vehicles/'+ident+'/wheel.glb'
        entries.append(entry)
    if len(entries)>40:raise ValueError('Up to 40 vehicle blueprints per pack')
    return entries

def _sha256_file(filename):
    digest=hashlib.sha256()
    with open(filename,'rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024),b''):
            digest.update(chunk)
    return digest.hexdigest()

def _verify_bundled_sog(filename):
    """Read bundled SuperSplat SOG metadata (no WebP decompression)."""
    try:
        with zipfile.ZipFile(filename) as archive:
            entries=set(archive.namelist())
            if 'meta.json' not in entries:
                raise ValueError('SOG archive is missing meta.json in its root')
            meta=json.loads(archive.read('meta.json'))
            if not isinstance(meta,dict) or not isinstance(meta.get('count'),int) or meta['count'] < 1:
                raise ValueError('SOG meta.json has no valid Gaussian count')
            if meta.get('version') != 2:
                raise ValueError('SOG meta.json uses unsupported version: '+str(meta.get('version')))
            required=[]
            for field in ('means','scales','quats','sh0'):
                obj=meta.get(field)
                if not isinstance(obj,dict) or not isinstance(obj.get('files'),list) or not obj['files']:
                    raise ValueError('SOG meta.json missing '+field+'.files')
                required.extend(obj['files'])
            if isinstance(meta.get('shN'),dict):required.extend(meta['shN'].get('files',[]))
            missing=[name for name in required if name not in entries]
            if missing:raise ValueError('SOG missing compressed texture(s): '+', '.join(missing[:4]))
            return {'gaussians':meta['count'],'sogFormatVersion':meta['version']}
    except (zipfile.BadZipFile,json.JSONDecodeError,KeyError) as exc:
        raise ValueError('Invalid bundled .sog archive: '+str(exc)) from exc

def _copy_optional(src,destination):
    if not src:return None
    p=bpy.path.abspath(src)
    if not os.path.isfile(p) or os.path.getsize(p)==0:raise ValueError('Missing optional asset '+p)
    shutil.copy2(p,destination)
    return os.path.basename(destination)

def _playcanvas_material_overrides():
    """Portable material hints. GLB PBR maps are still the source of truth.
    The PlayCanvas game only overrides selected materials with a glass preset.
    In Blender, name the material LAB5_GLASS_Window or set its custom
    property lab5_pc_shader='GLASS' to opt in.
    """
    out={}
    for mat in bpy.data.materials:
        hint=str(mat.get('lab5_pc_shader','')).upper()
        if hint!='GLASS' and not mat.name.upper().startswith('LAB5_GLASS'):continue
        out[mat.name]={'kind':'glass',
            'opacity':round(max(.05,min(.95,float(mat.get('lab5_pc_opacity',.26)))),3),
            'roughness':round(max(0.,min(1.,float(mat.get('lab5_pc_roughness',.1)))),3),
            'refractionIndex':round(max(1.,min(2.,float(mat.get('lab5_pc_ior',1.45)))),3)}
    return out

def validate_scene(scene):
    errors=[];warnings=[]
    for name in COLS:
        if not bpy.data.collections.get(name) and (scene.lab5_pack.level_type!='FREE_ROAM' or name=='RACE_SPAWNS'):
            errors.append('Missing collection: '+name)
    for key in ('RACE_WALLS','RACE_VISUALS','RACE_DYNAMIC','RACE_COLLISION'):
        if not mesh_objects(key):warnings.append(key+' has no meshes')
    for ob in mesh_objects('RACE_DYNAMIC'):
        if not ob.rigid_body or ob.rigid_body.type!='ACTIVE':errors.append(ob.name+' must have ACTIVE rigid body')
        if ob.rigid_body and ob.rigid_body.collision_shape=='MESH':warnings.append(ob.name+': use BOX or CONVEX_HULL for moving collider')
    if (scene.lab5_pack.sog_file and not scene.lab5_pack.sog_source_is_aligned and
            not scene.lab5_pack.splat_alignment_object and not bpy.data.objects.get('SOG_PLACEMENT')):
        errors.append('SOG placement not calibrated: create SOG_PLACEMENT BEFORE Apply Transforms, or explicitly confirm source PLY is already aligned. Object Apply All never changes the PLY file.')
    if scene.lab5_pack.sog_file and not scene.lab5_pack.sog_source_is_aligned and not scene.lab5_pack.splat_alignment_object and not bpy.data.objects.get('SOG_PLACEMENT'):
        warnings.append('No explicit SOG placement. Raw PLY remains untransformed. Use SOG_PLACEMENT or source-aligned KIRI Export PLY.')
    placement=scene.lab5_pack.splat_alignment_object or bpy.data.objects.get('SOG_PLACEMENT')
    if scene.lab5_pack.sog_file and placement and not scene.lab5_pack.sog_source_is_aligned:
        t=placement.matrix_world.to_translation()
        sc=placement.matrix_world.to_scale()
        rot=placement.matrix_world.to_euler('XYZ')
        if all(abs(x-1)<1e-3 for x in sc) and t.length<1e-3 and all(abs(v)<1e-3 for v in rot):
            warnings.append('SOG_PLACEMENT is IDENTITY. If KIRI scale/rotation were Applied All, restore those values on this Empty manually before exporting.')
    if not mesh_objects('RACE_COLLISION') and not any(bool(ob.get('lab5_drivable')) for ob in mesh_objects('RACE_PROXY_STATIC')):
        errors.append('RACE_COLLISION must contain actual road meshes, or mark a STATIC proxy as drivable before export')
    for coll in PROXY_COLS:
        for o in mesh_objects(coll):
            try:_proxy_entry(o,'static' if coll=='RACE_PROXY_STATIC' else 'dynamic')
            except ValueError as e:errors.append(str(e))
    for ob in mesh_objects('RACE_COLLISION')+mesh_objects('RACE_WALLS'):
        if ob.get('lab5_generated'):
            try:
                dg=bpy.context.evaluated_depsgraph_get()
                ev=ob.evaluated_get(dg)
                mesh=ev.to_mesh()
                try:
                    if mesh is None or len(mesh.polygons)<4:
                        errors.append(ob.name+': Geometry Nodes yielded no drivable/exportable faces')
                finally:
                    ev.to_mesh_clear()
            except Exception as e:
                errors.append(ob.name+': geometry validation failed: '+str(e))
    if not scene.lab5_pack.sog_file:
        message='NO SOG LINKED: choose SuperSplat bundled .sog in SOG file. Export would write splat: {} in asset-pack.json.'
        if scene.lab5_pack.allow_no_sog_export:warnings.append(message+' Intentionally allowed.')
        else:errors.append(message+' To intentionally make a no-splat test, enable Allow export without Gaussian SOG.')
    if scene.lab5_pack.splat_ply and not scene.lab5_pack.sog_file:
        warnings.append('Gaussian PLY selected without SOG. Use Convert PLY button first (CLI required).')
    # Directional flight preflight is advisory (artist-authored offsets must
    # never be overwritten). The refresh/export step repairs generated anchor
    # positions, but deliberately preserves AIR_OFFSET_XX artist edits.
    if int(getattr(scene.lab5_pack,'air_gate_count',0))>0:
        first=bpy.data.objects.get('AIR_OFFSET_00')
        start=bpy.data.objects.get('SPAWN_P1')
        anchor=bpy.data.objects.get('AIR_ANCHOR_00')
        if first and start and anchor:
            center=first.matrix_world.translation
            tangent=(anchor.matrix_world.to_3x3()@Vector((0,0,1))).normalized()
            normal=(first.matrix_world.to_3x3()@Vector((0,0,1))).normalized()
            radius=float(first.get('lab5_ring_radius',scene.lab5_pack.air_ring_radius))
            ahead=(center-start.matrix_world.translation).dot(tangent)
            from_entry=(start.matrix_world.translation-center).dot(normal)
            if ahead<max(1.5,radius*.4):
                warnings.append('First flight ring is behind/too close to the grid. Refresh Flight Rings; check AIR_OFFSET_00 manual position.')
            if from_entry>=-.25:
                warnings.append('P1 spawn is not on AIR_00 entry side. Adjust AIR_OFFSET_00 rotation/position so its +Z arrow points through the ring in the intended direction.')
        for i in range(int(scene.lab5_pack.air_gate_count)):
            offset=bpy.data.objects.get('AIR_OFFSET_%02d'%i)
            anchor=bpy.data.objects.get('AIR_ANCHOR_%02d'%i)
            if not offset or not anchor:continue
            expected=(anchor.matrix_world.to_3x3()@Vector((0,0,1))).normalized()
            actual=(offset.matrix_world.to_3x3()@Vector((0,0,1))).normalized()
            if actual.dot(expected)<-.30:
                warnings.append('AIR_OFFSET_%02d faces backwards relative to TRACK_Centerline. Rotate its local Empty so +Z is the required crossing direction.'%i)
            # NPC driveability is not identical to mesh collision driveability.
            # A tiny distance between differently facing hoops leaves no room
            # for physical yaw rotation or vertical response. Advisory only:
            # preserve the artist's AIR_OFFSET position and orientation.
            if i+1<int(scene.lab5_pack.air_gate_count):
                following=bpy.data.objects.get('AIR_OFFSET_%02d'%(i+1))
                if following:
                    direction=(following.matrix_world.to_3x3()@Vector((0,0,1))).normalized()
                    separation=(following.matrix_world.translation-offset.matrix_world.translation).length
                    next_radius=float(following.get('lab5_ring_radius',scene.lab5_pack.air_ring_radius))
                    turn=math.degrees(math.acos(max(-1.0,min(1.0,actual.dot(direction)))))
                    altitude_change=abs(following.matrix_world.translation.z-offset.matrix_world.translation.z)
                    if separation<max(4.0,min(float(offset.get('lab5_ring_radius',scene.lab5_pack.air_ring_radius)),next_radius)*1.8):
                        warnings.append('Flight rings %02d / %02d are too close (%.1fm). Increase spacing or enlarge the openings for NPC approach/recovery.'%(i,i+1,separation))
                    elif turn>70 and separation<12:
                        warnings.append('Flight rings %02d / %02d change facing by %.0f degrees within %.1fm; flight NPCs will need to brake sharply.'%(i,i+1,turn,separation))
                    if altitude_change>max(4.0,separation*.65):
                        warnings.append('Flight rings %02d / %02d have a steep %.1fm climb/drop over %.1fm. Test hovercraft vertical response.'%(i,i+1,altitude_change,separation))
    return errors,warnings

def export_bundle(scene,template_file):
    errors,warnings=validate_scene(scene)
    if errors:raise ValueError(' | '.join(errors))
    props=scene.lab5_pack
    root=os.path.abspath(bpy.path.abspath(props.game_root))
    if not os.path.isfile(os.path.join(root,'src','main.js')) or not os.path.isfile(os.path.join(root,'package.json')):
        raise ValueError('Game root must be the extracted Splat Racers game folder containing src/main.js')
    assetroot=os.path.join(root,'assets')
    existing_manifest=os.path.join(assetroot,'asset-pack.json')
    previous_pack={}
    if os.path.isfile(existing_manifest):
        with open(existing_manifest,encoding='utf8') as handle:previous_pack=json.load(handle)
    previous_sog=previous_pack.get('splat',{}).get('sog')
    if previous_sog and not props.sog_file and not props.allow_clear_sog:
        raise ValueError('This game already has a SOG but SOG file is blank. Re-select the existing .sog or explicitly enable Remove SOG from next export. Nothing was overwritten.')
    packid=clean_id(props.pack_id)
    stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    versionid=packid+'-'+stamp
    relative='packs/'+versionid
    dest=os.path.join(assetroot,'packs',versionid)
    os.makedirs(dest,exist_ok=False)
    with open(template_file,'r',encoding='utf8') as f:template=json.load(f)
    try:
        track=_collect_track(scene,template)
        # The track guardrails MUST appear in both the visible render GLB and
        # the static collision GLB. The collision hierarchy is hidden by the game.
        # Air ring visuals are rendered but never included in road collision.
        air_visuals=[bpy.data.objects.get('AIR_RING_%02d'%k) for k in range(int(props.air_gate_count))]
        visual_meshes=mesh_objects('RACE_VISUALS')+mesh_objects('RACE_WALLS')+[o for o in air_visuals if o and o.type=='MESH']
        if visual_meshes:
            _gltf_selection(visual_meshes,os.path.join(dest,'visuals.glb'))
        staticmeshes=mesh_objects('RACE_COLLISION')+mesh_objects('RACE_WALLS')
        if staticmeshes:_gltf_selection(staticmeshes,os.path.join(dest,'collision.glb'))
        proxies=[_proxy_entry(o,'static') for o in mesh_objects('RACE_PROXY_STATIC')] + [
            _proxy_entry(o,'dynamic') for o in mesh_objects('RACE_PROXY_DYNAMIC')]
        dynamics=[]
        for j,o in enumerate(mesh_objects('RACE_DYNAMIC')):
            box=as_box(o)
            assetname=f'dynamic_{j:03}.glb'
            _gltf_selection([o],os.path.join(dest,assetname),localize=True)
            rb=o.rigid_body
            mass=float(rb.mass)
            entry={'id':o.name,'x':box['x'],'z':box['z'],'y':box['y'],
                'yaw':box['yaw'],'hx':box['w']/2,'hz':box['d']/2,'mass':mass,
                'color':'#d9b779','visualAsset':relative+'/'+assetname,
                'physics':{'shape':rb.collision_shape,'friction':float(rb.friction),'restitution':float(rb.restitution)}}
            dynamics.append(entry)
        track['collision']['obstacles']=dynamics
        vehicles=_export_vehicles(scene,dest,relative)
        lights=_collect_lights()
        splat={}
        for src,key,name in ((props.sog_file,'sog','track.sog'),(props.voxel_json,'voxel','track.voxel.json'),
            (props.voxel_bin,'voxelBinary','track.voxel.bin'),(props.voxel_collision_glb,'voxelCollisionGlb','track.splat-collision.glb')):
            if _copy_optional(src,os.path.join(dest,name)):splat[key]=relative+'/'+name
        # The original SuperSplat PLY is NOT modified by Blender's Apply Transforms.
        # Only an explicit unbaked placement object is a reliable transform
        # source. A generated identity SPLAT_ANCHOR remains a fallback.
        # A baked/aligned PLY must NOT receive an old SPLAT_ANCHOR again.
        # The placement Empty matrix is stored verbatim after one Z-up -> Y-up conversion.
        anchor=(None if props.sog_source_is_aligned else
                (props.splat_alignment_object or bpy.data.objects.get('SOG_PLACEMENT') or
                 bpy.data.objects.get('SPLAT_ANCHOR')))
        if splat.get('sog'):
            sog_path=os.path.join(dest,'track.sog')
            sog_summary=_verify_bundled_sog(sog_path)
            splat['sogSha256']=_sha256_file(sog_path)
            splat['sogBytes']=os.path.getsize(sog_path)
            splat['sogGaussians']=sog_summary['gaussians']
            splat['sogFormatVersion']=sog_summary['sogFormatVersion']
            splat['sourceSogName']=os.path.basename(bpy.path.abspath(props.sog_file))
        if anchor:
            C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
            matrix=C @ anchor.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world
            splat['anchorMatrixColumnMajor']=[round(float(matrix[r][c]),7) for c in range(4) for r in range(4)]
            splat['anchorObject']=anchor.name
            splat['transformMethod']='Single unbaked SOG placement matrix: browser=C * Blender placement.matrix_world, C=(x,z,-y); raw PLY remains unchanged'
            splat['objectScaleBlender']=list(round(float(x),7) for x in anchor.matrix_world.to_scale())
            splat['placementExplicit']=bool(not props.sog_source_is_aligned and (props.splat_alignment_object or bpy.data.objects.get('SOG_PLACEMENT')))
            if max(abs(a-1) for a in anchor.matrix_world.to_scale()) < .001 and not splat['placementExplicit']:
                warnings.append('SOG: identity SPLAT_ANCHOR. Applying Blender object transforms does not update the source PLY. Configure SOG_PLACEMENT before export.')
        # Original PLY deliberately remains private and outside deployed assets.
        old_splat=previous_pack.get('splat',{})
        previous_hash=old_splat.get('sogSha256')
        if old_splat.get('sog') and not previous_hash:
            old_file=os.path.normpath(os.path.join(assetroot,old_splat['sog']))
            if os.path.isfile(old_file):previous_hash=_sha256_file(old_file)
        old_anchor=old_splat.get('anchorMatrixColumnMajor') or []
        new_anchor=splat.get('anchorMatrixColumnMajor') or []
        changed_sog=bool(old_splat.get('sog') and (
            not splat.get('sog') or
            previous_hash != splat.get('sogSha256') or old_anchor != new_anchor))
        if changed_sog:
            warnings.append('SOG content/placement changed. Old browser fine alignment is not compatible; it will reset automatically for this export.')
        # A legacy browser calibration may be migrated ONLY if the last pack's
        # actual SOG bytes and placement matrix are both exactly unchanged.
        if splat.get('sog') and old_splat.get('sog') and not old_splat.get('sogSha256') and not changed_sog:
            splat['migrateLegacyCalibration']=True
        # A deliberate user reset can also invalidate previously stored browser calibration.
        old_calib_revision=previous_pack.get('splat',{}).get('calibrationRevision',0)
        if props.reset_browser_calibration:
            splat['calibrationRevision']=int(old_calib_revision or 0)+1
        elif old_calib_revision:
            splat['calibrationRevision']=old_calib_revision
        rendering={'exposure':round(float(props.render_exposure),4),
            'fogDistance':round(float(props.render_fog_distance),3)}
        if props.render_environment_atlas:
            atlas=bpy.path.abspath(props.render_environment_atlas)
            if pathlib.Path(atlas).suffix.lower() not in ('.ktx','.ktx2'):
                raise ValueError('Environment atlas must be a PlayCanvas-prefiltered .ktx/.ktx2 texture. Raw HDR images are not envAtlases.')
            target=os.path.join(dest,'lighting'+pathlib.Path(atlas).suffix.lower())
            _copy_optional(atlas,target)
            rendering['environmentAtlas']=relative+'/'+os.path.basename(target)
        pack={'version':1,'packId':versionid,'coordinateSystem' :'Y-up +Z-forward',
            'unit':'metre','sceneOrigin':'Blender world origin',
            'visualGlb':relative+'/visuals.glb' if visual_meshes else None,
            'staticCollisionGlb':relative+'/collision.glb' if staticmeshes else None,
            'dynamic':[{'id':d['id'],'asset':d['visualAsset'],'physics':d['physics']} for d in dynamics],
            'colliders':proxies,'vehicles':vehicles,'lights':lights,
            'rendering':rendering,'materialOverrides':_playcanvas_material_overrides(),
            'splat':splat,'notes':{'staticMeshPhysics':'v1.4+ uses staticCollisionGlb with Ammo. Legacy v1.3 uses track.json proxies','sogRendering':'v1.4+ displays SOG. Unbaked SOG_PLACEMENT Empty is captured in the pack; use source-aligned only for PLY with transforms baked by KIRI.'}}
        # Preserve originals and install manifests only after exports succeeded.
        # Pack ID is the commit marker: a half-finished overwrite is rejected
        # by the checker and browser rather than silently mixing old/new files.
        track['assetPackId']=versionid
        with open(os.path.join(dest,'track.json'),'w',encoding='utf8') as f:json.dump(track,f,indent=2)
        with open(os.path.join(dest,'pack.json'),'w',encoding='utf8') as f:json.dump(pack,f,indent=2)
        files=[('track.json',track)]
        # Preserve the one-time browser fine calibration unless reset was specifically requested.
        if props.reset_browser_calibration or changed_sog:
            # The browser calibration is an EXTRA transform applied above the
            # Blender anchor. Leaving an old 100x/180deg calibration here would
            # double-transform the newly authored SOG placement.
            files.append(('splat-alignment.json',{
                'position':[0,0,0],'rotationEuler':[0,0,0],'scale':1,
                'note':'Reset by LAB5 Blender export. The SOG_PLACEMENT anchor is authoritative. Previous JSON was backed up.'}))
        files.append(('asset-pack.json',pack))  # COMMIT LAST
        for name,data in files:
            target=os.path.join(assetroot,name)
            if os.path.exists(target):shutil.copy2(target,target+'.backup-'+stamp)
            staging=target+'.staging'
            with open(staging,'w',encoding='utf8') as f:json.dump(data,f,indent=2)
            os.replace(staging,target)
        return versionid,len(dynamics),warnings
    except Exception:
        shutil.rmtree(dest,ignore_errors=True)
        raise
