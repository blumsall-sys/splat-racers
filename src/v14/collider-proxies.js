/** Source of truth for JSON proxy collider validation. No SOG mesh decoding. */
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const array=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(finite);
export function checkColliderProxies(colliders=[]){
 if(!Array.isArray(colliders)||colliders.length>5000)throw new Error('Invalid collider proxy list (max 5000)');
 const ids=new Set();
 for(const c of colliders){
  if(!c||typeof c.id!=='string'||!c.id.trim()||ids.has(c.id))throw new Error('Collider missing/duplicate id: '+c?.id);
  ids.add(c.id);
  if(!['static','dynamic'].includes(c.bodyType)||!['BOX','SPHERE'].includes(c.shape))throw new Error('Invalid collider kind '+c.id);
  if(!array(c.position,3)||!array(c.rotation,4)||Math.abs(Math.hypot(...c.rotation)-1)>.03)throw new Error('Invalid collider transform '+c.id);
  if(c.shape==='BOX'&&(!array(c.halfExtents,3)||c.halfExtents.some(v=>v<=.002||v>5000)))throw new Error('Invalid box collider extents '+c.id);
  if(c.shape==='SPHERE'&&(!finite(c.radius)||c.radius<=.002||c.radius>5000))throw new Error('Invalid spherical collider radius '+c.id);
  if(c.bodyType==='dynamic'&&(!finite(c.mass)||c.mass<=0||c.mass>1e7))throw new Error('Invalid dynamic collider mass '+c.id);
  for(const key of ['friction','restitution'])if(c[key]!==undefined&&(!finite(c[key])||c[key]<0||c[key]>10))throw new Error('Invalid collider '+key+' '+c.id);
  if(c.drivable && c.bodyType!=='static')throw new Error('A drivable surface must be STATIC: '+c.id);
 }
 return {count:colliders.length,static:colliders.filter(c=>c.bodyType==='static').length,dynamic:colliders.filter(c=>c.bodyType==='dynamic').length};
}
