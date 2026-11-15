import {checkColliderProxies} from './collider-proxies.js';
import * as pc from 'playcanvas';
import {assetURL} from './pack-contract.js';
import {refineImportedMaterials} from '../assets/playcanvas-materials.js';
import {loadSogAsset,versionedSogUrl} from './sog-loader.js';
import {applySogAnchorTransform} from './sog-transform.js';
import {requirePhysicsBackend,requireStaticCollider} from './physics-startup-guard.js';
import {isWallMeshName,isRoadMeshName,wallProxy} from './collision-policy.js';
import {RAYCAST_TUNING,createRaycastVehicle} from '../v17/raycast-kart.js';
export function loadContainer(app,url){
 return new Promise((resolve,reject)=>app.assets.loadFromUrl(url,'container',(err,asset)=>err?reject(new Error('GLB loading failed: '+url+' — '+err)):resolve(asset)));
}
export function createBox(app,name,xyz,scale,color,physics){
 const e=new pc.Entity(name);e.setPosition(...xyz);e.setLocalScale(...scale);
 const mat=new pc.StandardMaterial();mat.diffuse=new pc.Color(...color);mat.update();
 e.addComponent('render',{type:'box',material:mat,castShadows:true});
 app.root.addChild(e);
 if(physics){e.addComponent('collision',{type:'box',halfExtents:new pc.Vec3(.5,.5,.5)});e.addComponent('rigidbody',physics);}
 return e;
}
export function addLights(app,specs=[]){
 if(specs?.length){
  app.scene.ambientLight=new pc.Color(.43,.47,.52);
  for(const s of specs){
   const e=new pc.Entity('Blender Light: '+s.id);app.root.addChild(e);
   e.setPosition(...s.position);e.setRotation(new pc.Quat(...s.rotation));
   e.addComponent('light',{type:s.type,color:new pc.Color(...s.color),
    intensity:s.intensity,range:s.range,castShadows:!!s.castShadows,
    ...(s.type==='spot'?{innerConeAngle:s.innerConeAngle,outerConeAngle:s.outerConeAngle}:{}),
    ...(s.type==='directional'?{shadowDistance:80,shadowResolution:1024}:{})});
  }
  return;
 }
 const light=new pc.Entity('Sun');light.setEulerAngles(48,40,0);
 light.addComponent('light',{type:'directional',color:new pc.Color(1,.96,.87),intensity:1.85,castShadows:true,shadowDistance:70,shadowResolution:1024});app.root.addChild(light);
 const ambient=new pc.Color(.48,.58,.64);app.scene.ambientLight=ambient;
 app.scene.skyboxMip=0;
}
/** Match a GLB render node to its actual registered render asset.
 * instantiateRenderEntity can expose meshInstances directly; render.asset is not
 * guaranteed to be populated. An unbound mesh collider silently creates no floor.
 */
export function resolveCollisionRenderAsset(container,render,registry){
 const id=render.asset;
 if(id!==undefined&&id!==null){const found=typeof id==='object'?id:registry.get(id);if(found?.resource?.meshes?.length)return found;}
 const instances=render.meshInstances||[];
 const candidates=container.resource.renders||[];
 const found=candidates.find(a=>a.resource?.meshes?.some(mesh=>instances.some(mi=>mi.mesh===mesh)));
 return found||null;
}
/** Use the imported GLB hierarchy, with each rigidbody on exactly the node whose
 * mesh/transform it owns. Never silently fall back to phantom JSON road colliders. */
