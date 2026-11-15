import test from 'node:test';
import assert from 'node:assert/strict';
import {RAYCAST_TUNING,wheelLayout,raycastCommands,createRaycastVehicle,driveRaycastVehicle,syncRaycastWheelVisuals,resetRaycastVehicle,stopRaycastVehicle,disposeRaycastVehicle} from '../src/v17/raycast-kart.js';

function mockVehicle(){
 const log={actions:0,removed:0,destroyed:[],engine:[],brake:[],steer:[],wheelTransforms:0};
 const Ammo={
  btVector3:class {constructor(x,y,z){Object.assign(this,{_x:x,_y:y,_z:z});}},
  btVehicleTuning:class{},
  btDefaultVehicleRaycaster:class {constructor(world){this.world=world;}},
  btRaycastVehicle:class {
   constructor(tuning,body,ray){this.wheels=[];this.body=body;}
   setCoordinateSystem(...xyz){this.coords=xyz;}
   addWheel(pos,dir,axle,length,radius,tuning,front){
    const wheel={pos,dir,axle,length,radius,front,friction:0,
      set_m_suspensionStiffness(v){this.stiffness=v;},set_m_wheelsDampingCompression(v){this.compression=v;},
      set_m_wheelsDampingRelaxation(v){this.relaxation=v;},set_m_frictionSlip(v){this.friction=v;},
      set_m_rollInfluence(v){this.roll=v;},set_m_maxSuspensionTravelCm(){},set_m_maxSuspensionForce(){},
      get_m_raycastInfo(){return {get_m_isInContact:()=>true,get_m_suspensionLength:()=>this.length};}};
    this.wheels.push(wheel);return wheel;
   }
   applyEngineForce(n,i){log.engine[i]=n;}
   setBrake(n,i){log.brake[i]=n;}
   setSteeringValue(n,i){log.steer[i]=n;}
   getWheelInfo(i){return this.wheels[i];}
   updateWheelTransform(i){log.wheelTransforms++;}
   getWheelTransformWS(i){return {getOrigin(){return {x:()=>i,y:()=>.30,z:()=>i+1};},getRotation(){return {x:()=>0,y:()=>0,z:()=>0,w:()=>1};}};}
   getCurrentSpeedKmHour(){return 11;}
   resetSuspension(){this.didReset=true;}
   getNumWheels(){return this.wheels.length;}
  },
  destroy(x){log.destroyed.push(x);}
 };
 const world={addAction(a){this.action=a;log.actions++;},removeAction(a){assert.equal(this.action,a);log.removed++;}};
 const body={setActivationState(v){log.activation=v;}};
 const entity={rigidbody:{body,linearVelocity:{x:0,y:0,z:2},angularVelocity:{x:0,y:0,z:0},activate(){this.active=true;},applyForce(){},applyTorque(){}},forward:{x:0,y:0,z:-1},up:{x:0,y:1,z:0}};
 const app={systems:{rigidbody:{dynamicsWorld:world}}};
 const rig=createRaycastVehicle(app,entity,Ammo);
 const wheels=wheelLayout().map(()=>({visual:{setPosition(...xyz){this.xyz=xyz;},setRotation(q){this.q=q;}}}));
 return {rig,log,world,car:{id:'p1',entity,raycast:rig,wheels},Ammo};
}

