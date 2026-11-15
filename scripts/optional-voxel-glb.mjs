/**
 * Low-memory metadata check for OPTIONAL splat-transform voxel collision GLBs.
 * The active Ammo driving road is pack.staticCollisionGlb, checked separately
 * with decodeGlb() and ray coverage. A Gaussian-derived mesh can easily have
 * millions of triangle indices and MUST NOT be expanded into an interleaved
 * JavaScript vertex array merely to check that the file was exported.
 */
import fs from 'node:fs';

const MAGIC=0x46546c67, JSON_CHUNK=0x4e4f534a, BIN=0x004e4942;
const MAX_JSON_BYTES=16*1024*1024;
function check(condition,message){if(!condition)throw new Error('Optional voxel GLB: '+message)}

export function inspectOptionalVoxelGlb(file){
 const fd=fs.openSync(file,'r');
 try{
  const size=fs.fstatSync(fd).size;
  check(size>=20,'file too small');
  const readAt=(offset,length)=>{
   const out=Buffer.alloc(length);
   let done=0;
   while(done<length){const n=fs.readSync(fd,out,done,length-done,offset+done);check(n>0,'unexpected end of file');done+=n;}
   return out;
  };
  const header=readAt(0,12);
  check(header.readUInt32LE(0)===MAGIC,'bad magic');
  check(header.readUInt32LE(4)===2,'GLB version must be 2');
  check(header.readUInt32LE(8)===size,'file size does not match GLB header');
  let offset=12,json=null,binLength=0;
  while(offset<size){
   check(size-offset>=8,'incomplete chunk header');
   const h=readAt(offset,8);const length=h.readUInt32LE(0),type=h.readUInt32LE(4);
   offset+=8;
   check(length<=size-offset,'chunk exceeds file length');
   if(type===JSON_CHUNK){
    check(json===null,'duplicate JSON chunk');
    check(length>0&&length<=MAX_JSON_BYTES,'JSON chunk too large or empty');
    json=JSON.parse(readAt(offset,length).toString('utf8'));
   }else if(type===BIN){
    check(binLength===0,'duplicate BIN chunk');
    binLength=length;
   }
   offset+=length;
  }
  check(json&&binLength>0,'JSON and binary chunks required');
  check(json.asset?.version==='2.0','invalid glTF asset version');
  check(Array.isArray(json.meshes)&&json.meshes.length>0,'no meshes');
  if(Array.isArray(json.buffers)&&json.buffers.length){
   check(json.buffers.length===1&&!json.buffers[0].uri,'external buffers unsupported');
   check(json.buffers[0].byteLength<=binLength,'declared buffer exceeds BIN chunk');
  }
  for(const bv of json.bufferViews||[]){
   check((bv.buffer??0)===0,'external bufferView');
   check(Number.isSafeInteger(bv.byteLength)&&bv.byteLength>=0,'invalid bufferView size');
   check(Number.isSafeInteger(bv.byteOffset??0)&&(bv.byteOffset??0)>=0,'invalid bufferView offset');
   check((bv.byteOffset??0)+bv.byteLength<=binLength,'bufferView beyond BIN chunk');
  }
  let primitives=0,triangles=0;
  for(const mesh of json.meshes){
   for(const prim of mesh.primitives||[]){
    if((prim.mode??4)!==4)continue;
    let indexCount;
    if(prim.indices!==undefined){
     const a=json.accessors?.[prim.indices];
     check(a&&a.type==='SCALAR'&&[5121,5123,5125].includes(a.componentType),'invalid index accessor');
     indexCount=a.count;
    }else{
     const a=json.accessors?.[prim.attributes?.POSITION];
     check(a&&a.type==='VEC3','missing POSITION accessor');
     indexCount=a.count;
    }
    check(Number.isSafeInteger(indexCount)&&indexCount>=0&&indexCount%3===0,'invalid triangle index count');
    triangles+=indexCount/3;primitives++;
   }
  }
  check(primitives>0,'no TRIANGLES primitives');
  return {bytes:size,meshCount:json.meshes.length,primitives,triangles,metadataOnly:true};
 }finally{fs.closeSync(fd);}
}