export function attachStaticMeshCollider(app,asset,{visible=false,skipWalls=false,allowEmpty=false}={}){
 // The application must be started first so RigidBodyComponentSystem has an
 // installed PhysicsWorld. A missing backend otherwise looks like bad GLB data.
 requirePhysicsBackend(app);
 const hierarchy=asset.resource.instantiateRenderEntity({castShadows:false});
 hierarchy.name='Blender static collision GLB';app.root.addChild(hierarchy);
 let count=0,triangles=0,skippedWalls=0;
 for(const render of hierarchy.findComponents('render')){
  const entity=render.entity;
  // In box-wall mode, the source wall mesh still belongs to the GLB, but is
  // NOT added as a second collider. It remains hidden even in collider debug.
  const renderAsset=resolveCollisionRenderAsset(asset,render,app.assets);
  if(skipWalls && (isWallMeshName(entity.name)||isWallMeshName(renderAsset?.name))){
   if(typeof render.hide==='function')render.hide();
   skippedWalls++;
   continue;
  }
  if(!renderAsset)throw new Error(`No render asset for static collider ${entity.name}. Check GLB mesh assets.`);
  const meshes=renderAsset.resource.meshes||[];
  if(!meshes.length)throw new Error(`Empty static collider ${entity.name}`);
  if(!isWallMeshName(entity.name) && !isWallMeshName(renderAsset?.name))entity.tags.add('lab5-drivable-road');
  entity.addComponent('collision',{type:'mesh',renderAsset,convexHull:false});
  entity.addComponent('rigidbody',{type:'static',friction:.95,restitution:(isWallMeshName(entity.name)||isWallMeshName(renderAsset?.name))?.72:.20});
  requireStaticCollider(entity,renderAsset,meshes.length);
  triangles+=meshes.reduce((n,m)=>n+Math.floor((m.primitive?.[0]?.count||0)/3),0);
  if(!visible&&typeof render.hide==='function')render.hide();
  count++;
 }
 if(count<1&&!allowEmpty)throw new Error('No static collision triangles were registered from collision.glb');
 return {hierarchy,count,triangles,skippedWalls};
}

/** One static box per exporter-authored guardrail section. The body uses
 * explicit half-extents (PlayCanvas ignores entity scale for box physics).
 * No second wall collider is present when this mode is selected. */
export function attachWallBoxColliders(app, track,{visible=false}={}){
 const root=new pc.Entity('LAB5 wall physics: BOX segments');app.root.addChild(root);
 let count=0;
 for(const w of track.collision.walls){
  const s=wallProxy(w);
  const e=new pc.Entity('Wall: '+s.id);root.addChild(e);
  e.setPosition(...s.position);e.setEulerAngles(0,s.yawRadians*180/Math.PI,0);
  if(visible){
   const mat=new pc.StandardMaterial();mat.diffuse=new pc.Color(.92,.26,.18);mat.opacity=.32;mat.blendType=pc.BLEND_NORMAL;mat.depthWrite=false;mat.update();
   e.addComponent('render',{type:'box',material:mat});
   e.setLocalScale(...s.halfExtents.map(n=>n*2));
  }
  e.addComponent('collision',{type:'box',halfExtents:new pc.Vec3(...s.halfExtents)});
  e.addComponent('rigidbody',{type:'static',friction:.75,restitution:.72});
  if(!e.rigidbody.body)throw new Error('Ammo failed to create guardrail collider for '+s.id);
  count++;
 }
 return {root,count};
}
/** Blender-authored JSON wireframe colliders. Physics uses primitive shapes,
 * not the splat, SOG voxels, or a rendered collider mesh. */
