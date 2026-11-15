// Small, dependency-free GLB 2.0 reader for ordinary Blender-exported TRIANGLES.
// The current custom WebGL renderer supports geometry + baseColorFactor, NOT textures,
// skins, morph targets, Draco, meshopt, animation or native triangle collision.
import {identity,multiply,translation,scaling} from '../render/math.js';
const GLB_MAGIC=0x46546c67, JSON_CHUNK=0x4e4f534a,BIN_CHUNK=0x004e4942;
function assert(ok,msg){if(!ok)throw new Error('GLB: '+msg)}
function localMatrix(n){
 if(Array.isArray(n.matrix))return new Float32Array(n.matrix);
 const t=n.translation||[0,0,0],s=n.scale||[1,1,1],q=n.rotation||[0,0,0,1];
 const [x,y,z,w]=q, xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
 const r=new Float32Array([1-2*(yy+zz),2*(xy+wz),2*(xz-wy),0,
 2*(xy-wz),1-2*(xx+zz),2*(yz+wx),0,
 2*(xz+wy),2*(yz-wx),1-2*(xx+yy),0,0,0,0,1]);
 return multiply(multiply(translation(...t),r),scaling(...s));
}
function componentReader(type){
 switch(type){case 5120:return ['getInt8',1];case 5121:return ['getUint8',1];case 5122:return ['getInt16',2];case 5123:return ['getUint16',2];case 5125:return ['getUint32',4];case 5126:return ['getFloat32',4];default:throw new Error('Unsupported GLB accessor componentType '+type);}
}
export function decodeGlb(bytes){
 const ab=bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const view=new DataView(ab);
 assert(view.byteLength>=20,'file too small');assert(view.getUint32(0,true)===GLB_MAGIC,'wrong magic');
 assert(view.getUint32(4,true)===2,'GLB v2 required');assert(view.getUint32(8,true)===view.byteLength,'length mismatch');
 let pos=12,json=null,bin=null;
 while(pos+8<=ab.byteLength){
  const length=view.getUint32(pos,true),tag=view.getUint32(pos+4,true);pos+=8;
  assert(pos+length<=ab.byteLength,'chunk out of bounds');
  if(tag===JSON_CHUNK)json=JSON.parse(new TextDecoder().decode(new Uint8Array(ab,pos,length)));
  if(tag===BIN_CHUNK)bin={base:pos,length};
  pos+=length;
 }
 assert(json&&bin,'embedded JSON/BIN required');
 for(const ext of ['KHR_draco_mesh_compression','EXT_meshopt_compression'])
  assert(!json.extensionsRequired?.includes(ext),'compressed GLB not supported: '+ext);
 function accessor(index){
  const a=json.accessors?.[index];assert(a&&Number.isInteger(a.count)&&a.count>=0,'missing accessor '+index);
  assert(a.bufferView!==undefined&&!a.sparse,'sparse accessors unsupported');
  const bv=json.bufferViews?.[a.bufferView];assert(bv&&(!bv.buffer||bv.buffer===0),'non-embedded buffer');
  const [read,size]=componentReader(a.componentType),count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
  assert(count,'unsupported accessor type');
  const stride=bv.byteStride||count*size,offset=bin.base+(bv.byteOffset||0)+(a.byteOffset||0);
  assert(stride>=size*count,'bad stride');
  assert(offset+(a.count?((a.count-1)*stride+count*size):0)<=bin.base+bin.length,'accessor beyond BIN');
  const out=new Array(a.count*count);
  for(let i=0;i<a.count;i++)for(let c=0;c<count;c++){
   const off=offset+i*stride+c*size;out[i*count+c]=view[read](off,true);
  }
  if(a.normalized){
   const max=({5120:127,5121:255,5122:32767,5123:65535})[a.componentType];
   if(max)for(let i=0;i<out.length;i++)out[i]=Math.max(-1,out[i]/max);
  }
  return {out,count,size:a.count};
 }
 const models=[];
 function visit(index,parent,depth){
  assert(depth<80,'node nesting too deep');
  const node=json.nodes?.[index];assert(node,'bad node index');
  const matrix=multiply(parent,localMatrix(node));
  if(node.mesh!==undefined){
   const mesh=json.meshes?.[node.mesh];assert(mesh,'bad mesh');
   for(const primitive of mesh.primitives||[]){
    assert((primitive.mode??4)===4,'only TRIANGLES supported');
    const verts=accessor(primitive.attributes?.POSITION);assert(verts.count===3,'POSITION must be VEC3');
    const norms=primitive.attributes?.NORMAL===undefined?null:accessor(primitive.attributes.NORMAL);
    assert(!norms||norms.count===3&&norms.size===verts.size,'NORMAL invalid');
    const order=primitive.indices!==undefined?accessor(primitive.indices).out:Array.from({length:verts.size},(_,i)=>i);
    assert(order.length%3===0,'triangle index length invalid');
    assert(order.length<=3_000_000,'too many triangle indices');
    const interleaved=new Float32Array(order.length*6);
    for(let k=0;k<order.length;k+=3){
     const ids=[order[k],order[k+1],order[k+2]];
     for(const id of ids)assert(Number.isInteger(id)&&id>=0&&id<verts.size,'index out of range');
     let triNorm=[0,1,0];
     if(!norms){
      const a=ids.map(id=>verts.out.slice(id*3,id*3+3));
      const ab=a[1].map((v,i)=>v-a[0][i]),ac=a[2].map((v,i)=>v-a[0][i]);
      triNorm=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      const d=Math.hypot(...triNorm)||1;triNorm=triNorm.map(v=>v/d);
     }
     for(let n=0;n<3;n++){
      const id=ids[n],dest=(k+n)*6;
      interleaved.set(verts.out.slice(id*3,id*3+3),dest);
      interleaved.set(norms?norms.out.slice(id*3,id*3+3):triNorm,dest+3);
     }
    }
    const mat=json.materials?.[primitive.material];const rgba=mat?.pbrMetallicRoughness?.baseColorFactor||[.64,.72,.69,1];
    const colors=primitive.attributes?.COLOR_0!==undefined?accessor(primitive.attributes.COLOR_0):null;
    const first=colors?.out.slice(0,3)||[1,1,1];
    models.push({name:node.name||mesh.name||'',model:matrix,vertices:interleaved,
      color:[...rgba.slice(0,3).map((v,i)=>Math.max(0,Math.min(1,v*first[i]))),1]});
   }
  }
  for(const child of node.children||[])visit(child,matrix,depth+1);
 }
 const scene=json.scenes?.[json.scene??0];assert(scene,'GLB scene missing');
 for(const node of scene.nodes||[])visit(node,identity(),0);
 return models;
}
export async function fetchGlb(url){
 const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`GLB HTTP ${response.status}: ${url}`);
 return decodeGlb(await response.arrayBuffer());
}
export function uploadGlb(gl,models){
 return models.map(mesh=>{
  const buffer=gl.createBuffer();if(!buffer)throw new Error('GLB GPU buffer allocation failed');
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
  return {...mesh,vertices:undefined,buffer,count:mesh.vertices.length/6};
 });
}
