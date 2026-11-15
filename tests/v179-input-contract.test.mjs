import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fromKeys,fromPad,Controls} from '../src/input/controls.js';
import {GamepadMenuNavigator} from '../src/input/menu-gamepad.js';
import {RAYCAST_TUNING,createRaycastVehicle,driveRaycastVehicle,resetRaycastVehicle} from '../src/v17/raycast-kart.js';

const pad=(pressed=[],axes=[0,0])=>({connected:true,mapping:'standard',axes,
 buttons:Array.from({length:17},(_,i)=>({pressed:pressed.includes(i),value:0}))});
function button(){return {tagName:'BUTTON',hidden:false,disabled:false,clicks:0,
  classList:{add(){},remove(){}},focus(){},closest(){return null;},click(){this.clicks++;}};}

test('while racing B cannot pause, A/X cannot pause, Start pauses once per press from either local pad',()=>{
 let p=[pad(),pad()],frame,pauses=0;
 const nav=new GamepadMenuNavigator({getRoot:()=>null,getPads:()=>p,onPause:()=>pauses++,raf:fn=>frame=fn});
 p=[pad([1]),pad()];frame();assert.equal(pauses,0,'B must not pause');
 p=[pad(),pad([0])];frame();assert.equal(pauses,0,'P2 A must not pause');
 p=[pad([2]),pad()];frame();assert.equal(pauses,0,'P1 X must not pause');
 p=[pad(),pad([9])];frame();assert.equal(pauses,1,'P2 Start pauses');
 frame();assert.equal(pauses,1,'holding Start must not repeatedly pause');
 p=[pad([9]),pad([9])];frame();assert.equal(pauses,2,'P1 Start has independent edge');
 p=[pad(),pad()];frame();p=[pad([9]),pad()];frame();assert.equal(pauses,3);
 nav.destroy();
});

test('in checkered flag and paused menus A and Start confirm from either controller, B returns',()=>{
 let root=null,states=[pad(),pad()],frame,backs=0;
 const again=button(),mode=button();
 const nav=new GamepadMenuNavigator({getRoot:()=>root,getPads:()=>states,onBack:()=>backs++,raf:fn=>frame=fn});
 root={querySelectorAll:()=>[again,mode]};frame();
 states=[pad(),pad([0])];frame();assert.equal(again.clicks,1,'P2 A selects');
 states=[pad(),pad()];frame();states=[pad([13]),pad()];frame();assert.equal(nav.selected,mode);
 states=[pad(),pad([9])];frame();assert.equal(mode.clicks,1,'P2 Start confirms');
 states=[pad(),pad()];frame();states=[pad([1]),pad()];frame();assert.equal(backs,1,'B works as Back in visible menus');
 nav.destroy();
});

test('keyboard and gamepad use separate player channels, no B driving side effects',()=>{
 const keys=new Set(['KeyW','KeyD','ShiftLeft','ArrowDown','ArrowLeft','ShiftRight']);
 assert.deepEqual([fromKeys(keys,'p1').throttle,fromKeys(keys,'p1').steer,fromKeys(keys,'p1').drift],[1,1,true]);
 assert.deepEqual([fromKeys(keys,'p2').throttle,fromKeys(keys,'p2').steer,fromKeys(keys,'p2').drift],[-1,-1,true]);
 for(const idx of [0,2])assert.equal(fromPad(pad([idx])).drift,true);
 assert.equal(fromPad(pad([4])).drift,false);assert.equal(fromPad(pad([4])).descend,true);
 assert.equal(fromPad(pad([1])).drift,false,'B cannot hop or drift');
 assert.equal(fromPad(pad([1])).reset,false,'B cannot reset');
 assert.equal(fromPad(pad([9])).drift,false,'Start cannot hop or drift');
 assert.equal(fromPad(pad([3])).reset,true,'Y remains reset');
});