export function addPrimitiveColliders(app,specs=[],{visible=false,enableDynamic=true}={}){
 requirePhysicsBackend(app);
 checkColliderProxies(specs);
 const root=new pc.Entity('Blender primitive collision proxies');app.root.addChild(root);
 const objects=[];
 for(const spec of specs){
  if(spec.bodyType==='dynamic'&&!enableDynamic)continue;
  const e=new pc.Entity('Proxy: '+spec.id);root.addChild(e);
  e.setPosition(...spec.position);
  e.setRotation(new pc.Quat(...spec.rotation));
  if(spec.drivable)e.tags.add('lab5-drivable-road');
  if(spec.shape==='BOX')e.addComponent('collision',{type:'box',halfExtents:new pc.Vec3(...spec.halfExtents)});
  else e.addComponent('collision',{type:'sphere',radius:spec.radius});
  e.addComponent('rigidbody',{type:spec.bodyType,mass:spec.bodyType==='dynamic'?spec.mass:0,
   friction:spec.friction??.85,restitution:spec.restitution??(spec.drivable?.20:spec.bodyType==='dynamic'?.62:.72),
   ...(spec.bodyType==='dynamic'?{linearDamping:.35,angularDamping:.4}:{})});
  if(!e.rigidbody.body)throw new Error('Ammo failed to make '+spec.bodyType+' proxy '+spec.id);
  if(visible||spec.bodyType==='dynamic'){
   const material=new pc.StandardMaterial();material.diffuse=new pc.Color(.25,.88,.89);
   material.opacity=visible?.21:.7;material.blendType=pc.BLEND_NORMAL;material.depthWrite=false;material.update();
   const visual=new pc.Entity('Proxy visual: '+spec.id);
   e.addChild(visual);
   visual.addComponent('render',{type:spec.shape==='BOX'?'box':'sphere',material,castShadows:false});
   if(spec.shape==='BOX')visual.setLocalScale(...spec.halfExtents.map(v=>v*2));
   else visual.setLocalScale(spec.radius*2,spec.radius*2,spec.radius*2);
  }
  objects.push({id:spec.id,entity:e,bodyType:spec.bodyType,initial:spec});
 }
 return {root,objects,count:objects.length,static:objects.filter(o=>o.bodyType==='static').length,dynamic:objects.filter(o=>o.bodyType==='dynamic').length};
}

export function setSplatCalibration(group,calibration){
 if(!group)return;
 const {position=[0,0,0],rotationEuler=[0,0,0],scale=1}=calibration||{};
 if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||!Array.isArray(rotationEuler)||rotationEuler.length!==3||!rotationEuler.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0||scale>10000)throw new Error('Invalid SOG alignment values. Expected {position:[x,y,z],rotationEuler:[x,y,z],scale:positiveNumber}.');
 group.setLocalPosition(...position);group.setLocalEulerAngles(...rotationEuler);group.setLocalScale(scale,scale,scale);
}
export async function addPackGeometry(app,pack,track,base,onStatus=()=>{},calibration=null,wallMode='boxes'){
 if(pack.visualGlb){onStatus('Loading Blender visuals GLB');const asset=await loadContainer(app,assetURL(base,pack.visualGlb));const e=asset.resource.instantiateRenderEntity({castShadows:true});e.name='Blender visuals';app.root.addChild(e);refineImportedMaterials(e,pack.materialOverrides||{},pc);}
 const showColliders=new URLSearchParams(location.search).has('colliders');
 let staticInfo={count:0,triangles:0};
 if(pack.staticCollisionGlb){
  onStatus('Building static triangle collision from Blender GLB');
  const collision=await loadContainer(app,assetURL(base,pack.staticCollisionGlb));
  staticInfo=attachStaticMeshCollider(app,collision,{visible:showColliders,skipWalls:wallMode!=='mesh',
   allowEmpty:(pack.colliders||[]).some(c=>c.bodyType==='static'&&c.drivable)});
 }
 const primitiveInfo=addPrimitiveColliders(app,pack.colliders||[],{visible:showColliders,enableDynamic:new URLSearchParams(location.search).get('props')!=='off'});
 const wallInfo=wallMode==='boxes' ? attachWallBoxColliders(app,track,{visible:showColliders}) : {count:0};
 if(wallMode==='boxes' && wallInfo.count===0 && track.levelType!=='FREE_ROAM')throw new Error('Box-wall mode requires collision.walls in track.json');
 let splat=null,splatGroup=null,sogAsset=null,sogError=null;
 if(pack.splat?.sog){
  onStatus('Loading Gaussian SOG (explicit registered PlayCanvas gsplat asset)');
  const sogUrl=versionedSogUrl(assetURL(base,pack.splat.sog),pack);
  try{
   sogAsset=await loadSogAsset(app,pc,sogUrl,{onStatus:state=>onStatus('Gaussian SOG: '+state)});
   splatGroup=new pc.Entity('SOG calibration (world offset/rotation/scale)');app.root.addChild(splatGroup);
   splat=new pc.Entity('Gaussian splat visual, no collider');splatGroup.addChild(splat);
   splat.addComponent('gsplat',{asset:sogAsset});
   applySogAnchorTransform(splat,pack.splat.anchorMatrixColumnMajor,pc);
   setSplatCalibration(splatGroup,calibration);
  }catch(err){sogError=err.message;onStatus('SOG failed (driving remains available): '+sogError);console.error('[LAB5 SOG]',err);}
 }
 return {splat,splatGroup,sogAsset,sogError,staticInfo,primitiveInfo,wallInfo,wallMode};
}
export async function addDynamicObjects(app,pack,track,base,{enabled=true}={}){
 const objects=[];
 if(!enabled)return objects;
 for(const spec of pack.dynamic||[]){
  const meta=track.collision.obstacles.find(x=>x.id===spec.id);
  const asset=await loadContainer(app,assetURL(base,spec.asset));
  const e=new pc.Entity('Dynamic: '+spec.id);e.setPosition(meta.x,meta.y??.65,meta.z);e.setEulerAngles(0,meta.yaw*180/Math.PI,0);
  app.root.addChild(e);
  const model=asset.resource.instantiateRenderEntity({castShadows:true});e.addChild(model);refineImportedMaterials(model,pack.materialOverrides||{},pc);
  const renderAsset=asset.resource.renders?.[0];
  // Existing Blender packager uses one local-origin mesh GLB per dynamic object.
  if(!renderAsset)throw new Error('No render asset for dynamic object '+spec.id);
  e.addComponent('collision',{type:'mesh',renderAsset,convexHull:true});
  const prop=spec.physics||{};
  e.addComponent('rigidbody',{type:'dynamic',mass:Math.max(1,meta.mass||40),friction:prop.friction??.5,restitution:prop.restitution??.70,linearDamping:.35,angularDamping:.4});
  objects.push({id:spec.id,entity:e});
 }
 return objects;
}
/** Native btRaycastVehicle chassis. The box rides *above* the tire contact plane;
 * its underside must not scrape the road and compete with wheel suspension.
 * Body/wheel visuals are attached separately, with wheel transforms driven by Ammo.
 */
