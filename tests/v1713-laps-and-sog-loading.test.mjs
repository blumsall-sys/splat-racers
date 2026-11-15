import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeLapState} from '../src/race/laps.js';
import {selectLapTarget,DEFAULT_LAPS,LAP_CHOICES} from '../src/race/lap-options.js';
import {loadSogAsset,versionedSogUrl,splatReadiness} from '../src/v14/sog-loader.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
const pcscene=fs.readFileSync(new URL('../src/v14/pc-scene.js',import.meta.url),'utf8');
function mockApp(behavior='success'){
 const assets=[];
 class Asset{constructor(name,type,src){this.name=name;this.type=type;this.url=src.url;this.events=new Map();}
 on(event,fn){this.events.set(event,fn);}off(event){this.events.delete(event);}fire(event,...args){this.events.get(event)?.(...args);}}
 const app={assets:{add(asset){assets.push(asset);},load(asset){queueMicrotask(()=>{if(behavior==='success'){asset.resource={count:50};asset.fire('load',asset);}else if(behavior==='error')asset.fire('error','Bad SOG ZIP');else asset.fire('load',asset);});}}};
 return {app,pc:{Asset},assets};
}
test('lap menu offers exactly 1, 3 and 5; default 3',()=>{
 assert.equal(DEFAULT_LAPS,3);assert.deepEqual(LAP_CHOICES,[1,3,5]);
 assert.match(html,/id="race-laps"/);assert.match(html,/<option value="3" selected>/);
 for(const n of [1,3,5])assert.equal(selectLapTarget(String(n)),n);
 for(const n of [0,2,4,6])assert.throws(()=>selectLapTarget(n));
});
test('lap target per race overrides Blender track without mutation',()=>{
 const track={race:{lapsToWin:5}};
 for(const n of [1,3,5])assert.equal(makeLapState(track,n).lapsToWin,n);
 assert.equal(track.race.lapsToWin,5);
 assert.match(main,/makeLapState\(sceneData.track,selectedLaps,roster.map\(r=>r.id\)\)/);
 assert.match(main,/makeLapState\(world.track,selectedLaps,roster.map\(r=>r.id\)\)/);
});
test('explicit registered PlayCanvas gsplat asset waits for load and resource',async()=>{
 const {app,pc,assets}=mockApp();const result=await loadSogAsset(app,pc,'https://localhost/assets/room.sog');
 assert.equal(assets.length,1);assert.equal(assets[0].type,'gsplat');assert.equal(result.resource.count,50);
 assert.equal(splatReadiness({splat:{sog:'packs/r/room.sog'}},result).state,'loaded');
 assert.match(pcscene,/addComponent\('gsplat',\{asset:sogAsset\}\)/);
});
test('sog load errors report URL and preserve failure reason',async()=>{
 const {app,pc}=mockApp('error');await assert.rejects(loadSogAsset(app,pc,'https://localhost/assets/bad.sog'),/Bad SOG ZIP/);
});
test('false positive load event without resource is rejected',async()=>{
 const {app,pc}=mockApp('empty');await assert.rejects(loadSogAsset(app,pc,'https://localhost/assets/empty.sog'),/without a gsplat resource/);
});
test('content SHA becomes cache token so changing SOG bytes forces reload',()=>{
 const a={packId:'r1',splat:{sogSha256:'a'.repeat(64)}},b={packId:'r2',splat:{sogSha256:'b'.repeat(64)}};
 assert.match(versionedSogUrl('http://localhost/assets/track.sog',a),/sogrev=aaaa/);
 assert.notEqual(versionedSogUrl('http://localhost/assets/track.sog',a),versionedSogUrl('http://localhost/assets/track.sog',b));
});
test('no SOG reference is clearly marked missing rather than reported as loaded',()=>assert.equal(splatReadiness({splat:{}},null).state,'missing'));
test('sog diagnostic viewer is independent of Ammo and custom track',()=>{
 const viewer=fs.readFileSync(new URL('../src/v14/sog-test.js',import.meta.url),'utf8');
 assert.match(viewer,/loadSogAsset/);assert.doesNotMatch(viewer,/createRaycastVehicle|attachStaticMeshCollider|loadAmmoModule/);
});

test('all menu lap choices finish exactly on the selected completed lap',async()=>{
 const {updateLaps}=await import('../src/race/laps.js');
 for(const target of [1,3,5]){
  const track={race:{lapsToWin:5,gates:[{a:{x:0,z:-1},b:{x:0,z:1}}]}};
  const race=makeLapState(track,target);
  race.per.p1.laps=target-1;race.per.p1.launched=true;race.per.p1.next=0;
  const world={race,track,bodies:[{id:'p1',x:1,z:0}]};
  updateLaps(world,{p1:{x:-1,z:0}});
  assert.equal(world.race.per.p1.laps,target);assert.equal(world.race.winner,'p1');
  assert.equal(world.race.finished,true);
 }
});