test('A used to select a menu item must be released before it hops on a new race',()=>{
 const oldWindow=globalThis.window,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const handlers=new Map();let pads=[pad([0]),pad()];
 try{
  globalThis.window={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener(){}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
  const controls=new Controls();controls.beginRace();
  let sample=controls.sample();assert.equal(sample.p1.drift,false,'menu-held A not consumed by race');
  pads=[pad(),pad()];sample=controls.sample();assert.equal(sample.p1.drift,false);
  pads=[pad([0]),pad()];sample=controls.sample();assert.equal(sample.p1.drift,true,'fresh A press hops');
  pads=[pad(),pad([2])];sample=controls.sample();assert.equal(sample.p1.drift,false);assert.equal(sample.p2.drift,true,'P2 X independent');
  handlers.get('keydown')({code:'ShiftLeft',target:{tagName:'BODY'},preventDefault(){}});
  handlers.get('keydown')({code:'ShiftRight',target:{tagName:'BODY'},preventDefault(){}});
  sample=controls.sample();assert.equal(sample.p1.drift,true);assert.equal(sample.p2.drift,true);
  controls.destroy();
 }finally{
  if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
  if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;
 }
});

function vehicleHarness(){
 let contact=true;const impulses=[];
 const Ammo={btVector3:class{},btVehicleTuning:class{},btDefaultVehicleRaycaster:class{},
  btRaycastVehicle:class{
   constructor(){this.wheels=[];}
   setCoordinateSystem(){}
   addWheel(){const w={set_m_suspensionStiffness(){},set_m_wheelsDampingCompression(){},set_m_wheelsDampingRelaxation(){},set_m_frictionSlip(){},set_m_rollInfluence(){},get_m_raycastInfo(){return {get_m_isInContact:()=>contact};}};this.wheels.push(w);return w;}
   applyEngineForce(){}setBrake(){}setSteeringValue(){}getWheelInfo(i){return this.wheels[i];}
   updateWheelTransform(){}resetSuspension(){}
  },destroy(){}};
 const world={addAction(){},removeAction(){}};
 const body={setActivationState(){}};
 const rb={body,linearVelocity:{x:0,y:0,z:0},applyImpulse(...args){impulses.push(args);},activate(){}};
 const entity={rigidbody:rb,forward:{x:0,y:0,z:-1}};
 const raycast=createRaycastVehicle({systems:{rigidbody:{dynamicsWorld:world}}},entity,Ammo);
 return {car:{id:'p1',entity,raycast},impulses,setContact:v=>contact=v};
}

test('A or Shift hop is independent of speed and steer, requires grounded wheels, fires once per press',()=>{
 const {car,impulses,setContact}=vehicleHarness();
 const press={throttle:0,steer:0,drift:true};
 driveRaycastVehicle(car,press,1/60,null);
 assert.equal(impulses.length,1,'standing still pressing A must hop');
 assert.equal(impulses[0][1],RAYCAST_TUNING.massKg*RAYCAST_TUNING.jumpSpeed);
 assert(RAYCAST_TUNING.jumpSpeed>=4.5,'takeoff speed should visibly clear a kart');
 for(let i=0;i<50;i++)driveRaycastVehicle(car,press,1/60,null);
 assert.equal(impulses.length,1,'holding hop never repeatedly applies impulse');
 driveRaycastVehicle(car,{drift:false},1/60,null);
 setContact(false);driveRaycastVehicle(car,press,1/60,null);
 assert.equal(impulses.length,1,'no airborne double-jump');
 driveRaycastVehicle(car,{drift:false},1/60,null);
 setContact(true);driveRaycastVehicle(car,press,1/60,null);
 assert.equal(impulses.length,2,'fresh grounded press hops again');
 resetRaycastVehicle(car);
 assert.equal(car.raycast.hopHeld,false);assert.equal(car.raycast.hopCooldown,0);
});

test('only focused control sources changed; player driving and Blender package remain intact',()=>{
 const menu=fs.readFileSync(new URL('../src/input/menu-gamepad.js',import.meta.url),'utf8');
 const main=fs.readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
 assert.match(menu,/if\(rising\('start'\)\)this\.onPause\(\)/);
 assert.match(main,/const escape=controls\.keys\.has\('Escape'\)/);
 assert.match(main,/controls\.beginRace\(\)/);
});