export function makeKart(app,id,spawn,color,ammo,spec={},assetPair={}){
 const T={...RAYCAST_TUNING,massKg:spec.mass??RAYCAST_TUNING.massKg,
  speedLimitMps:spec.maxSpeed??RAYCAST_TUNING.speedLimitMps,
  jumpSpeed:spec.jumpSpeed??RAYCAST_TUNING.jumpSpeed,
  wheelTrack:spec.wheelTrack??RAYCAST_TUNING.wheelTrack,
  wheelAxle:spec.wheelAxle??RAYCAST_TUNING.wheelAxle};
 const chassis=new pc.Entity(id);
 chassis.setPosition(spawn.x,(spawn.y??0)+T.startHeightAboveRoad,spawn.z);
 chassis.setEulerAngles(0,(spawn.yaw??0)*180/Math.PI,0);app.root.addChild(chassis);
 const extents=spec.chassisHalfExtents||[T.chassisHalfWidth,T.chassisHalfHeight,T.chassisHalfLength];
 chassis.addComponent('collision',{type:'box',halfExtents:new pc.Vec3(...extents)});
 chassis.addComponent('rigidbody',{type:'dynamic',mass:T.massKg,friction:.40,restitution:.64,linearDamping:.10,angularDamping:.34});
 // Arcade anti-tip: preserve full steering yaw while suppressing the
 // extreme pitch/roll impulse that a short wheelbase creates on throttle.
 // This is NOT an angular-velocity servo and does not turn off slope response.
 chassis.rigidbody.angularFactor=new pc.Vec3(.25,1,.25);
 if(assetPair.body){
  const body=assetPair.body.resource.instantiateRenderEntity({castShadows:true});body.name=id+' custom body';chassis.addChild(body);refineImportedMaterials(body,assetPair.materialOverrides||{},pc);
 }
 else {
 const body=createBox(app,id+' shell',[0,0,0],[1.39,.54,1.80],color);
 body.reparent(chassis);body.setLocalPosition(0,.03,0);body.setLocalScale(1.39,.54,1.80);
 const seat=createBox(app,id+' seat',[0,0,0],[.98,.40,.85],[.92,.95,.86]);
 seat.reparent(chassis);seat.setLocalPosition(0,.34,-.12);seat.setLocalScale(.98,.40,.85);
 const bump=createBox(app,id+' bumper',[0,0,0],[1.52,.19,1.95],[.15,.18,.21]);
 bump.reparent(chassis);bump.setLocalPosition(0,-.18,0);bump.setLocalScale(1.52,.19,1.95);
 }
 const mat=new pc.StandardMaterial();mat.diffuse=new pc.Color(.07,.085,.10);mat.update();
 const wheels=[];
 for(const spec of [
  {front:false,side:-1},{front:false,side:1},
  {front:true,side:-1},{front:true,side:1}
 ]){
  const visual=new pc.Entity(`${id} ${spec.front?'front':'rear'} ${spec.side<0?'left':'right'} Ammo wheel`);
  app.root.addChild(visual);
  if(assetPair.wheel){
   const tire=assetPair.wheel.resource.instantiateRenderEntity({castShadows:true});tire.name='exported spinning wheel';visual.addChild(tire);refineImportedMaterials(tire,assetPair.materialOverrides||{},pc);
  }else{
   const tire=new pc.Entity('tire mesh');visual.addChild(tire);
   tire.addComponent('render',{type:'cylinder',material:mat,castShadows:true});
   tire.setLocalScale(T.wheelRadius*2,.23,T.wheelRadius*2);
   tire.setLocalEulerAngles(0,0,90);
   const tab=createBox(app,'wheel rolling marker',[0,0,0],[.035,.08,.07],[.85,.84,.67]);
   tab.reparent(visual);tab.setLocalPosition(.14,.19,.19);tab.setLocalScale(.035,.08,.07);
  }
  wheels.push({...spec,visual});
 }
 const native=chassis.rigidbody.body;
 if(native?.setCcdMotionThreshold)native.setCcdMotionThreshold(.18);
 if(native?.setCcdSweptSphereRadius)native.setCcdSweptSphereRadius(.23);
 const car={id,entity:chassis,wheels,x:spawn.x,z:spawn.z,vx:0,vz:0,yaw:spawn.yaw||0,omega:0,
  spec:{type:'KART',...spec},input:{throttle:0,steer:0,reset:false},lastYaw:0,lastPosition:{x:spawn.x,z:spawn.z}};
 car.raycast=createRaycastVehicle(app,chassis,ammo,T);
 // Preserves native Bullet ownership; custom wheelbase is set at creation.
 return car;
}

