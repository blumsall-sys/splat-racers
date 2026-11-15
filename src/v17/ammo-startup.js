/**
 * PlayCanvas WasmModule.getInstance invokes its callback with exactly one
 * argument: moduleInstance. It is NOT Node-style (error, instance).
 * Source: PlayCanvas engine v2.23.1 core/wasm-module.js.
 */
export function formatRuntimeError(err){
 if(err instanceof Error)return `${err.name}: ${err.message}`;
 if(typeof err==='string')return err;
 if(err===null||err===undefined)return String(err);
 if(typeof err==='object'){
  if(typeof err.message==='string')return err.message;
  if(typeof err.reason==='string')return err.reason;
  try{return JSON.stringify(err,(_key,value)=>typeof value==='bigint'?String(value):value) || String(err);}
  catch{return String(err);}
 }
 return String(err);
}

/** The one documented Ammo loader. Never infer two callback parameters. */
export function loadAmmoModule(WasmModule,config,{timeoutMs=20000}={}){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const timer=setTimeout(()=>fail(new Error('Ammo initialization timed out. Run npm.cmd run setup:ammo and reload.')),timeoutMs);
  function finish(module){
   if(settled)return;
   if(!module || typeof module.btVector3!=='function'){
    fail(new Error('PlayCanvas returned an invalid Ammo module (btVector3 missing).'));
    return;
   }
   if(typeof module.btRaycastVehicle!=='function'||typeof module.btDefaultVehicleRaycaster!=='function'||typeof module.btVehicleTuning!=='function'){
    fail(new Error('The installed Ammo build does not include btRaycastVehicle / raycaster / tuning. Use an Ammo build with Bullet vehicle bindings.'));
    return;
   }
   settled=true;clearTimeout(timer);resolve(module);
  }
  function fail(reason){
   if(settled)return;
   settled=true;clearTimeout(timer);
   reject(reason instanceof Error?reason:new Error(`Ammo initialization failed: ${formatRuntimeError(reason)}`));
  }
  try{
   WasmModule.setConfig('Ammo',{...config,errorHandler:fail});
   WasmModule.getInstance('Ammo',instance=>finish(instance));
  }catch(err){fail(err);}
 });
}
