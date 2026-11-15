"""OPTIONAL / REVIEW REQUIRED: approximate a SplatTransform collision.glb as static
XZ grid collision boxes using Blender. Do NOT use this unreviewed on a full PLY.

1. File > Import > glTF 2.0 > track.collision.glb
2. Select ONLY the imported collision mesh objects (all desired meshes selected).
3. Run this script in Blender Scripting. It writes assets/voxel-wall-overlay.json.
4. Inspect generated boxes in overlay and only then merge with the game track.
The browser uses a 2.5D collision solver. This produces coarse wall proxies,
NOT 3D triangle-mesh/Bullet physics and NOT direct SVO runtime collision.
"""
import bpy, os, json, math, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CELL=0.4         # 40 cm grid to start; too small generates excessive colliders
FLOOR_Z=0.0      # Blender's vertical coordinate of your drivable ground
WALL_MIN_H=0.40  # above floor: conservatively classify as collision wall
RAY_TOP=25       # maximum mesh height for scanning
RAY_BOTTOM=-8
MAX_BOXES=2000
selected=[o for o in bpy.context.selected_objects if o.type=='MESH']
if not selected:raise RuntimeError('Select imported track.collision.glb mesh objects before running')
all_verts=[];all_tris=[]
for o in selected:
    o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    ob=o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=ob.to_mesh();mesh.calc_loop_triangles()
    off=len(all_verts);all_verts.extend([ob.matrix_world@v.co for v in mesh.vertices])
    all_tris.extend([tuple(off+i for i in t.vertices) for t in mesh.loop_triangles]);ob.to_mesh_clear()
if not all_tris:raise RuntimeError('GLB has no triangles')
acc=BVHTree.FromPolygons(all_verts,all_tris,all_triangles=True)
minx=min(v.x for v in all_verts);maxx=max(v.x for v in all_verts)
miny=min(v.y for v in all_verts);maxy=max(v.y for v in all_verts)
nx=math.ceil((maxx-minx)/CELL);ny=math.ceil((maxy-miny)/CELL)
if nx*ny>150000:raise RuntimeError('Voxel scanning grid too large, increase CELL')
blocked=set()
for j in range(ny):
    for i in range(nx):
        x=minx+(i+.5)*CELL;y=miny+(j+.5)*CELL
        hit,normal,face,dist=acc.ray_cast(Vector((x,y,RAY_TOP)),Vector((0,0,-1)),RAY_TOP-RAY_BOTTOM)
        if hit is not None and hit.z>FLOOR_Z+WALL_MIN_H:
            blocked.add((i,j))
# Greedily merge adjacent filled cells into rectangles. Approximation:
# elevated road ramps above WALL_MIN_H can become barriers; review output.
visited=set();boxes=[]
for j in range(ny):
    for i in range(nx):
        if (i,j) not in blocked or (i,j) in visited:continue
        width=1
        while (i+width,j) in blocked and (i+width,j) not in visited:width+=1
        depth=1
        while j+depth<ny and all((ii,j+depth) in blocked and (ii,j+depth) not in visited for ii in range(i,i+width)):depth+=1
        for jj in range(j,j+depth):
            for ii in range(i,i+width):visited.add((ii,jj))
        # Blender X/-Y -> browser X/Z. Collider is in the horizontal plane only.
        x=minx+(i+width/2)*CELL;z=-(miny+(j+depth/2)*CELL)
        boxes.append({'id':f'VOX_{len(boxes):04}','x':round(x,4),'z':round(z,4),
                      'hx':round(width*CELL/2,4),'hz':round(depth*CELL/2,4),'yaw':0,'height':1.1,'y':.55})
        if len(boxes)>MAX_BOXES:raise RuntimeError('Too many voxel boxes. Increase CELL / crop scan.')
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
output=args[args.index('--out')+1] if '--out' in args else bpy.path.abspath('//voxel-wall-overlay.json')
with open(output,'w',encoding='utf8') as f:json.dump({'version':1,'voxelSize':CELL,'needsReview':True,'walls':boxes},f,indent=2)
print('Created',len(boxes),'coarse 2.5D static collision boxes:',output)