export function makeFlightVehicle(app,id,spawn,color,spec,assetPair={}){
 const kind=spec.type;
 if(!['HOVER','DRONE'].includes(kind))throw new Error('Unsupported flying rig '+kind);
 const e=new pc.Entity(id+' '+kind);
 e.setPosition(spawn.x,(spawn.y??0)+(kind==='DRONE'?3.1:spec.hoverHeight),spawn.z);
 e.setEulerAngles(0,(spawn.yaw??0)*180/Math.PI,0);app.root.addChild(e);
 const extents=spec.chassisHalfExtents||(kind==='HOVER'?[.88,.35,1.13]:[.66,.27,.66]);
 e.addComponent('collision',{type:'box',halfExtents:new pc.Vec3(...extents)});
 e.addComponent('rigidbody',{type:'dynamic',mass:spec.mass,friction:.35,restitution:.56,
  linearDamping:kind==='HOVER'?.14:.19,angularDamping:kind==='HOVER'?.85:.9});
 // Roll/pitch must remain unlocked: v1.9 suppressed the corrective torque too.
 e.rigidbody.angularFactor=new pc.Vec3(1,1,1);
 if(assetPair.body){const model=assetPair.body.resource.instantiateRenderEntity({castShadows:true});model.name='Custom '+kind;e.addChild(model);refineImportedMaterials(model,assetPair.materialOverrides||{},pc);}
 else{
  const body=createBox(app,kind+' body',[0,0,0],kind==='HOVER'?[1.7,.42,2.1]:[.98,.40,1.0],color);
  body.reparent(e);body.setLocalPosition(0,0,0);body.setLocalScale(...(kind==='HOVER'?[1.7,.42,2.1]:[.98,.40,1.0]));
  if(kind==='DRONE')for(const x of [-.82,.82])for(const z of [-.82,.82]){
   const arm=createBox(app,'Drone rotor arm',[0,0,0],[.32,.10,.32],[.29,.78,.84]);
   arm.reparent(e);arm.setLocalPosition(x,.12,z);arm.setLocalScale(.32,.10,.32);
  }
 }
 const car={id,entity:e,wheels:[],raycast:null,spec,x:spawn.x,z:spawn.z,vx:0,vz:0,yaw:spawn.yaw||0,omega:0,
  input:{throttle:0,steer:0,reset:false},hoverTarget:spec.hoverHeight,stableFlightYaw:spawn.yaw||0,tippedSeconds:0,lastYaw:0,lastPosition:{x:spawn.x,z:spawn.z}};
 return car;
}

