import {assetRelativePath} from '../v14/pack-contract.js';

export const DEFAULT_VEHICLES=Object.freeze([
 Object.freeze({id:'kart',label:'Classic Kart',type:'KART',mass:170,jumpSpeed:5.5,maxSpeed:12.5,hoverHeight:2.45}),
 Object.freeze({id:'hover',label:'Hovercraft',type:'HOVER',mass:140,jumpSpeed:5.5,maxSpeed:12.5,hoverHeight:2.45}),
 Object.freeze({id:'drone',label:'Flight Drone',type:'DRONE',mass:70,jumpSpeed:5.5,maxSpeed:12.5,hoverHeight:2.45})
]);
const finiteRange=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
export function vehicleCatalog(pack={}){
 const result=DEFAULT_VEHICLES.map(v=>({...v}));
 const ids=new Set(result.map(v=>v.id));
 if(!Array.isArray(pack.vehicles||[]))throw new Error('Vehicle library must be an array');
 if((pack.vehicles||[]).length>40)throw new Error('Max 40 custom vehicles');
 for(const v of pack.vehicles||[]){
  if(!/^[a-z0-9_-]{1,64}$/.test(v?.id||'')||ids.has(v.id))throw new Error('Invalid or duplicate vehicle id: '+v?.id);
  if(!['KART','HOVER','DRONE'].includes(v.type))throw new Error('Unknown vehicle type: '+v?.type);
  if(typeof v.label!=='string'||!v.label.trim()||v.label.length>75)throw new Error('Vehicle label missing or too long');
  if(!finiteRange(v.mass,15,2000)||!finiteRange(v.jumpSpeed,1,14)||!finiteRange(v.hoverHeight,.6,12)||!finiteRange(v.maxSpeed,3,55))throw new Error('Invalid physics tuning for '+v.id);
  assetRelativePath(v.bodyGlb);
  if(v.chassisHalfExtents && (!Array.isArray(v.chassisHalfExtents)||v.chassisHalfExtents.length!==3||!v.chassisHalfExtents.every(n=>finiteRange(n,.1,5))))throw new Error('Invalid physics proxy for '+v.id);
  if(v.hoverHopInterval!==undefined&&!finiteRange(v.hoverHopInterval,.35,2))throw new Error('Invalid hover pulse interval for '+v.id);
  if(v.hoverHopStep!==undefined&&!finiteRange(v.hoverHopStep,1,8))throw new Error('Invalid hover pulse step for '+v.id);
  if(v.acceleration!==undefined&&!finiteRange(v.acceleration,1,10))throw new Error('Invalid flight acceleration for '+v.id);
  if(v.stabilityAssist!==undefined&&!finiteRange(v.stabilityAssist,.5,2))throw new Error('Invalid stabilizer multiplier for '+v.id);
  if(v.autoRightSeconds!==undefined&&!finiteRange(v.autoRightSeconds,1.2,6))throw new Error('Invalid auto-right delay for '+v.id);
  if(v.wheelTrack!==undefined&&!finiteRange(v.wheelTrack,.3,3))throw new Error('Invalid wheel track for '+v.id);
  if(v.wheelAxle!==undefined&&!finiteRange(v.wheelAxle,.3,3))throw new Error('Invalid axle for '+v.id);
  if(v.wheelGlb){if(v.type!=='KART')throw new Error('Only KARTs have physical tire visuals');assetRelativePath(v.wheelGlb);}
  ids.add(v.id);result.push({...v});
 }
 return result;
}

export async function loadVehicleAssets(app,vehicles,base,loader){
 const cache=new Map();
 for(const spec of vehicles){
  const assets={};
  for(const [key,path] of [['body',spec.bodyGlb],['wheel',spec.wheelGlb]]){
   if(!path)continue;
   const url=new URL('assets/'+assetRelativePath(path),new URL(base,location.origin)).href;
   assets[key]=await loader(app,url);
  }
  cache.set(spec.id,assets);
 }
 return cache;
}
