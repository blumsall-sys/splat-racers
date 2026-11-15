/** Optional PlayCanvas-only material refinement after Blender GLB import.
 * By default GLB PBR textures, UVs, material slots and normal maps survive unchanged.
 * Only explicit Blender custom-property overrides or an explicitly tagged
 * material name receive a non-destructive cloned material adjustment.
 */
export function overrideSpec(name,overrides={}){
 if(typeof name!=='string')return null;
 const custom=overrides[name]||overrides[name.toLowerCase()];
 if(custom&&custom.kind==='glass')return custom;
 if(/^LAB5_GLASS(?:_|$)/i.test(name))return {kind:'glass',opacity:.26,roughness:.10};
 return null;
}
export function refineImportedMaterials(root,overrides={},pc){
 if(!root?.findComponents||!pc)return 0;
 let changed=0;
 for(const render of root.findComponents('render'))for(const instance of render.meshInstances||[]){
  const old=instance.material,spec=overrideSpec(old?.name,overrides);
  if(!spec||typeof old?.clone!=='function')continue;
  const mat=old.clone();mat.name=old.name;mat.blendType=pc.BLEND_NORMAL;
  mat.opacity=Math.max(.05,Math.min(.95,Number(spec.opacity??.26)));
  mat.depthWrite=false;mat.opacityFadesSpecular=false;
  if(Number.isFinite(spec.roughness))mat.gloss=Math.max(0,Math.min(1,1-spec.roughness));
  if(Number.isFinite(spec.refractionIndex))mat.refractionIndex=Math.max(1,Math.min(2,Number(spec.refractionIndex)));
  mat.update();instance.material=mat;changed++;
 }
 return changed;
}
