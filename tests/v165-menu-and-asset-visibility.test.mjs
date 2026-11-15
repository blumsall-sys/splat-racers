import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import {menuPadIntent} from '../src/input/menu-gamepad.js';
const pad=(axes=[],pressed=[])=>({connected:true,axes,buttons:Array.from({length:16},(_,i)=>({value:pressed.includes(i)?1:0}))});
test('gamepad menu maps stick/D-pad direction, confirm and back',()=>{
 assert.equal(menuPadIntent(pad([0,-.9])).vertical,-1);
 assert.equal(menuPadIntent(pad([0,.9])).vertical,1);
 assert.equal(menuPadIntent(pad([.9,0])).horizontal,1);
 assert.equal(menuPadIntent(pad([], [12])).vertical,-1);
 assert.equal(menuPadIntent(pad([], [0])).confirm,true);
 assert.equal(menuPadIntent(pad([], [9])).confirm,true);
 assert.equal(menuPadIntent(pad([], [1])).back,true);
 assert.equal(menuPadIntent(null).confirm,false);
});
test('exported visible GLB includes wall collection separately from colliders',()=>{
 const s=fs.readFileSync('blender_addon/lab5_splat_packager/exporter.py','utf8');
 assert.match(s,/visual_meshes=mesh_objects\('RACE_VISUALS'\)\+mesh_objects\('RACE_WALLS'\)/);
 assert.match(s,/staticmeshes=mesh_objects\('RACE_COLLISION'\)\+mesh_objects\('RACE_WALLS'\)/);
});
test('packager supports explicit unbaked SOG placement object',()=>{
 const s=fs.readFileSync('blender_addon/lab5_splat_packager/__init__.py','utf8');
 assert.match(s,/bl_idname='lab5_race.make_sog_placement'/);
 assert.match(s,/SOG_PLACEMENT/);
});
test('menu navigator activates a mode with A, changes focus with stick, and B backs out',async()=>{
 const {GamepadMenuNavigator}=await import('../src/input/menu-gamepad.js');
 const mk=()=>({disabled:false,hidden:false,tagName:'BUTTON',clicked:0,
   classList:{add(){},remove(){}},focus(){},closest(){return null;},click(){this.clicked++;}});
 const one=mk(),two=mk();const root={querySelectorAll:()=>[one,two]};
 let padState=pad();let frame;let backs=0;
 const nav=new GamepadMenuNavigator({getRoot:()=>root,onBack:()=>backs++,getPads:()=>[padState],raf:f=>{frame=f;}});
 padState=pad([], [0]);frame();assert.equal(one.clicked,1,'A starts first mode directly');
 padState=pad();frame();padState=pad([0,.9]);frame();assert.equal(nav.selected,two);
 padState=pad();frame();padState=pad([], [0]);frame();assert.equal(two.clicked,1,'A starts selected mode');
 padState=pad();frame();padState=pad([],[1]);frame();assert.equal(backs,1,'B backs out');nav.destroy();
});
