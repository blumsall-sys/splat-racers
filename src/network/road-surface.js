/**
 * Network-only road height probing against the SAME Blender collision GLB
 * used by local Ammo. This is a vertical triangle/ground raycaster, not a
 * replacement for the full native raycast vehicle or obstacle simulation.
 *
 * Online host: fetch collision.glb once; build a 2D triangle index.
 * Legacy LAN/headless: use the exported 3D navigation centerline elevation.
 * No modifications to local physics, Blender exports or their assets.
 */
import {isRoadMeshName,isWallMeshName} from '../v14/collision-policy.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>Number.isFinite(v);
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){
 const m=Array(16).fill(0);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++)
  for(let k=0;k<4;k++)m[4*c+r]+=a[4*k+r]*b[4*c+k];
 return m;
}
function localMatrix(node){
 if(node.matrix){if(node.matrix.length!==16)throw Error('Invalid road GLB matrix');return node.matrix;}
 const [x,y,z,w]=node.rotation||[0,0,0,1],[sx,sy,sz]=node.scale||[1,1,1];
 const [tx,ty,tz]=node.translation||[0,0,0];
 return [
 (1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,
 2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,
 2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,
 tx,ty,tz,1
 ];
}
function transform(p,m){
 const [x,y,z]=p;
 return [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
}
function glbReader(binary){
 const bytes=binary instanceof Uint8Array?binary:new Uint8Array(binary);
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.byteLength<20||dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2||dv.getUint32(8,true)>bytes.byteLength)throw Error('Invalid collision GLB');
 const jsonLen=dv.getUint32(12,true);
 if(dv.getUint32(16,true)!==0x4e4f534a||jsonLen>bytes.byteLength-20)throw Error('Collision GLB has no JSON chunk');
 const doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLen)));
 const offset=20+jsonLen;
 if(offset+8>bytes.byteLength||dv.getUint32(offset+4,true)!==0x004e4942)throw Error('Collision GLB has no binary chunk');
 const binStart=offset+8,binSize=dv.getUint32(offset,true);
 if(binStart+binSize>bytes.byteLength)throw Error('Truncated collision GLB');
 function accessor(i){
  const a=doc.accessors?.[i],v=doc.bufferViews?.[a?.bufferView];
  if(!a||!v||v.buffer!==0||a.sparse)throw Error('Unsupported collision GLB accessor');
  const compBytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
  const n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
  if(!compBytes||!n)throw Error('Invalid collision GLB component layout');
  const stride=v.byteStride||compBytes*n;
  const start=binStart+(v.byteOffset||0)+(a.byteOffset||0);
  if(start<binStart||start+(a.count-1)*stride+compBytes*n>binStart+binSize)throw Error('Collision accessor out of bounds');
  const read=(idx,c=0)=>{
   const at=start+idx*stride+c*compBytes;
   switch(a.componentType){
    case 5126:return dv.getFloat32(at,true);
    case 5125:return dv.getUint32(at,true);
    case 5123:return dv.getUint16(at,true);
    case 5122:return dv.getInt16(at,true);
    case 5121:return dv.getUint8(at);
    case 5120:return dv.getInt8(at);
   }
  };
  return {length:a.count,read};
 }
 return {doc,accessor};
}
function trianglesFromGlb(binary){
 const {doc,accessor}=glbReader(binary);
 const tris=[],nodes=doc.nodes||[];
 const seen=new Set(),children=new Set(nodes.flatMap(n=>n.children||[]));
 const roots=(doc.scenes?.[doc.scene||0]?.nodes)||nodes.map((_,i)=>i).filter(i=>!children.has(i));
 function walk(index,parent){
  if(seen.has(index))return;
  seen.add(index);
  const node=nodes[index];if(!node)return;
  const world=multiply(parent,localMatrix(node));
  if(Number.isInteger(node.mesh)){
   const mesh=doc.meshes?.[node.mesh];
   const name=node.name||mesh?.name||'';
   if(isRoadMeshName(name)&&!isWallMeshName(name))for(const primitive of mesh?.primitives||[]){
    if(primitive.mode!==undefined&&primitive.mode!==4)continue;
    const pos=accessor(primitive.attributes?.POSITION);
    if(!pos||pos.length<3)continue;
    const indices=primitive.indices===undefined?null:accessor(primitive.indices);
    const count=indices?.length??pos.length;
    const vertex=i=>{const j=indices?indices.read(i):i;return transform([pos.read(j,0),pos.read(j,1),pos.read(j,2)],world);};
    for(let k=0;k+2<count;k+=3){
     const [a,b,c]=[vertex(k),vertex(k+1),vertex(k+2)];
     const denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
     const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
     const normal=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
     if(Math.abs(denominator)<1e-8||Math.abs(normal[1])/Math.max(.001,Math.hypot(...normal))<.38)continue;
     tris.push({a,b,c,denominator,minX:Math.min(a[0],b[0],c[0]),maxX:Math.max(a[0],b[0],c[0]),minZ:Math.min(a[2],b[2],c[2]),maxZ:Math.max(a[2],b[2],c[2])});
    }
   }
  }
  for(const child of node.children||[])walk(child,world);
 }
 for(const root of roots)walk(root,identity());
 return tris;
}
/** All points/height values are in Blender's Y-up game coordinates. */
export function navigationSurface(track){
 const authored=track?.race?.navigation?.points;
 const points=Array.isArray(authored)&&authored.length>=2?authored:track?.race?.waypoints||[];
 if(points.length<2)throw Error('Network race requires a usable course navigation path');
 const width=Math.max(2,(track.race.roadWidth||5)*.5);
 return (x,z)=>{
  let best=Infinity,height=0,distance=Infinity;
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dz=b.z-a.z;
   const l2=dx*dx+dz*dz;if(l2<1e-10)continue;
   const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/l2,0,1),px=a.x+t*dx,pz=a.z+t*dz;
   const d2=(x-px)**2+(z-pz)**2;
   if(d2<best){best=d2;height=(a.y||0)+((b.y||0)-(a.y||0))*t;distance=Math.sqrt(d2);}
  }
  return {height,distance,onRoad:distance<=width+1,source:'navigation'};
 };
}
export function createNetworkRoadSurface(track,binary=null,{cellSize=3}={}){
 const fallback=navigationSurface(track);
 if(!binary)return {source:'navigation',triangles:0,sample:(x,z)=>fallback(x,z)};
 const triangles=trianglesFromGlb(binary);
 if(!triangles.length)throw Error('Collision GLB contains no usable drivable road triangles');
 const grid=new Map();
 const key=(x,z)=>x+':'+z;
 for(let i=0;i<triangles.length;i++){
  const t=triangles[i];
  const minX=Math.floor(t.minX/cellSize),maxX=Math.floor(t.maxX/cellSize),minZ=Math.floor(t.minZ/cellSize),maxZ=Math.floor(t.maxZ/cellSize);
  for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
   const k=key(gx,gz);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);
  }
 }
 function sample(x,z,hintY){
  if(!finite(x)||!finite(z))throw Error('Invalid network road probe');
  let best=null,bestDelta=Infinity;
  for(const i of grid.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize)))||[]){
   const t=triangles[i];
   if(x<t.minX-1e-5||x>t.maxX+1e-5||z<t.minZ-1e-5||z>t.maxZ+1e-5)continue;
   const u=((t.b[2]-t.c[2])*(x-t.c[0])+(t.c[0]-t.b[0])*(z-t.c[2]))/t.denominator;
   const v=((t.c[2]-t.a[2])*(x-t.c[0])+(t.a[0]-t.c[0])*(z-t.c[2]))/t.denominator;
   if(u<-.00001||v<-.00001||u+v>1.00001)continue;
   const height=u*t.a[1]+v*t.b[1]+(1-u-v)*t.c[1];
   const delta=finite(hintY)?Math.abs(height-hintY): -height;
   if(delta<bestDelta){bestDelta=delta;best={height,distance:0,onRoad:true,source:'collision-glb'};}
  }
  return best||{...fallback(x,z),source:'navigation-fallback',onRoad:false};
 }
 return {source:'collision-glb',triangles:triangles.length,sample};
}