export function addFlightRingVisuals(app,gates,alreadyInGlb=false){
 if(alreadyInGlb||!gates?.length)return null;
 const root=new pc.Entity('Runtime flight ring fallback (visual only)');app.root.addChild(root);
 const mat=new pc.StandardMaterial();mat.diffuse=new pc.Color(.18,.75,.91);mat.emissive=new pc.Color(.05,.48,.67);mat.update();
 for(const ring of gates){
  const n=new pc.Vec3(...ring.normal);
  let u=new pc.Vec3().cross(new pc.Vec3(0,1,0),n).normalize();
  if(u.length()<.1)u=new pc.Vec3(1,0,0);
  const v=new pc.Vec3().cross(n,u).normalize();
  const c=new pc.Vec3(...ring.position),segments=24;
  for(let i=0;i<segments;i++){
   const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;
   const p=c.clone().add(u.clone().mulScalar(Math.cos(a)*ring.radius)).add(v.clone().mulScalar(Math.sin(a)*ring.radius));
   const q=c.clone().add(u.clone().mulScalar(Math.cos(b)*ring.radius)).add(v.clone().mulScalar(Math.sin(b)*ring.radius));
   const e=new pc.Entity('Ring '+ring.id+' arc '+i);root.addChild(e);
   e.setPosition(p.clone().add(q).mulScalar(.5));e.lookAt(q);
   e.addComponent('render',{type:'box',material:mat,castShadows:false});e.setLocalScale(.17,.17,p.distance(q));
  }
 }
 return root;
}

