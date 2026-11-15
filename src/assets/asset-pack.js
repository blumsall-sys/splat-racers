import {fetchGlb,uploadGlb} from './glb-loader.js';
function resolveAsset(path){
 if(!path||typeof path!=='string'||path.startsWith('/')||path.includes('..')||/^[a-z]+:/i.test(path))throw new Error('Unsafe asset-pack path: '+path);
 return new URL('../../assets/'+path,import.meta.url).href;
}
export function validatePack(pack){
 if(pack?.version!==1)throw new Error('Asset pack requires version 1');
 if(pack.visualGlb!==null&&pack.visualGlb!==undefined)resolveAsset(pack.visualGlb);
 for(const item of pack.dynamic||[]){if(!item.id)throw new Error('Dynamic item missing id');resolveAsset(item.asset)}
 return pack;
}
export async function loadPack(renderer){
 const configUrl=new URL('../../assets/asset-pack.json',import.meta.url);
 let response;
 try{response=await fetch(configUrl,{cache:'no-store'});}catch(e){throw new Error('Could not load asset-pack.json: '+e.message)}
 if(!response.ok)throw new Error('Missing asset-pack.json ('+response.status+')');
 const pack=validatePack(await response.json());
 if(!renderer.gl)return {pack,rendered:false,reason:'Software renderer displays primitive proxies'};
 const models={static:[],dynamic:new Map()};
 if(pack.visualGlb)models.static=uploadGlb(renderer.gl,await fetchGlb(resolveAsset(pack.visualGlb)));
 for(const d of pack.dynamic||[]){models.dynamic.set(d.id,uploadGlb(renderer.gl,await fetchGlb(resolveAsset(d.asset))))}
 renderer.modelAssets=models;
 return {pack,rendered:true,staticMeshes:models.static.length,dynamicMeshes:models.dynamic.size};
}
