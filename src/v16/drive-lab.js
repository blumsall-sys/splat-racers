import {Controls} from '../input/controls.js';
import {emptyDrift,kartControlStep} from './kart64.js';
const canvas=document.getElementById('map'),ctx=canvas.getContext('2d');
const keys=new Controls();
let sim,trail=[];
function reset(){sim={x:0,z:0,yaw:0,vx:0,vz:0,omega:0,drift:emptyDrift()};trail=[];}
reset();document.getElementById('reset').addEventListener('click',reset);
const dt=1/60;
function tick(){
  const inp=keys.sample().p1;
  const step=kartControlStep(sim,inp,sim.drift,dt);
  sim.drift=step.drift;
  sim.vx+=step.fx/170*dt;sim.vz+=step.fz/170*dt;
  sim.vx*=.9975;sim.vz*=.9975;
  const max=14.6;let speed=Math.hypot(sim.vx,sim.vz);if(speed>max){sim.vx*=max/speed;sim.vz*=max/speed;}
  sim.omega=step.commandedYaw;sim.yaw+=sim.omega*dt;
  sim.x+=sim.vx*dt;sim.z+=sim.vz*dt;
  if(trail.length===0||Math.hypot(trail.at(-1).x-sim.x,trail.at(-1).z-sim.z)>.08)trail.push({x:sim.x,z:sim.z});
  if(trail.length>1200)trail.shift();
  document.getElementById('drift').textContent=`Drift: ${sim.drift.active?'ACTIVE / sparks '+sim.drift.stage:'idle'} ${sim.drift.boostTime>0?'· MINI TURBO!':''}`;
  document.getElementById('telemetry').textContent=`Throttle : ${inp.throttle.toFixed(2)}\nSteer    : ${inp.steer.toFixed(2)}\nSpeed    : ${(Math.hypot(sim.vx,sim.vz)*3.6).toFixed(1)} km/h\nYaw      : ${(sim.yaw*180/Math.PI).toFixed(1)}°\nYaw rate : ${(sim.omega*180/Math.PI).toFixed(1)}°/s\nTarget   : ${(step.desiredYaw*180/Math.PI).toFixed(1)}°/s\nWorld X  : ${sim.x.toFixed(2)} m\nWorld Z  : ${sim.z.toFixed(2)} m\nController: ${keys.padNames[0]||'keyboard'}`;
}
function paint(){
 const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#1e4852';ctx.fillRect(0,0,w,h);
 const meter=16,originX=w/2,originY=h/2;const map=(p)=>({x:originX-(p.x-sim.x)*meter,y:originY-(p.z-sim.z)*meter});
 ctx.strokeStyle='#426773';ctx.lineWidth=1;ctx.beginPath();for(let i=-100;i<=100;i+=5){let x=originX-(i-sim.x)*meter;ctx.moveTo(x,0);ctx.lineTo(x,h);let y=originY-(i-sim.z)*meter;ctx.moveTo(0,y);ctx.lineTo(w,y);}ctx.stroke();
 ctx.strokeStyle='#78d6db';ctx.lineWidth=3;ctx.beginPath();trail.forEach((p,i)=>{const pt=map(p);if(i===0)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);});ctx.stroke();
 const ox=originX,oy=originY;ctx.save();ctx.translate(ox,oy);ctx.rotate(-sim.yaw);
 ctx.fillStyle='#adf58c';ctx.fillRect(-15,-23,30,46);ctx.fillStyle='#eff9e7';ctx.fillRect(-10,-7,20,13);
 for(const front of [-1,1])for(const side of [-1,1]){ctx.save();ctx.translate(side*18,front*16);if(front<0)ctx.rotate(0);else ctx.rotate(0);ctx.fillStyle='#101b22';ctx.fillRect(-6,-8,12,16);ctx.restore();}
 ctx.fillStyle='#ffdd91';ctx.beginPath();ctx.moveTo(0,-30);ctx.lineTo(-8,-17);ctx.lineTo(8,-17);ctx.fill();ctx.restore();
 ctx.fillStyle='#ddf9ee';ctx.font='17px system-ui';ctx.fillText('DRIVING DIRECTION',18,32);
 ctx.font='13px system-ui';ctx.fillStyle='#aec9c7';ctx.fillText('Camera looks along +Z. D steers to the right of the kart.',18,57);
}
let last=performance.now(),acc=0;
function frame(now){let delta=Math.min(.05,(now-last)/1000);last=now;acc+=delta;let n=0;while(acc>=dt&&n++<5){tick();acc-=dt;}paint();requestAnimationFrame(frame);}
requestAnimationFrame(frame);
