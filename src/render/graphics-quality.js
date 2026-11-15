/** Runtime graphics controls that never alter collision, SOG transforms, or GLB UVs. */
import {assetRelativePath} from '../v14/pack-contract.js';
export const GRAPHICS_PRESETS=Object.freeze({
 performance:Object.freeze({pixelRatio:1,shadowResolution:768,exposure:.96,maxSplats:1800000}),
 balanced:Object.freeze({pixelRatio:1.35,shadowResolution:1536,exposure:1,maxSplats:3500000}),
 quality:Object.freeze({pixelRatio:1.65,shadowResolution:3072,exposure:1.07,maxSplats:5500000})
});
export function graphicsConfiguration(key='balanced',pack={}){
 const preset=GRAPHICS_PRESETS[key]||GRAPHICS_PRESETS.balanced;
 const authored=pack.rendering||{};
 return {...preset,exposure:Number.isFinite(authored.exposure)?Math.max(.3,Math.min(3,authored.exposure))*preset.exposure:preset.exposure,
  fogDistance:Number.isFinite(authored.fogDistance)?Math.max(0,authored.fogDistance):0,
  environmentAtlas:authored.environmentAtlas?assetRelativePath(authored.environmentAtlas):null};
}
export function applyGraphicsConfiguration(app,pc,choice='balanced',pack={}){
 const conf=graphicsConfiguration(choice,pack);
 app.graphicsDevice.maxPixelRatio=Math.min(conf.pixelRatio,window.devicePixelRatio||1);
 app.scene.exposure=conf.exposure;
 if(app.scene.gsplat)app.scene.gsplat.splatBudget=conf.maxSplats;
 for(const light of app.root.findComponents('light')){
  if(light.castShadows)light.shadowResolution=conf.shadowResolution;
 }
 // Fog is an opt-in authoring property: captured SOG and GLB road materials
 // do not necessarily react to fog in the same way.
 if(conf.fogDistance>0){app.scene.fog.type='linear';app.scene.fog.start=conf.fogDistance*.5;app.scene.fog.end=conf.fogDistance;}
 else app.scene.fog.type='none';
 return conf;
}
export async function loadPrefilteredAtlas(app,base,pack){
 const file=pack.rendering?.environmentAtlas;if(!file)return null;
 assetRelativePath(file);
 const url=new URL(base+'assets/'+file,location.origin).href;
 return new Promise((resolve,reject)=>app.assets.loadFromUrl(url,'texture',(error,asset)=>{
  if(error)return reject(new Error('Environment atlas load failed: '+error));
  if(!asset?.resource)return reject(new Error('Environment atlas has no texture'));
  app.scene.envAtlas=asset.resource;resolve(asset);
 }));
}
