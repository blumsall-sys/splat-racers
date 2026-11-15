// Download the three official PlayCanvas Ammo runtime files. No Blender/npm global setup.
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const output=path.join(root,'public','ammo');
const sources=['https://developer.playcanvas.com/assets/modules/ammo/','https://raw.githubusercontent.com/playcanvas/engine/main/examples/assets/wasm/ammo/'];
async function download(url,redirects=0){
 if(redirects>5)throw new Error('Too many redirects');
 return new Promise((resolve,reject)=>{https.get(url,{headers:{'User-Agent':'SplatRacers/1.4'},timeout:20000},res=>{
  if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return resolve(download(new URL(res.headers.location,url).href,redirects+1));}
  if(res.statusCode!==200){res.resume();return reject(new Error('HTTP '+res.statusCode+' for '+url));}
  const chunks=[];let n=0;
  res.on('data',chunk=>{n+=chunk.length;if(n>6_000_000){res.destroy(new Error('Ammo file unexpectedly large'));return;}chunks.push(chunk);});
  res.on('end',()=>resolve(Buffer.concat(chunks)));
  res.on('error',reject);
 }).on('error',reject);});
}
await fs.mkdir(output,{recursive:true});
for(const filename of ['ammo.wasm.js','ammo.wasm.wasm','ammo.js']){
 const dest=path.join(output,filename);
 try{const old=await fs.stat(dest);if(old.size>10_000){console.log('Existing',filename,old.size,'bytes');continue;}}catch{}
 let bytes=null,lastError=null;
 for(const source of sources){try{const candidate=await download(source+filename);if(candidate.length<10_000||candidate.subarray(0,10).toString().startsWith('<!DOCTYPE'))throw new Error('Invalid response');bytes=candidate;break;}catch(e){lastError=e;console.warn('Ammo source failed:',source,e.message);}}
 if(!bytes)throw new Error('Failed to obtain '+filename+' from either official source: '+lastError?.message);
 await fs.writeFile(dest+'.tmp',bytes);await fs.rename(dest+'.tmp',dest);console.log('Saved',filename,bytes.length,'bytes');
}
console.log('Ammo is ready in public/ammo/');
