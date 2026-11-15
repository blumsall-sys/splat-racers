/** Local persistence for one-time SOG fine alignment, separate from Blender anchor. */
/** v2 uses immutable SOG bytes + Blender placement, not a reused filename.
 * Legacy manifests without a digest retain their legacy key until re-export. */
export function calibrationKey(pack){
 const splat=pack?.splat||{};
 if(!splat.sogSha256){
  const name=splat.sourceSogName || String(pack?.packId||'default').replace(/-\d{8}-\d{6}-\d{6}$/,'');
  return 'LAB5:SOG_ALIGNMENT:v1:'+name;
 }
 const matrix=Array.isArray(splat.anchorMatrixColumnMajor)?splat.anchorMatrixColumnMajor:[];
 const signature=JSON.stringify([matrix,splat.calibrationRevision||0]);
 let hash=2166136261;
 for(let i=0;i<signature.length;i++){hash^=signature.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return 'LAB5:SOG_ALIGNMENT:v2:'+splat.sogSha256+':'+(hash>>>0).toString(16);
}
const valid=x=>x&&Array.isArray(x.position)&&x.position.length===3&&x.position.every(Number.isFinite)&&Array.isArray(x.rotationEuler)&&x.rotationEuler.length===3&&x.rotationEuler.every(Number.isFinite)&&Number.isFinite(x.scale)&&x.scale>0;
export function readStoredCalibration(pack,fallback,storage=typeof localStorage==='undefined'?null:localStorage){
 try{
  const saved=storage?.getItem(calibrationKey(pack));
  if(saved){const value=JSON.parse(saved);if(valid(value))return value;}
  if(pack?.splat?.sogSha256 && pack.splat.migrateLegacyCalibration){
   // Blender proved the previous SOG bytes and anchor were identical.
   const name=pack.splat.sourceSogName;
   const old=storage?.getItem('LAB5:SOG_ALIGNMENT:v1:'+name);
   if(old){const value=JSON.parse(old);if(valid(value)){saveStoredCalibration(pack,value,storage);return value;}}
  }
 }catch(_err){}return fallback;
}
export function saveStoredCalibration(pack,data,storage=typeof localStorage==='undefined'?null:localStorage){
 if(!valid(data))return false;
 try{storage?.setItem(calibrationKey(pack),JSON.stringify({position:data.position,rotationEuler:data.rotationEuler,scale:data.scale}));return !!storage;}catch(_err){return false;}
}

export function clearStoredCalibration(pack,storage=typeof localStorage==='undefined'?null:localStorage){
 try{storage?.removeItem(calibrationKey(pack));return !!storage;}catch(_err){return false;}
}
