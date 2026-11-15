import test from 'node:test';import assert from 'node:assert/strict';
import {fromKeys,fromPad} from '../src/input/controls.js';
test('P1 WASD never drives P2 arrow controls',()=>{
  const k=new Set(['KeyW','KeyA']);
  assert.deepEqual((({throttle,steer})=>({throttle,steer}))(fromKeys(k,'p1')),{throttle:1,steer:-1});
  assert.deepEqual((({throttle,steer})=>({throttle,steer}))(fromKeys(k,'p2')),{throttle:0,steer:0});
});
test('keyboard P1 and P2 can accelerate and steer simultaneously',()=>{
  const k=new Set(['KeyW','KeyD','ArrowDown','ArrowLeft']);
  assert.deepEqual((({throttle,steer})=>({throttle,steer}))(fromKeys(k,'p1')),{throttle:1,steer:1});
  assert.deepEqual((({throttle,steer})=>({throttle,steer}))(fromKeys(k,'p2')),{throttle:-1,steer:-1});
});
test('browser gamepad left stick and triggers',()=>{
  const buttons=Array.from({length:17},()=>({value:0}));buttons[7].value=.91;
  assert.ok(fromPad({connected:true,axes:[-.6,0],buttons}).steer<-.3);
  assert.equal(fromPad({connected:true,axes:[-.6,0],buttons}).throttle,.91);
  buttons[7].value=0;buttons[6].value=.8;
  assert.equal(fromPad({connected:true,axes:[0,0],buttons}).throttle,-.8);
});
