/** PlayCanvas official-example pattern: register an explicit gsplat Asset, load it,
 * and wait for the asset's load/error event before creating a GSplat component.
 * The immutable content digest keys browser/CDN caches after a new Blender export.
 */
export function splatVersionToken(pack){
 const digest=pack?.splat?.sogSha256;
 return typeof digest==='string'&&/^[a-f0-9]{64}$/i.test(digest)?digest.slice(0,24):String(pack?.packId||'unversioned');
}
export function versionedSogUrl(url,pack){
 const u=new URL(url);u.searchParams.set('sogrev',splatVersionToken(pack));return u.href;
}
export function describeSogError(err,url){
 const text=typeof err==='string'?err:err instanceof Error?err.message:JSON.stringify(err);
 return `Gaussian SOG load failed (${url}): ${text || 'unknown error'}. Check Network tab, CHECK_SOG_WINDOWS.bat and Blender SOG placement.`;
}
export function loadSogAsset(app,pc,url,{onStatus=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const asset=new pc.Asset('LAB5 Gaussian SOG','gsplat',{url});
  function cleanup(){asset.off('load',loaded);asset.off('error',failed);}
  function done(ok,result){if(settled)return;settled=true;cleanup();ok?resolve(result):reject(result);}
  function loaded(){
   if(!asset.resource){done(false,new Error('SOG load event fired without a gsplat resource: '+url));return;}
   onStatus('Loaded');done(true,asset);
  }
  function failed(err){onStatus('Failed');done(false,new Error(describeSogError(err,url)));}
  asset.on('load',loaded);asset.on('error',failed);
  app.assets.add(asset);
  onStatus('Loading');
  try{app.assets.load(asset);}catch(err){failed(err);}
 });
}
export function splatReadiness(pack,asset){
 if(!pack?.splat?.sog)return {state:'missing',text:'SOG: no Gaussian splat linked in active asset-pack.json — set Blender SOG file, export to this Game root, then refresh'};
 if(!asset?.resource)return {state:'failed',text:'SOG: asset requested but not decoded'};
 return {state:'loaded',text:`SOG: loaded · ${asset.name||'Gaussian asset'} · ${pack.splat.sog.split('/').at(-1)}`};
}