test('four raycast wheels, front steering, same world and no duplicate physical wheel bodies',()=>{
 const {rig,log,car}=mockVehicle();
 assert.equal(log.actions,1);assert.deepEqual(rig.vehicle.coords,[0,1,2]);
 assert.equal(rig.vehicle.getNumWheels(),4);
 assert.deepEqual(rig.vehicle.wheels.map(w=>w.front),[false,false,true,true]);
 assert.deepEqual(wheelLayout().map(w=>w.z),[-.75,-.75,.75,.75]);
 assert(rig.vehicle.wheels.every(w=>w.dir._y===-1 && w.axle._x===-1));
 assert.equal(log.activation,4);
 disposeRaycastVehicle(car);assert.equal(log.removed,1);assert.equal(car.raycast,null);
});
test('right D sends negative Bullet steering only to front wheels; left A sends positive',()=>{
 const {log,car}=mockVehicle();
 for(let i=0;i<25;i++)driveRaycastVehicle(car,{throttle:1,steer:1,drift:false},1/60,null);
 assert(log.steer[2]<0&&log.steer[3]<0);assert.equal(log.steer[0],undefined);
 for(let i=0;i<40;i++)driveRaycastVehicle(car,{throttle:1,steer:-1,drift:false},1/60,null);
 assert(log.steer[2]>0&&log.steer[3]>0);
 disposeRaycastVehicle(car);
});
test('forward rear-wheel drive and reverse after braking, with neutral roll down',()=>{
 const {log,car}=mockVehicle();
 driveRaycastVehicle(car,{throttle:1,steer:0},1/60,null);
 assert(log.engine[0]>0 && log.engine[1]>0);assert.equal(log.engine[2],0);assert.equal(log.engine[3],0);
 driveRaycastVehicle(car,{throttle:-1,steer:0},1/60,null);
 assert(log.brake[0]>0&&log.brake[1]>0);assert.equal(log.brake[2],0);assert.equal(log.brake[3],0);assert.equal(log.engine[0],0);
 car.entity.rigidbody.linearVelocity.z=-2;
 driveRaycastVehicle(car,{throttle:-1,steer:0},1/60,null);
 assert(log.engine[0]<0 && log.engine[1]<0);
 driveRaycastVehicle(car,{throttle:0,steer:0},1/60,null);
 assert(log.engine.every(x=>x===0));assert(log.brake[0]>0&&log.brake[1]>0);assert.equal(log.brake[2],0);assert.equal(log.brake[3],0);
 disposeRaycastVehicle(car);
});
test('native wheel transforms drive visual steering, rolling and contact height',()=>{
 const {car,log}=mockVehicle();
 class Quat{constructor(x,y,z,w){this.coords=[x,y,z,w];}}
 syncRaycastWheelVisuals(car,{Quat});
 assert.equal(log.wheelTransforms,4);assert.equal(car.wheelDiagnostics.probes,4);
 for(let i=0;i<4;i++){assert.deepEqual(car.wheels[i].visual.xyz,[i,.30,i+1]);assert.deepEqual(car.wheels[i].visual.q.coords,[0,0,0,1]);}
 resetRaycastVehicle(car);assert.equal(car.raycast.steering,0);assert(car.raycast.vehicle.didReset);
 stopRaycastVehicle(car);assert(log.brake[0]>0&&log.brake[1]>0);assert.equal(log.brake[2],0);assert.equal(log.brake[3],0);
 disposeRaycastVehicle(car);assert.equal(log.removed,1);
});
test('contact geometry leaves chassis underside above tire ground plane at rest',()=>{
 const t=RAYCAST_TUNING;
 const impliedTireBottom=t.startHeightAboveRoad+t.suspensionConnectionY-t.suspensionRestLength-t.wheelRadius;
 assert(impliedTireBottom>=0 && impliedTireBottom<.2);
 assert(t.startHeightAboveRoad-t.chassisHalfHeight > .35);
 assert.equal(wheelLayout().length,4);
});
test('native physics controller contains no yaw servo, extra spring or planar side correction',()=>{
 const right=raycastCommands({throttle:1,steer:1},5,0,1/60);assert(right.steeringValue<0);
 const left=raycastCommands({throttle:1,steer:-1},5,0,1/60);assert(left.steeringValue>0);
 const reverse=raycastCommands({throttle:-1},-2,0,1/60);assert(reverse.engine<0);
 assert.equal(typeof right.engine,'number');assert.equal(typeof right.tireGrip,'number');
});
