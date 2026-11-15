import {checkColliderProxies} from './collider-proxies.js';
import {validateAirGates} from '../vehicles/air-race.js';
/** v1.3 Blender pack: strict relative asset paths, no silent scene fallback. */
export function assetRelativePath(value){
  if(typeof value!=='string'||!value.trim()||value.startsWith('/')||value.includes('\\')||value.split('/').some(s=>!s||s==='.'||s==='..')||/^[a-z][a-z0-9+.-]*:/i.test(value)||/[?#]/.test(value))throw new Error('Unsafe asset path: '+value);
  return value;
}
export function checkRacePack(pack,track){
  if(pack?.version!==1)throw new Error('asset-pack.json must be version 1');
  if(track?.version!==1)throw new Error('track.json must be version 1');
  if(track.assetPackId && track.assetPackId!==pack.packId)throw new Error(`Incomplete Blender export: track.json belongs to ${track.assetPackId}, but asset-pack.json is ${pack.packId}. Wait for Export Asset Pack to Game to finish, then refresh.`);
  const proxyInfo=checkColliderProxies(pack.colliders||[]);
  if(!pack.staticCollisionGlb && !(pack.colliders||[]).some(c=>c.bodyType==='static'&&c.drivable))throw new Error('staticCollisionGlb missing: add an RACE_COLLISION ground mesh or a drivable STATIC proxy.');
  if(pack.staticCollisionGlb)assetRelativePath(pack.staticCollisionGlb);
  if(pack.visualGlb)assetRelativePath(pack.visualGlb);
  if(pack.splat?.sog){
    assetRelativePath(pack.splat.sog);
    const hash=pack.splat.sogSha256;
    if(hash!==undefined && !/^[0-9a-f]{64}$/i.test(hash))throw new Error('Invalid SOG SHA-256 in asset-pack.json');
    if(pack.splat.sogBytes!==undefined && (!Number.isSafeInteger(pack.splat.sogBytes)||pack.splat.sogBytes<=0))throw new Error('Invalid SOG byte size in asset-pack.json');
  }
  if(pack.vehicles!==undefined){
   if(!Array.isArray(pack.vehicles)||pack.vehicles.length>40)throw new Error('Invalid vehicle library');
   const seen=new Set();
   for(const v of pack.vehicles){
    if(!/^[a-z0-9_-]{1,64}$/.test(v.id||'')||seen.has(v.id)||['kart','hover','drone'].includes(v.id))throw new Error('Duplicate vehicle ID '+v.id);
    seen.add(v.id);
    if(!['KART','HOVER','DRONE'].includes(v.type))throw new Error('Unknown vehicle class '+v.type);
    assetRelativePath(v.bodyGlb);if(v.wheelGlb)assetRelativePath(v.wheelGlb);
   }
  }
  if(pack.lights!==undefined){
   if(!Array.isArray(pack.lights)||pack.lights.length>64)throw new Error('Invalid Blender scene lights');
   for(const l of pack.lights)if(!['directional','omni','spot'].includes(l.type)||!Array.isArray(l.position)||l.position.length!==3||!l.position.every(Number.isFinite)||!Array.isArray(l.rotation)||l.rotation.length!==4||!l.rotation.every(Number.isFinite))throw new Error('Invalid Blender light '+l.id);
  }
  if(pack.rendering!==undefined){
   const r=pack.rendering;
   if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('rendering must be an object');
   if(r.exposure!==undefined&&(!Number.isFinite(r.exposure)||r.exposure<.3||r.exposure>3))throw new Error('Invalid rendering exposure');
   if(r.fogDistance!==undefined&&(!Number.isFinite(r.fogDistance)||r.fogDistance<0||r.fogDistance>5000))throw new Error('Invalid rendering fog distance');
   if(r.environmentAtlas){assetRelativePath(r.environmentAtlas);if(!/\.ktx2?$/i.test(r.environmentAtlas))throw new Error('Environment atlas must be prefiltered KTX texture');}
  }
  validateAirGates(track.race?.airGates||[]);
  for(const item of pack.dynamic||[]){if(!item.id)throw new Error('Dynamic object ID missing');assetRelativePath(item.asset);}
  if(track.levelType!=='FREE_ROAM'){
   if(!Array.isArray(track.race?.waypoints)||track.race.waypoints.length<3)throw new Error('No racing-line waypoints');
   if(!Array.isArray(track.race?.gates)||track.race.gates.length<2)throw new Error('Missing lap checkpoints');
  }
  for(const id of ['p1','p2'])if(!Number.isFinite(track.spawns?.[id]?.x)||!Number.isFinite(track.spawns?.[id]?.z))throw new Error('Missing '+id+' spawn');
  const missing=(pack.dynamic||[]).filter(v=>!track.collision?.obstacles?.some(o=>o.id===v.id));
  if(missing.length)throw new Error('Dynamic IDs absent from track: '+missing.map(v=>v.id).join(','));
  return {hasSog:!!pack.splat?.sog,collisionSource:pack.staticCollisionGlb?'staticCollisionGlb':'staticProxy',dynamicCount:(pack.dynamic||[]).length+proxyInfo.dynamic,proxyInfo};
}
export function assetURL(base,relative){
  const root=new URL(`${base.replace(/\/?$/, '/') }assets/`,window.location.origin);
  const out=new URL(assetRelativePath(relative),root);
  if(!out.pathname.startsWith(root.pathname))throw new Error('Escaping asset directory');
  return out.href;
}
/**
 * Decompose Blender's Y-up converted, column-major affine matrix into values
 * accepted by PlayCanvas Entity. Mat4 has NO getRotation() method; its Quat
 * counterpart uses setFromMat4(rotationOnlyMatrix).
 *
 * Splitting scale from the orientation is essential: setFromMat4 on a matrix
 * with nonuniform scale yields an incorrect quaternion. Reflection is encoded
 * as a negative X scale, leaving the extracted 3x3 a proper rotation.
 */
export function matrixDecomposeColumnMajor(values){
  if(values===undefined||values===null)return null;
  if(!Array.isArray(values)||values.length!==16||!values.every(Number.isFinite))
    throw new Error('SPLAT_ANCHOR must have 16 finite column-major matrix values');
  if(Math.abs(values[3])>1e-6||Math.abs(values[7])>1e-6||Math.abs(values[11])>1e-6||Math.abs(values[15]-1)>1e-6)
    throw new Error('SPLAT_ANCHOR must be an affine transform without perspective');
  const axes=[[values[0],values[1],values[2]],[values[4],values[5],values[6]],[values[8],values[9],values[10]]];
  const scales=axes.map(axis=>Math.hypot(...axis));
  if(scales.some(n=>n<1e-6))throw new Error('Invalid SPLAT_ANCHOR zero scale');
  const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  for(const [a,b] of [[0,1],[0,2],[1,2]]){
    if(Math.abs(dot(axes[a],axes[b])/(scales[a]*scales[b]))>.002)
      throw new Error('SPLAT_ANCHOR contains shear; apply transforms in Blender');
  }
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const det=dot(cross(axes[0],axes[1]),axes[2]);
  if(Math.abs(det)<1e-8)throw new Error('SPLAT_ANCHOR matrix is singular');
  if(det<0)scales[0]=-scales[0];
  const rotationMatrix=[
    ...axes[0].map(n=>n/scales[0]),0,
    ...axes[1].map(n=>n/scales[1]),0,
    ...axes[2].map(n=>n/scales[2]),0,
    0,0,0,1
  ];
  return {matrix:values.slice(),position:values.slice(12,15),scale:scales,rotationMatrix};
}
