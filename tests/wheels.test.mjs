import test from 'node:test';
import assert from 'node:assert/strict';
import {makeWorld,stepWorld,STEP} from '../src/physics/engine.js';
import {wheelPose,WHEEL_RADIUS,WHEEL_TRACK_HALF,WHEEL_BASE_HALF,ROAD_SURFACE_OFFSET,MAX_STEER_ANGLE} from '../src/vehicle/wheels.js';
import {lookAt,perspective,multiply} from '../src/render/math.js';
const car=(w,id='p1')=>w.bodies.find(b=>b.id===id);
function sim(w,n,values){for(let i=0;i<n;i++)stepWorld(w,values,STEP);}
const eq=(a,b,e=.00001)=>assert.ok(Math.abs(a-b)<e,`expected ${a} ~= ${b}`);
test('all eight initial tire contact patches sit on road, including a bump',()=>{
  for(const mode of ['solo','local']){
    const world=makeWorld(mode);
    for(const b of world.bodies.filter(b=>b.kind==='car'))
      for(const side of [-1,1])for(const axle of [-1,1]){
        const wheel=wheelPose(b,side,axle);
        eq(wheel.y-WHEEL_RADIUS,wheel.ground+.001);
        eq(wheel.ground,ROAD_SURFACE_OFFSET);
      }
  }
  const w=makeWorld(),b=car(w);b.x=6.8;b.z=-8.25;b.y=1.2;
  const w1=wheelPose(b,-1,1);assert.ok(w1.ground>ROAD_SURFACE_OFFSET);
  eq(w1.y-WHEEL_RADIUS,w1.ground+.001);
});
test('signed tire roll advances with forward motion, retreats in reverse, and resets',()=>{
  const w=makeWorld();const b=car(w);
  sim(w,30,{p1:{throttle:1}});assert.ok(b.wheelAngles.every(a=>a>0),`forward tire: ${b.wheelAngles}`);
  const before=b.wheelAngles[0];sim(w,1,{p1:{throttle:-1}});assert.ok(b.wheelAngles[0]>before);
  const reverse=makeWorld();sim(reverse,25,{p1:{throttle:-1}});
  assert.ok(car(reverse).wheelAngles.every(a=>a<0),`reverse tire: ${car(reverse).wheelAngles}`);
});
test('P1 and P2 front wheels steer right on D/right-arrow, rear wheels never steer',()=>{
  const w=makeWorld('local');sim(w,35,{p1:{throttle:1,steer:1},p2:{throttle:1,steer:1}});
  for(const b of [car(w,'p1'),car(w,'p2')]){
    assert.ok(b.steerVisual<0 && Math.abs(b.steerVisual)<=MAX_STEER_ANGLE);
    eq(wheelPose(b,1,-1).yaw,b.yaw);
    assert.ok(wheelPose(b,1,1).yaw<b.yaw);
  }
});
test('the projected camera shows positive X to screen-left, so negative yaw is screen-right',()=>{
  const matrix=multiply(perspective(Math.PI/3,1,.1,100),lookAt([0,5,-6],[0,.5,0]));
  const screenX=p=>{let t=[0,0,0,0];for(let c=0;c<4;c++)for(let r=0;r<4;r++)t[r]+=matrix[c*4+r]*[...p,1][c];return t[0]/t[3]};
  assert.ok(screenX([-1,0,0])>screenX([1,0,0]));
});

test('physical car bumper includes wheel and body silhouette so walls stop tires too',()=>{
  for(const b of makeWorld().bodies.filter(b=>b.kind==='car')){
    assert.ok(b.hx>=WHEEL_TRACK_HALF+.34/2);
    assert.ok(b.hz>=WHEEL_BASE_HALF+WHEEL_RADIUS);
  }
});
