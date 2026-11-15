import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadAmmoModule,formatRuntimeError} from '../src/v17/ammo-startup.js';

const goodAmmo=()=>({btVector3(){},btRaycastVehicle(){},btDefaultVehicleRaycaster(){},btVehicleTuning(){}});
test('PlayCanvas getInstance single-argument callback returns Ammo rather than an error',async()=>{
 const module=goodAmmo();let seenConfig;
 const result=await loadAmmoModule({setConfig(name,config){assert.equal(name,'Ammo');seenConfig=config;},getInstance(name,callback){assert.equal(name,'Ammo');callback(module);}}, {glueUrl:'/ammo/ammo.wasm.js'});
 assert.equal(result,module);assert.equal(seenConfig.glueUrl,'/ammo/ammo.wasm.js');
});
test('Ammo loader rejects missing native vehicle bindings with actionable error',async()=>{
 await assert.rejects(()=>loadAmmoModule({setConfig(){},getInstance(_name,cb){cb({btVector3(){}});}},{}),/does not include btRaycastVehicle/);
});
test('Ammo loader formats initialization failures and malformed thrown objects',async()=>{
 const loader={setConfig(_name,config){this.config=config;},getInstance(){this.config.errorHandler({reason:'wasm file unreadable',code:'BAD_WASM'});}};
 await assert.rejects(()=>loadAmmoModule(loader,{}),/wasm file unreadable/);
 assert.match(formatRuntimeError({code:'BAD',detail:'file'}),/BAD/);
 assert.equal(formatRuntimeError(new Error('problem')),'Error: problem');
});
test('Ammo startup times out cleanly instead of hanging',async()=>{
 await assert.rejects(()=>loadAmmoModule({setConfig(){},getInstance(){}},{},{timeoutMs:5}),/timed out/);
});
test('race reset imports emptyDrift and never uses Node-style Ammo getInstance',()=>{
 const source=fs.readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
 assert.match(source,/import \{emptyDrift\} from ['"]\.\.\/v16\/kart64\.js['"]/);
 assert.match(source,/car\.driftState=emptyDrift\(\)/);
 assert.doesNotMatch(source,/getInstance\(['"]Ammo['"],\s*\(error\s*,\s*instance\)/);
 assert.match(source,/await loadAmmoModule\(/);
});
