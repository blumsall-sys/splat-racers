/** SOG pack inspection without optional dependencies or decoding WebP images.
 * Official bundled SOG is a ZIP with root meta.json + referenced texture files.
 */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {assetRelativePath} from '../src/v14/pack-contract.js';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const SOG_FIELDS=['means','scales','quats','sh0'];

async function part(handle,position,length){const b=Buffer.alloc(length);const {bytesRead}=await handle.read(b,0,length,position);if(bytesRead!==length)throw Error('Truncated bundled SOG ZIP');return b;}
export async function inspectSogArchive(filename){
 const fh=await fs.open(filename,'r');
 try{
  const stat=await fh.stat();
  if(stat.size<50)throw Error('SOG is too small to be a valid bundled archive');
  const tailSize=Math.min(stat.size,65557), tail=await part(fh,stat.size-tailSize,tailSize);
  let eocd=-1;
  for(let p=tail.length-22;p>=0;p--){if(tail.readUInt32LE(p)===0x06054b50 && p+22+tail.readUInt16LE(p+20)<=tail.length){eocd=p;break;}}
  if(eocd<0)throw Error('SOG is not a bundled ZIP archive (missing central directory)');
  const count=tail.readUInt16LE(eocd+10),dirBytes=tail.readUInt32LE(eocd+12),dirStart=tail.readUInt32LE(eocd+16);
  if([count,dirBytes,dirStart].some(v=>v===65535||v===4294967295))throw Error('ZIP64 SOG inspection is not supported yet');
  if(dirBytes>8*1024*1024 || dirStart+dirBytes>stat.size)throw Error('Invalid SOG ZIP central directory');
  const dir=await part(fh,dirStart,dirBytes),entries=new Map();
  let pos=0;
  for(let i=0;i<count;i++){
   if(pos+46>dir.length||dir.readUInt32LE(pos)!==0x02014b50)throw Error('Corrupt SOG ZIP central directory');
   const method=dir.readUInt16LE(pos+10),size=dir.readUInt32LE(pos+20),nameLength=dir.readUInt16LE(pos+28),extraLength=dir.readUInt16LE(pos+30),commentLength=dir.readUInt16LE(pos+32),offset=dir.readUInt32LE(pos+42);
   const name=dir.subarray(pos+46,pos+46+nameLength).toString('utf8');
   entries.set(name,{method,size,offset});pos+=46+nameLength+extraLength+commentLength;
  }
  const m=entries.get('meta.json');if(!m)throw Error('SOG has no meta.json at the archive root');
  if(m.size>2*1024*1024)throw Error('SOG metadata is unexpectedly large');
  const local=await part(fh,m.offset,30);
  if(local.readUInt32LE(0)!==0x04034b50)throw Error('Bad SOG meta.json ZIP local header');
  const start=m.offset+30+local.readUInt16LE(26)+local.readUInt16LE(28);
  const compressed=await part(fh,start,m.size);
  const raw=m.method===8?inflateRawSync(compressed):m.method===0?compressed:null;
  if(!raw)throw Error('Unsupported SOG metadata compression method '+m.method);
  let meta;try{meta=JSON.parse(raw.toString('utf8'));}catch{throw Error('SOG meta.json is invalid JSON');}
  if(meta.version!==2||!Number.isSafeInteger(meta.count)||meta.count<1)throw Error('SOG meta.json needs version 2 and positive Gaussian count');
  const refs=[];
  for(const field of SOG_FIELDS){const files=meta[field]?.files;if(!Array.isArray(files)||!files.length)throw Error(`SOG metadata missing ${field}.files`);refs.push(...files);}
  if(meta.shN?.files)refs.push(...meta.shN.files);
  const missing=refs.filter(name=>typeof name!=='string'||!entries.has(name));
  if(missing.length)throw Error('SOG ZIP missing texture(s): '+missing.join(', '));
  return {bytes:stat.size,gaussians:meta.count,formatVersion:meta.version,textures:refs.length,entries:entries.size};
 } finally {await fh.close();}
}
export async function fileSha256(filename){return await new Promise((resolve,reject)=>{
 const hash=createHash('sha256'),stream=createReadStream(filename);
 stream.on('data',data=>hash.update(data));stream.on('error',reject);
 stream.on('end',()=>resolve(hash.digest('hex')));
});}
export async function verifyActiveSog(projectRoot,pack){
 if(!pack.splat?.sog){console.warn('SOG NOT CONFIGURED: the active asset-pack.json does not reference a Gaussian SOG. Re-link SOG file in Blender before exporting.');return {configured:false};}
 const rel=assetRelativePath(pack.splat.sog),full=path.resolve(projectRoot,'assets',rel),assets=path.resolve(projectRoot,'assets')+path.sep;
 if(!full.startsWith(assets))throw Error('SOG path escapes assets directory');
 const summary=await inspectSogArchive(full);
 if(pack.splat.sogBytes && pack.splat.sogBytes!==summary.bytes)throw Error(`SOG SIZE MISMATCH: asset-pack.json says ${pack.splat.sogBytes}, file has ${summary.bytes}`);
 const digest=await fileSha256(full);
 if(pack.splat.sogSha256 && pack.splat.sogSha256!==digest)throw Error(`SOG SHA256 MISMATCH: expected ${pack.splat.sogSha256}, got ${digest}. Re-export the Blender asset pack.`);
 if(!pack.splat.sogSha256)console.warn('LEGACY SOG MANIFEST: no SHA256 identity; re-export with Blender add-on v1.2.4 to enable version validation.');
 if(pack.splat.anchorMatrixColumnMajor!==undefined){const m=pack.splat.anchorMatrixColumnMajor;if(!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite))throw Error('SOG anchorMatrixColumnMajor is invalid');}
 console.log(`PASS SOG VERIFY ${rel} · ${summary.gaussians} Gaussians · ${summary.textures} textures · ${Math.round(summary.bytes/1024)} KiB · SHA256 ${digest.slice(0,16)}... · placement ${pack.splat.anchorObject||'identity'}`);
 return {configured:true,summary,sha256:digest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const pack=JSON.parse(await fs.readFile(path.join(root,'assets/asset-pack.json'),'utf8'));
  const track=JSON.parse(await fs.readFile(path.join(root,'assets/track.json'),'utf8'));
  if(track.assetPackId&&track.assetPackId!==pack.packId)throw Error('TRACK / PACK VERSION MISMATCH. Re-export or refresh after Blender finishes.');
  const checked=await verifyActiveSog(root,pack);
  if(process.argv.includes('--require')&&!checked.configured)throw Error('SOG REQUIRED: the active manifest has no splat.sog. Export bundled SOG from Blender to this exact Game root.');
 }catch(e){console.error('SOG VALIDATION FAILED:',e.message);process.exitCode=1;}
}
