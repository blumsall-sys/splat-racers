import {integrateWheelSpin, MAX_STEER_ANGLE} from '../vehicle/wheels.js';
// LAB5 Bumper Cars physics v1.0. Dependency-free 2D rigid-body impulses, with 3D ride dynamics.
// All positions are ground-plane metres (x,z); vertical ride height is y.
export const STEP = 1 / 120;
const PI = Math.PI;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dot = (a,b) => a.x*b.x + a.z*b.z;
const cross = (a,b) => a.x*b.z - a.z*b.x;
const add = (a,b) => ({x:a.x+b.x,z:a.z+b.z});
const sub = (a,b) => ({x:a.x-b.x,z:a.z-b.z});
const mul = (a,k) => ({x:a.x*k,z:a.z*k});
const len = a => Math.hypot(a.x,a.z);
const unit = a => {const l=len(a)||1;return mul(a,1/l)};
import {DEFAULT_TRACK,terrainHeight} from '../track/track.js';
import {npcInput,AI_LEVELS} from '../race/ai-driver.js';
import {makeLapState,updateLaps,resetLap} from '../race/laps.js';
export const ZERO_INPUT = Object.freeze({throttle:0,steer:0,reset:false});
export const cleanInput = value => ({
  throttle: clamp(Number.isFinite(value?.throttle) ? value.throttle : 0,-1,1),
  steer: clamp(Number.isFinite(value?.steer) ? value.steer : 0,-1,1),
  reset: !!value?.reset
});
export function makeBody({id, kind='car', x=0,z=0, yaw=0, mass=190, hx=0.97,hz=1.23, color='#a6ea7a',physics=null}) {
  const inertia=mass*((hx*2)**2+(hz*2)**2)/12;
  return {id,kind,x,z,yaw,mass,invMass:mass>0?1/mass:0,inertia,invI:mass>0?1/inertia:0,
    hx,hz,color,physics:physics||null,vx:0,vz:0,omega:0,y:0.61,vy:0,pitch:0,roll:0,pitchSpeed:0,rollSpeed:0,
    input:{...ZERO_INPUT},speed:0,steerVisual:0,wheelAngles:[0,0,0,0]};
}
const direction=b=>({x:Math.sin(b.yaw),z:Math.cos(b.yaw)});
const right=b=>({x:Math.cos(b.yaw),z:-Math.sin(b.yaw)});
export {roadHeight} from './terrain.js';
import {roadHeight} from './terrain.js';
export const WALL_LAYOUT=DEFAULT_TRACK.collision.walls;
export function makeWorld(mode='solo',options={}) {
  if (!['solo','local'].includes(mode)) throw new Error('Unknown game mode');
  const track=options.track||DEFAULT_TRACK;
  const difficulty=AI_LEVELS[options.difficulty]?options.difficulty:'medium';
  const p1=makeBody({id:'p1',...track.spawns.p1,color:'#a7ee82'});
  const p2=makeBody({id:'p2',...track.spawns.p2,color:'#fa8f7b'});
  const obstacles=(track.collision.obstacles||[]).map(o=>makeBody({...o,kind:'crate'}));
  const bodies=[p1,p2,...obstacles];
  const walls=track.collision.walls;
  for(const b of bodies)b.getHeight=(x,z)=>terrainHeight(track,x,z);
  return {mode,track,difficulty,bodies,walls,
    staticBodies:walls.map(w=>({...w,yaw:w.yaw||0,invMass:0,invI:0,vx:0,vz:0,omega:0,kind:'wall'})),
    contacts:0,elapsed:0,ticks:0,race:makeLapState(track),aiDebug:null};
}
export function resetBody(world,id) {
  const body=world.bodies.find(b=>b.id===id);
  if(!body) return;
  const origin=(id==='p1'||id==='p2')?world.track.spawns[id]:world.track.collision.obstacles.find(o=>o.id===id);
  if(!origin)return;
  Object.assign(body,{x:origin.x,z:origin.z,yaw:origin.yaw||0,y:id==='p1'||id==='p2'?.61:.65});
  if(id==='p1'||id==='p2') resetLap(world,id);
  Object.assign(body,{vx:0,vz:0,omega:0,vy:0,pitch:0,roll:0,pitchSpeed:0,rollSpeed:0,speed:0,steerVisual:0,wheelAngles:[0,0,0,0]});
  body.input={...ZERO_INPUT};
}
function axes(b){return [right(b),direction(b)];}
function radiusOnAxis(b,axis){
  const [r,f]=axes(b);
  return b.hx*Math.abs(dot(r,axis))+b.hz*Math.abs(dot(f,axis));
}
function overlap(a,b){
  const delta={x:b.x-a.x,z:b.z-a.z};
  let minimum=Infinity,normal=null;
  for(const axis of [...axes(a),...axes(b)]) {
    const distance=dot(delta,axis);
    const depth=radiusOnAxis(a,axis)+radiusOnAxis(b,axis)-Math.abs(distance);
    if(depth<=0) return null;
    if(depth<minimum){minimum=depth;normal=mul(axis,distance>=0?1:-1);}
  }
  return {normal,depth:minimum};
}
function support(b,d) {
  const [r,f]=axes(b);
  const sr=Math.sign(dot(r,d))||1,sf=Math.sign(dot(f,d))||1;
  return {x:b.x+r.x*sr*b.hx+f.x*sf*b.hz,z:b.z+r.z*sr*b.hx+f.z*sf*b.hz};
}
function pointVelocity(b,r){return {x:b.vx+b.omega*r.z,z:b.vz-b.omega*r.x};}
function collide(a,b,world) {
  const contact=overlap(a,b);
  if(!contact) return false;
  const {normal:n,depth}=contact;
  const inv=a.invMass+b.invMass;
  if(!inv) return false;
  // Continuous overlap correction: no solver-generated ghost overlaps from duplicated visual collision.
  const correction=Math.max(0,depth-0.001)*0.87/inv;
  a.x-=n.x*correction*a.invMass;a.z-=n.z*correction*a.invMass;
  b.x+=n.x*correction*b.invMass;b.z+=n.z*correction*b.invMass;
  const sa=support(a,n),sb=support(b,mul(n,-1));
  // Surface contact midpoint is more stable than using collider centres for spin.
  const cp=mul(add(sa,sb),0.5);
  const ra=sub(cp,a),rb=sub(cp,b);
  const rel=sub(pointVelocity(b,rb),pointVelocity(a,ra));
  const vn=dot(rel,n);
  if(vn>=0) {world.contacts++;return true;}
  const rnA=cross(ra,n),rnB=cross(rb,n);
  const denom=inv+rnA*rnA*a.invI+rnB*rnB*b.invI;
  if(denom<1e-8) return true;
  const baseE=(a.kind==='crate'||b.kind==='crate')?0.42:0.57;
  const e=clamp(Math.max(a.physics?.restitution??baseE,b.physics?.restitution??baseE),0,0.9);
  const j=clamp(-(1+e)*vn/denom,0,2600);
  const impulse=mul(n,j);
  a.vx-=impulse.x*a.invMass;a.vz-=impulse.z*a.invMass;a.omega+=cross(ra,impulse)*a.invI;
  b.vx+=impulse.x*b.invMass;b.vz+=impulse.z*b.invMass;b.omega-=cross(rb,impulse)*b.invI;
  // Tangential contact friction opposes sideways sliding but preserves fun bumper rebounds.
  const tangent=sub(rel,mul(n,vn));const tl=len(tangent);
  if(tl>1e-6){
    const t=mul(tangent,1/tl);
    const ta=cross(ra,t),tb=cross(rb,t);
    const td=inv+ta*ta*a.invI+tb*tb*b.invI;
    const friction=clamp(((a.physics?.friction??0.34)+(b.physics?.friction??0.34))*0.5,0.05,1.0);
    const jt=clamp(-dot(rel,t)/td,-j*friction,j*friction);
    a.vx-=t.x*jt*a.invMass;a.vz-=t.z*jt*a.invMass;a.omega+=ta*jt*a.invI;
    b.vx+=t.x*jt*b.invMass;b.vz+=t.z*jt*b.invMass;b.omega-=tb*jt*b.invI;
  }
  if(a.kind==='car'){a.vy+=0.12;a.rollSpeed+=clamp(j*0.0004,-0.8,0.8);}
  if(b.kind==='car'){b.vy+=0.12;b.rollSpeed-=clamp(j*0.0004,-0.8,0.8);}
  world.contacts++;
  return true;
}
const staticBody = w => ({...w,yaw:0,invMass:0,invI:0,vx:0,vz:0,omega:0,kind:'wall'});
// Static collision comes from the active track JSON, not a hidden immutable wall list.
function driveCar(b,dt){
  const inp=b.input||ZERO_INPUT;
  const f=direction(b),r=right(b);
  const speed=b.vx*f.x+b.vz*f.z;
  const lat=b.vx*r.x+b.vz*r.z;
  // If reversing against forward motion, brake to a stop, then use genuine reverse thrust.
  const request=inp.throttle;
  const opposing = request!==0&&speed*request<-0.5;
  const driveAccel=opposing? -Math.sign(speed)*19 : (request>=0?request*12.0:request*9.0);
  b.vx+=f.x*driveAccel*dt;b.vz+=f.z*driveAccel*dt;
  const drift= Math.abs(inp.steer)>0.58&&Math.abs(speed)>6.5;
  const grip=drift?3.4:12.5;
  const lateralChange=lat*(1-Math.exp(-grip*dt));
  b.vx-=r.x*lateralChange;b.vz-=r.z*lateralChange;
  // Steering creates angular acceleration, not a velocity teleport, so collisions retain impulses.
  const steerInput=inp.steer;
  const turnSpeed=clamp(Math.abs(speed)/4.3,0,1);
  // +Z is forward, but chase-camera screen-right is -X: negate yaw for intuitive input.
  const targetYaw=-steerInput*Math.sign(speed||request||1)*turnSpeed*(drift?1.95:1.65);
  const visualTarget=-steerInput*MAX_STEER_ANGLE;
  b.steerVisual += (visualTarget-b.steerVisual)*(1-Math.exp(-11*dt));
  b.omega+=(targetYaw-b.omega)*(1-Math.exp(-7.6*dt));
  const damping=Math.exp(-0.45*dt);
  b.vx*=damping;b.vz*=damping;
  const v=len({x:b.vx,z:b.vz});
  if(v>18){b.vx*=18/v;b.vz*=18/v;}
  b.speed=speed;
}
function ride(b,dt){
  const f=direction(b),r=right(b);
  const h=(ox,oz)=>(b.getHeight||roadHeight)(b.x+r.x*ox+f.x*oz,b.z+r.z*ox+f.z*oz);
  const fl=h(-0.58,0.86),fr=h(0.58,0.86),rl=h(-0.58,-0.86),rr=h(0.58,-0.86);
  const avg=(fl+fr+rl+rr)/4;
  if(b.kind==='crate'){
    b.vy+=(45*(0.62+avg-b.y)-10*b.vy)*dt;
    b.y+=b.vy*dt;
    return;
  }
  b.vy+=(80*(0.74+avg-b.y)-13.2*b.vy-11)*dt;
  b.y+=b.vy*dt;
  b.y=Math.max(0.38+avg,b.y);
  // Ride suspension follows four ground samplers; pitch/roll reacts to turns and impacts.
  const pitchTarget=clamp(Math.atan2((fl+fr)-(rl+rr),3.4)+b.input.throttle*0.035,-0.23,0.23);
  const rollTarget=clamp(Math.atan2((fl+rl)-(fr+rr),2.3)-b.omega*b.speed*0.008,-0.24,0.24);
  b.pitchSpeed+=(60*(pitchTarget-b.pitch)-10*b.pitchSpeed)*dt;
  b.rollSpeed+=(54*(rollTarget-b.roll)-10*b.rollSpeed)*dt;
  b.pitch+=b.pitchSpeed*dt;b.roll+=b.rollSpeed*dt;
  b.pitch=clamp(b.pitch,-0.40,0.40);b.roll=clamp(b.roll,-0.40,0.40);
}
export function stepWorld(world, inputs={},dt=STEP){
  if(!(dt>0&&dt<=1/30)) throw new Error('Invalid fixed step');
  if(world.race.finished)return world;
  const cars=world.bodies.filter(b=>b.kind==='car');
  const previous={p1:{x:cars[0].x,z:cars[0].z},p2:{x:cars[1].x,z:cars[1].z}};
  for(const car of cars){
    car.input=cleanInput(inputs[car.id]||ZERO_INPUT);
    if(world.mode==='solo'&&car.id==='p2'){
      const ai=npcInput(car,world.track,world.difficulty);
      car.input=cleanInput(ai);world.aiDebug={target:ai.target,throttle:ai.throttle,steer:ai.steer};
      // High impacts may spin the unoccupied NPC: stabilize it gradually without teleporting.
      car.omega*=Math.exp(-1.15*dt);
      // Recover from prolonged stalls after impacts. Resume at a nearby centreline
      // waypoint, retaining checkpoint progress (no awarded laps for a teleport).
      if(!car.aiAnchor)car.aiAnchor={x:car.x,z:car.z,age:0};
      car.aiAnchor.age+=dt;
      if(car.aiAnchor.age>=5.5){
        const moved=Math.hypot(car.x-car.aiAnchor.x,car.z-car.aiAnchor.z);
        if(moved<1.8){
          const line=world.track.race.waypoints;
          let nearest=0,nearD=Infinity;
          for(let i=0;i<line.length;i++){
            const d=Math.hypot(car.x-line[i].x,car.z-line[i].z);
            if(d<nearD){nearD=d;nearest=i;}
          }
          const here=line[nearest],next=line[(nearest+1)%line.length];
          Object.assign(car,{x:here.x,z:here.z,yaw:Math.atan2(next.x-here.x,next.z-here.z),vx:0,vz:0,omega:0});
          previous.p2={x:here.x,z:here.z};
          world.aiRecoveries=(world.aiRecoveries||0)+1;
        }
        car.aiAnchor={x:car.x,z:car.z,age:0};
      }
    }
    if(car.input.reset) {resetBody(world,car.id);previous[car.id]={x:car.x,z:car.z};}
    driveCar(car,dt);
  }
  for(const crate of world.bodies.filter(b=>b.kind==='crate')){
    crate.vx*=Math.exp(-1.7*dt);crate.vz*=Math.exp(-1.7*dt);
    crate.omega*=Math.exp(-2.0*dt);
  }
  for(const b of world.bodies){
    b.x+=b.vx*dt;b.z+=b.vz*dt;b.yaw+=b.omega*dt;
    b.omega=clamp(b.omega,-5,5);
    ride(b,dt);
    integrateWheelSpin(b,dt);
  }
  // Collision correction is repeated for resting contact stacks and glancing impacts.
  for(let pass=0;pass<4;pass++) {
    for(const b of world.bodies) for(const wall of world.staticBodies) collide(b,wall,world);
    for(let i=0;i<world.bodies.length;i++)for(let j=i+1;j<world.bodies.length;j++)collide(world.bodies[i],world.bodies[j],world);
  }
  for(const b of world.bodies){
    if(![b.x,b.z,b.y,b.yaw,b.vx,b.vz,b.omega].every(Number.isFinite))
      throw new Error('Nonfinite physics body: '+b.id);
  }
  updateLaps(world,previous);
  world.elapsed+=dt;world.ticks++;
  return world;
}