export function addCameras(app){
 return ['p1','p2'].map((id,i)=>{
  const e=new pc.Entity('Camera '+id);e.addComponent('camera',{clearColor:new pc.Color(.10,.18,.23),fov:67,nearClip:.12,farClip:1000,priority:i,rect:i?new pc.Vec4(.5,0,.5,1):new pc.Vec4(0,0,1,1)});
  app.root.addChild(e);e.setPosition(i?5:0,20,-26);e.lookAt(0,0,0);return e;
 });
}
export function updateCameras(cameras,cars,mode,dt){
 const targets=mode==='local'?['p1','p2']:['p1'];
 for(let i=0;i<cameras.length;i++){
  const cam=cameras[i];cam.camera.enabled=targets.length>i;
  if(!cam.camera.enabled)continue;
  cam.camera.rect=mode==='local'?new pc.Vec4(i===0?0:.5,0,.5,1):new pc.Vec4(0,0,1,1);
  const car=cars.find(c=>c.id===targets[i]);if(!car)continue;
  const pos=car.entity.getPosition(),actualForward=car.entity.forward; // PlayCanvas forward is -Z; our car noses are +Z
  // Keep flight chase camera behind the horizontal heading when a drone or
  // hovercraft is pitched up/rolled. Never chase an upside-down local axis.
  const h=Math.hypot(actualForward.x,actualForward.z);
  const rear=car.spec?.type==='KART'?actualForward:
   h>.2?{x:actualForward.x/h,y:0,z:actualForward.z/h}:
   {x:-Math.sin(car.stableFlightYaw||0),y:0,z:-Math.cos(car.stableFlightYaw||0)};
  const yaw=car.cameraYaw||0;
  const f={x:rear.x*Math.cos(yaw)+rear.z*Math.sin(yaw),z:rear.z*Math.cos(yaw)-rear.x*Math.sin(yaw)};
  const goal=new pc.Vec3(pos.x+f.x*6.7,pos.y+4.2+(car.cameraHeight||0),pos.z+f.z*6.7);
  // Do not make every small chassis-height contact correction look like a
  // camera jump. Keep lateral tracking responsive while damping vertical
  // camera motion and look-at height independently.
  const current=cam.getPosition(),s=1-Math.exp(-Math.min(dt,.1)*8);
  const sy=1-Math.exp(-Math.min(dt,.1)*2.6);
  cam.setPosition(current.x+(goal.x-current.x)*s,current.y+(goal.y-current.y)*sy,current.z+(goal.z-current.z)*s);
  const wantedAim=pos.y+.35;
  cam.__lab5AimY=Number.isFinite(cam.__lab5AimY)?cam.__lab5AimY+(wantedAim-cam.__lab5AimY)*sy:wantedAim;
  cam.lookAt(pos.x-f.x*2,cam.__lab5AimY,pos.z-f.z*2);
 }
}

/** A visual-only checkerboard for legacy tracks lacking a Blender-exported finish stripe. */
export function addFinishLineFallback(app,track,physics){
 if(track.race.finishLineInVisuals)return null;
 const gate=track.race.gates[0];if(!gate)return null;
 const dx=gate.b.x-gate.a.x,dz=gate.b.z-gate.a.z,length=Math.hypot(dx,dz);
 if(length<.2)return null;
 const ux=dx/length,uz=dz/length;
 const nx=-uz,nz=ux,cols=10,rows=2,halfDepth=.29;
 const centerX=(gate.a.x+gate.b.x)/2,centerZ=(gate.a.z+gate.b.z)/2;
 let y=(track.spawns.p1.y??0)+.02;
 const h=physics?.raycastFirst?.(new pc.Vec3(centerX,y+70,centerZ),new pc.Vec3(centerX,y-140,centerZ),{filterCallback:e=>e?.tags?.has?.('lab5-drivable-road')||/roadcollision/i.test(e?.name||'')});
 if(h?.point?.y!==undefined)y=h.point.y+.045;
 const root=new pc.Entity('CHECKERED FINISH — VISUAL ONLY');app.root.addChild(root);
 const materials=[[.10,.13,.14],[.95,.97,.91]].map(c=>{const m=new pc.StandardMaterial();m.diffuse=new pc.Color(...c);m.update();return m;});
 for(let r=0;r<rows;r++)for(let i=0;i<cols;i++){
  const along=(i+.5)/cols*length-length/2;
  const ahead=(r+.5)/rows*2*halfDepth-halfDepth;
  const e=new pc.Entity('Finish tile');root.addChild(e);
  e.setPosition(centerX+ux*along+nx*ahead,y,centerZ+uz*along+nz*ahead);
  e.setEulerAngles(0,Math.atan2(-uz,ux)*180/Math.PI,0);
  e.addComponent('render',{type:'box',material:materials[(i+r)%2]});
  e.setLocalScale(length/cols,.014,2*halfDepth/rows);
 }
 return root;
}
