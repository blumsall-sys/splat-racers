import test from 'node:test';
import assert from 'node:assert/strict';
import {GamepadMenuNavigator,menuPadIntent} from '../src/input/menu-gamepad.js';

function pad(pressed=[]){
 return {connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},(_,i)=>({pressed:pressed.includes(i),value:0}))};
}
function button(onClick=()=>{}){
 return {tagName:'BUTTON',disabled:false,hidden:false,clicked:0,
  classList:{add(){},remove(){}},focus(){},closest(){return null;},
  click(){this.clicked++;onClick();}};
}
function root(...buttons){return {querySelectorAll:()=>buttons};}
function harness(){
 let screen=null,padState=pad(),frame,pauses=0;
 const playAgain=button(()=>{screen=null;});
 const changeMode=button(()=>{screen='mode';});
 const solo=button(()=>{screen=null;});
 const modeRoot=root(solo),finishRoot=root(playAgain,changeMode);
 const nav=new GamepadMenuNavigator({
  getRoot:()=>screen==='finish'?finishRoot:screen==='mode'?modeRoot:null,
  getPads:()=>[padState],onPause:()=>{pauses++;},raf:fn=>{frame=fn;}
 });
 return {nav,playAgain,changeMode,solo,
  setScreen(s){screen=s;},get screen(){return screen;},
  press(...buttons){padState=pad(buttons);frame();},
  get pauses(){return pauses;}};
}

test('A confirms Play Again on checkered flag screen and returns to racing',()=>{
 const h=harness();h.setScreen('finish');
 h.press();h.press(0);
 assert.equal(h.playAgain.clicked,1);assert.equal(h.screen,null);
 h.press(0);assert.equal(h.playAgain.clicked,1,'holding A must not double click');
 h.nav.destroy();
});

test('Start confirms highlighted Change Mode after D-pad navigation',()=>{
 const h=harness();h.setScreen('finish');
 h.press();h.press(13);h.press();h.press(13);assert.equal(h.nav.selected,h.changeMode);
 h.press();h.press(9);
 assert.equal(h.changeMode.clicked,1);assert.equal(h.screen,'mode');
 h.press(9);assert.equal(h.solo.clicked,0,'held Start must not activate new screen');
 h.press();h.press(0);
 assert.equal(h.solo.clicked,1,'new A press should confirm on next menu');
 h.nav.destroy();
});

test('a new Start press confirms the finish screen even if A is held from a hop',()=>{
 const h=harness();
 h.press(0); // A is held during gameplay; cannot click a hidden menu
 h.setScreen('finish');h.press(0);
 assert.equal(h.playAgain.clicked,0);
 h.press(0,9); // a different confirmation button gets its own rising edge
 assert.equal(h.playAgain.clicked,1);
 h.nav.destroy();
});

test('A can confirm after Start was held when the race finished',()=>{
 const h=harness();
 h.press(9);assert.equal(h.pauses,1,'Start in race invokes pause only');
 h.setScreen('finish');h.press(9);
 assert.equal(h.playAgain.clicked,0,'held Start must not automatically click finish actions');
 h.press(9,0);assert.equal(h.playAgain.clicked,1,'new A press must work despite held Start');
 h.nav.destroy();
});

test('the standard Xbox A, X, Start buttons are independent while preserving menu intent',()=>{
 const a=menuPadIntent(pad([0])),x=menuPadIntent(pad([2])),start=menuPadIntent(pad([9]));
 assert.equal(a.confirmA,true);assert.equal(a.confirmX,false);assert.equal(a.start,false);
 assert.equal(x.confirmX,true);assert.equal(x.confirmA,false);
 assert.equal(start.start,true);assert.equal(start.confirm,true);
 assert.equal(menuPadIntent(pad([1])).back,true);
});
