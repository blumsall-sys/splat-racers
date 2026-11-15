import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {raceRoster,ensureGridSpawns,racerResults} from '../src/race/roster.js';
import {makeLapState,updateLaps} from '../src/race/laps.js';
import {fromPad,fromKeys} from '../src/input/controls.js';
import {overrideSpec,refineImportedMaterials} from '../src/assets/playcanvas-materials.js';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const pad=(indices=[])=>({connected:true,axes:[0,0],buttons:Array.from({length:17},(_,i)=>({pressed:indices.includes(i),value:0}))});

test('one/two human rosters allocate at most four competitors in deterministic grid order',()=>{
 assert.deepEqual(raceRoster(1,3).map(x=>x.id),['p1','p2','p3','p4']);
 assert.deepEqual(raceRoster(1,3).map(x=>x.label),['PLAYER 1','NPC 1','NPC 2','NPC 3']);
 assert.deepEqual(raceRoster(2,2).map(x=>x.label),['PLAYER 1','PLAYER 2','NPC 1','NPC 2']);
 assert.deepEqual(raceRoster(2,0).map(x=>x.human),[true,true]);
 assert.throws(()=>raceRoster(2,3));assert.throws(()=>raceRoster(1,4));
});
test('legacy two-spawn Blender packs acquire rear-grid positions without mutating the source',()=>{
 const src={p1:{x:0,z:0,yaw:Math.PI/2},p2:{x:0,z:2,yaw:Math.PI/2}};
 const out=ensureGridSpawns(src);assert.ok(Math.abs(out.p3.x+3)<1e-9);assert.ok(Math.abs(out.p4.z-2)<1e-9);
 assert.equal(src.p3,undefined);
 const custom={...src,p3:{x:20,z:3,yaw:0},p4:{x:22,z:3,yaw:0}};
 assert.equal(ensureGridSpawns(custom).p3.x,20,'Blender-authored extra grid is authoritative');
});
test('four independent kart gate states can advance without moving other racers',()=>{
 const track={race:{lapsToWin:3,gates:[{id:'a',a:{x:0,z:0},b:{x:0,z:4}},{id:'b',a:{x:2,z:0},b:{x:2,z:4}}]}};
 const cars=['p1','p2','p3','p4'].map(id=>({id,x:-1,z:2,spec:{type:'KART'}}));
 const race=makeLapState(track,3,cars.map(c=>c.id));
 cars[2].x=1;
 const events=updateLaps({race,track,bodies:cars},{p1:{x:-1,z:2},p2:{x:-1,z:2},p3:{x:-1,z:2},p4:{x:-1,z:2}});
 assert.equal(events.length,1);assert.equal(events[0].id,'p3');assert.equal(race.per.p3.next,1);
 for(const id of ['p1','p2','p4'])assert.equal(race.per[id].next,0);
});
test('finish ranking places winner first and sorts 2nd–4th by completed progress',()=>{
 const cars=raceRoster(2,2).map(x=>({...x,isNpc:!x.human})),race={winner:'p3',per:{p1:{laps:2,next:2,launched:true},p2:{laps:1,next:3,launched:true},p3:{laps:3,next:0,launched:true},p4:{laps:0,next:1,launched:true}}};
 const ordered=racerResults(cars,race,()=>4);
 assert.deepEqual(ordered.map(x=>x.id),['p3','p1','p2','p4']);
 assert.deepEqual(ordered.map(x=>x.place),[1,2,3,4]);
});
test('gamepad LB descends ONLY, A/X ascend or hop, B nitro, Y reset, Start pauses',()=>{
 const b4=fromPad(pad([4]));assert.equal(b4.descend,true);assert.equal(b4.drift,false);assert.equal(b4.boost,false);
 for(const i of [0,2]){assert.equal(fromPad(pad([i])).drift,true);assert.equal(fromPad(pad([i])).descend,false);}
 assert.equal(fromPad(pad([1])).boost,true);assert.equal(fromPad(pad([3])).reset,true);
 const keys1=fromKeys(new Set(['ShiftLeft','KeyQ','Space']),'p1');
 assert.deepEqual([keys1.drift,keys1.descend,keys1.boost],[true,true,true]);
 const keys2=fromKeys(new Set(['ShiftRight','KeyO','KeyM']),'p2');
 assert.deepEqual([keys2.drift,keys2.descend,keys2.boost],[true,true,true]);
});
test('menu has distinct home / setup / vehicle / pause / settings stages and bottom-left split HUD',()=>{
 const html=read('index.html'),css=read('src/site.css'),main=read('src/v14/main.js');
 for(const stage of ['home','setup','vehicles','pause','settings'])assert(html.includes(`data-stage="${stage}"`));
 for(const id of ['solo-btn','local-btn','npc-count','ai-difficulty','race-laps','race-speed','p1-vehicle','p2-vehicle','countdown','countdown-number','finish-standings'])assert(html.includes(`id="${id}"`));
 assert.match(css,/\.game-hud \.speed-panel\{top:auto!important;bottom:28px/);
 assert.match(css,/\.game-hud \.speed-panel\.p2\{left:calc\(50% \+ 14px\)!important/);
 assert.match(main,/beginCountdown\(\)/);assert.match(main,/racerResults\(/);
 assert.match(main,/newMode\('solo'\)/);assert.match(main,/newMode\('local'\)/);
});
test('material refinement only opts in GLASS: preserves other Blender GLB material slots and textures',()=>{
 assert.equal(overrideSpec('Tarmac',{}),null);
 assert.equal(overrideSpec('LAB5_GLASS_window',{}).kind,'glass');
 assert.equal(overrideSpec('TransparentSide',{'TransparentSide':{kind:'glass',opacity:.4}}).opacity,.4);
 const old={name:'LAB5_GLASS_window',diffuseMap:'keep-original-GLB-texture',clone(){return {...this,update(){}};}};
 const asphalt={name:'Tarmac',clone(){throw new Error('Should not clone asphalt');}};
 const glassInstance={material:old},roadInstance={material:asphalt};
 const root={findComponents:()=>[{meshInstances:[glassInstance,roadInstance]}]};
 assert.equal(refineImportedMaterials(root,{}, {BLEND_NORMAL:2}),1);
 assert.equal(glassInstance.material.diffuseMap,'keep-original-GLB-texture');
 assert.equal(glassInstance.material.opacity,.26);assert.equal(roadInstance.material,asphalt);
});
test('Blender plugin exports optional P3/P4 spawns and material overrides without changing old SOG pipeline',()=>{
 const gen=read('blender_addon/lab5_splat_packager/track_builder.py'),exporter=read('blender_addon/lab5_splat_packager/exporter.py');
 assert.match(gen,/SPAWN_P3/);assert.match(gen,/SPAWN_P4/);
 assert.match(exporter,/for k in \('p1','p2','p3','p4'\)/);
 assert.match(exporter,/'materialOverrides':_playcanvas_material_overrides\(\)/);
 assert.match(exporter,/'splat':splat/);
});
