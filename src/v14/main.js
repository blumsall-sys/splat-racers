import {trackEffect} from '../race/track-effect.js';
import {drawMap,attachTouch,showEffects} from '../race/race-overlay.js';
import * as pc from 'playcanvas';
import {Controls} from '../input/controls.js';
import {applyGraphicsConfiguration,loadPrefilteredAtlas} from '../render/graphics-quality.js';
import {GamepadMenuNavigator} from '../input/menu-gamepad.js';
import {validateTrack} from '../track/track.js';
import {npcRacerState,stepRaycastNpc} from '../race/raycast-npc.js';
import {scanNpcObstacle,observeNpcSurface,rescueNpcToRoad} from '../race/npc-perception.js';
import {npcAirState,npcAirChoice,stepAirNpc,flightNpcObstacle} from '../race/air-npc.js';
import {makeLapState,updateLaps} from '../race/laps.js';
import {configuredRaceTarget} from '../race/lap-options.js';
import {splatReadiness} from './sog-loader.js';
import {makeBoostState,stepBoost,boostLabel} from '../race/boost.js';
import {deathZone,findRoadRespawn} from '../race/recovery.js';
import {assetURL,checkRacePack} from './pack-contract.js';
import {addLights,addPackGeometry,addDynamicObjects,makeKart,makeFlightVehicle,addFlightRingVisuals,loadContainer,addCameras,updateCameras,setSplatCalibration,addFinishLineFallback} from './pc-scene.js';
import {vehicleCatalog,loadVehicleAssets} from '../vehicles/library.js';
import {validateAirGates,legacyFlightGates,advanceAirLap,airRespawn,flightNpcRecoveryCandidates,inspectFlightCourse} from '../vehicles/air-race.js';
import {driveFlyingVehicle} from '../vehicles/flight-controls.js';
import {kartSpeedTuning,raceSpeedMultiplier} from '../vehicles/race-speed.js';
import {nextCheckpoint,raceProgress,waypointGuidance} from '../race/checkpoint-guide.js';
import {raceRoster,ensureGridSpawns,racerResults} from '../race/roster.js';
import {makeCheckpointMarkers} from './checkpoint-markers.js';
import {physicsState} from './drive-math.js';
import {RAYCAST_TUNING,driveRaycastVehicle,syncRaycastWheelVisuals,resetRaycastVehicle,stopRaycastVehicle,disposeRaycastVehicle} from '../v17/raycast-kart.js';
import {emptyDrift} from '../v16/kart64.js';
import {loadAmmoModule,formatRuntimeError} from '../v17/ammo-startup.js';
import {testAmmoRoadAtSpawns,validateAlignment} from './ground-check.js';
import {requirePhysicsBackend} from './physics-startup-guard.js';
import {sampleRoadSupport} from './road-support.js';
import {readStoredCalibration,saveStoredCalibration,clearStoredCalibration} from './sog-calibration-store.js';
import {chooseWallMode,collisionObjectName} from './collision-policy.js';

const $=s=>document.getElementById(s),base=import.meta.env.BASE_URL;
const canvas=$('viewport'),menu=$('menu'),finish=$('win-screen'),loading=$('status');
let menuNavigator=null;
let app=null,controls=null,world=null,cameras=[],props=[],sceneData=null,paused=true,mode=null,difficulty='medium';
let calibration=null,geometry=null,roadHits=null,ammoInstance=null,routeMarkers=null,onlineAdapter=null;
let selectedLaps=3,selectedRaceSpeed=1,catalog=[],vehicleAssets=new Map(),airGates=[],flightCourseReport={ok:true,warnings:[]};
let pendingMode='solo',menuStage='home',settingsReturn='home',countdownEpoch=0,countdownActive=false;
let time=0,contacts=0,lastContact='none',wallMode='mesh',showDebug=new URLSearchParams(location.search).has('debug');
const setStatus=msg=>{loading.textContent=msg;};
function error(err){
 console.error('[SPLAT RACERS v2.3.0]',err);
 const detail=formatRuntimeError(err);
 if(/SOG|gsplat|Gaussian/i.test(detail)){$('sog-readiness').dataset.state='failed';$('sog-readiness').textContent='SOG: load failed — '+detail;}
 $('error-box').textContent='Could not start Splat Racers: '+detail+' · Open Chrome Console (F12).';
 $('error-box').hidden=false;setStatus('v2.3.0 stopped: '+detail);
 menu.hidden=false;finish.hidden=true;['solo-btn','local-btn'].forEach(id=>$(id).disabled=true);
}
async function json(path){const r=await fetch(new URL(base+path,location.origin),{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status} reading ${path}`);return r.json();}
function refreshNpcPreview(){
 if(!sceneData)return;
 const humans=pendingMode==='local'?2:1;
 const count=pendingMode==='explore'?0:Math.min(4-humans,Number($('npc-count').value)||0);
 const roster=raceRoster(humans,count);
 const selected=roster.filter(r=>r.human).map(r=>$(r.id+'-vehicle').value);
 const choices=npcAirChoice(roster,selected,catalog,airGates.length);
 const rivals=roster.filter(r=>!r.human).map(r=>{
  const spec=catalog.find(v=>v.id===choices[Number(r.id.slice(1))-1]);
  return `${r.label}: ${spec?.label||'Kart'} (${spec?.type||'KART'})`;
 });
 $('vehicle-selection-note').textContent=rivals.length?rivals.join(' · '):'No computer racers in this race.';
}
function stage(name){
 menuStage=name;
 for(const element of document.querySelectorAll('.menu-stage'))element.hidden=element.dataset.stage!==name;
 if(name==='setup'){
  const max=pendingMode==='local'?2:3;
  const npc=$('npc-count');
  for(const option of npc.options)option.disabled=Number(option.value)>max;
  if(Number(npc.value)>max)npc.value=String(max);
 }
 if(name==='vehicles'){$('p2-vehicle-field').hidden=pendingMode!=='local';refreshNpcPreview();}
 if(name==='settings'){const pads=controls?.getPads()||[];$('controller-status').textContent=pads.some(Boolean)?`Connected: ${pads.map((x,i)=>x&&('P'+(i+1)+': '+(x.id||'Controller'))).filter(Boolean).join(' · ')}`:'No gamepad detected yet. Plug in controllers; first connected pad is P1.';}
 setMenu();
}
function setMenu(){
 const game=!!world;
 menu.hidden=!paused||!!world?.race.finished;
 finish.hidden=!world?.race.finished;
 $('game-hud').hidden=!game;
 $('p2-panel').hidden=!game||mode!=='local';
 document.body.classList.toggle('racing',game&&!paused);
}
function newMode(which){pendingMode=which;stage('setup');}
function backMenu(){
 if(!finish.hidden){$('win-menu-btn').click();return;}
 if(menuStage==='settings'){stage(settingsReturn);return;}
 if(menuStage==='vehicles'){stage('setup');return;}
 if(menuStage==='setup'){stage('home');return;}
 if(menuStage==='pause'&&world&&!world.race.finished){pause(false);return;}
 if(menuStage!=='home')stage('home');
}
function beginCountdown(){
 const token=++countdownEpoch,started=performance.now(),panel=$('countdown'),num=$('countdown-number');
 countdownActive=true;panel.hidden=false;app.timeScale=0;
 controls.keys.clear();controls.beginRace();
 let previous=null;
 function tick(now){
  if(token!==countdownEpoch)return;
  const elapsed=(now-started)/1000;
  const value=elapsed<1?'3':elapsed<2?'2':elapsed<3?'1':'GO!';
  if(previous!==value){num.textContent=value;num.style.animation='none';void num.offsetWidth;num.style.animation='count-pop .25s ease-out';previous=value;}
  if(elapsed>=3&&countdownActive){countdownActive=false;controls.keys.clear();controls.beginRace();app.timeScale=1;if(mode==='online')onlineAdapter?.setPhase('race');}
  if(elapsed>=3.65){panel.hidden=true;return;}
  requestAnimationFrame(tick);
 }
 requestAnimationFrame(tick);
}
function cancelCountdown(){++countdownEpoch;countdownActive=false;$('countdown').hidden=true;}
function stopAndClearRace(){
 cancelCountdown();
 if(world)for(const car of world.cars){if(car.raycast)disposeRaycastVehicle(car);for(const wheel of car.wheels||[])wheel.visual?.destroy();car.entity.destroy();}
 world=null;mode=null;paused=true;app.timeScale=0;controls?.keys.clear();
}
/** New race starts on the grid; later resets NEVER erase laps/checkpoint progress. */
function resetCar(car,{newRace=false,point=null}={}){
 const s=point||world.track.spawns[car.id],e=car.entity;
 const defaultRoad=roadHits?.[car.id]?.height??world.track.spawns[car.id].y??0;
 const roadY=point?.roadY??defaultRoad;
 const height=point?.y??(roadY+(car.spec.type==='DRONE'?3.1:car.spec.type==='HOVER'?car.spec.hoverHeight:RAYCAST_TUNING.startHeightAboveRoad));
 e.rigidbody.teleport(new pc.Vec3(s.x,height,s.z),new pc.Vec3(0,s.yaw*180/Math.PI,0));
 e.rigidbody.linearVelocity=new pc.Vec3(0,0,0);e.rigidbody.angularVelocity=new pc.Vec3(0,0,0);
 e.rigidbody.activate();if(car.raycast){resetRaycastVehicle(car);syncRaycastWheelVisuals(car,pc);}
 car.hoverTarget=height;car.hoverWorldTarget=height;car.hoverManualHeight=false;car.hoverHopCooldown=0;car.hoverHopDiagnostics=null;car.tippedSeconds=0;car.stableFlightYaw=s.yaw||0;car.flightDiagnostics=null;
 car.supportHeight=undefined;car.input={throttle:0,steer:0,reset:false,drift:false};
 car.driftState=emptyDrift();car.driverDiagnostics=null;
 if(newRace||!car.boost)car.boost=makeBoostState();
 else car.boost.active=0; // Keep cooldown across manual reset.
 car.deathSeconds=0;
 // Store a verified road height so the invisible death zone follows hills.
 car.lastSafe={x:s.x,z:s.z,yaw:s.yaw,roadY};
 if(newRace){car.npcState=car.spec.type==='KART'?npcRacerState():npcAirState();car.npcDiagnostics=null;}
 // Intentionally DON'T touch world.race.per[car.id]. A reset is not a new race.
}
function recoverCar(car,previous,reason){
 const body=car.entity.getPosition();
 const anchor=car.lastSafe || {x:world.track.spawns[car.id].x,z:world.track.spawns[car.id].z,roadY:roadHits?.[car.id]?.height??0};
 const other=world.cars.find(c=>c!==car);
 const flight=car.spec.type!=='KART';
 const gateIndex=world.race.per[car.id]?.lastGateIndex;
 const checkpoint=flight&&mode!=='explore'&&Number.isInteger(gateIndex)?airGates[gateIndex]:null;
 const safe=checkpoint?airRespawn(checkpoint):mode==='explore' ? {x:anchor.x,z:anchor.z,roadY:anchor.roadY,y:anchor.roadY+(flight?(car.spec.type==='DRONE'?3.1:car.spec.hoverHeight):RAYCAST_TUNING.startHeightAboveRoad),yaw:anchor.yaw||0} :
  (flight?{x:world.track.spawns[car.id].x,z:world.track.spawns[car.id].z,roadY:roadHits?.[car.id]?.height??0,y:(roadHits?.[car.id]?.height??0)+(car.spec.type==='DRONE'?3.1:car.spec.hoverHeight),yaw:world.track.spawns[car.id].yaw}:
   findRoadRespawn(world.track,app.systems.rigidbody,pc.Vec3,{x:body.x,y:body.y,z:body.z},other,anchor,RAYCAST_TUNING.startHeightAboveRoad));
 if(!safe){setStatus(`No collision-verified road near ${car.id}; recovery postponed.`);return false;}
 resetCar(car,{point:safe});
 // Reset the previous-position gate sample; teleporting must never count a lap.
 previous[car.id]={x:safe.x,y:safe.y,z:safe.z};
 Object.assign(car,physicsState(car.entity));
 car.recoveryReason=reason;
 return true;
}
function start(which){
 if(!sceneData)return;
 cancelCountdown();
 mode=which;paused=false;app.timeScale=0;
 difficulty=$('ai-difficulty').value;
 selectedLaps=configuredRaceTarget($('race-laps').value);
 selectedRaceSpeed=raceSpeedMultiplier($('race-speed').value);
 // Extra collision steps only for the highest speed presets, with the same
 // Bullet world and steering controllers. Avoid changing engine mass/gravity.
 app.systems.rigidbody.fixedTimeStep=selectedRaceSpeed>=2?1/120:1/60;
 app.systems.rigidbody.maxSubSteps=selectedRaceSpeed>=2?10:5;
 time=0;update.lastHud=-10;contacts=0;lastContact='none';
 const online=which==='online';
 if(online&&!onlineAdapter)throw Error('Native Ammo host was not initialized');
 if(online){
  const settings=onlineAdapter.settings();
  selectedLaps=configuredRaceTarget(settings.laps);
  selectedRaceSpeed=raceSpeedMultiplier(settings.pace);
  difficulty=settings.difficulty;
  app.systems.rigidbody.fixedTimeStep=selectedRaceSpeed>=2?1/120:1/60;
  app.systems.rigidbody.maxSubSteps=selectedRaceSpeed>=2?10:5;
 }
 const humans=online?onlineAdapter.humanCount():which==='local'?2:1;
 const count=online?onlineAdapter.settings().npcCount:which==='explore'?0:Math.min(4-humans,Number($('npc-count').value)||0);
 const roster=online?[
  ...onlineAdapter.roster(),
  ...onlineAdapter.aiIds().map((id,i)=>({id,human:false,label:'NPC '+(i+1)}))
 ]:which==='explore'?raceRoster(1,0):raceRoster(humans,count);
 const humanChoices=online
   ?['p1','p2','p3','p4'].map(id=>catalog.find(v=>v.type===onlineAdapter.vehicleFor(id))?.id||'kart')
   :roster.filter(entry=>entry.human).map(entry=>$(entry.id+'-vehicle').value);
 const selected=npcAirChoice(roster,humanChoices,catalog,airGates.length);
 if(!world||world.cars.length!==selected.length||world.cars.some((car,i)=>car.spec.id!==selected[i]||car.id!==roster[i].id||car.isNpc!==!roster[i].human)){
  if(world)for(const car of world.cars){if(car.raycast)disposeRaycastVehicle(car);for(const wheel of car.wheels||[])wheel.visual?.destroy();car.entity.destroy();}
  const cars=selected.map((choice,i)=>{
   const entry=roster[i],id=entry.id,spec=catalog.find(v=>v.id===choice)||catalog[0];
   if(spec.type!=='KART'&&!airGates.length&&which!=='explore')throw new Error('Flying races require Blender flight rings. Refresh Flight Rings and re-export.');
   const visual={...(vehicleAssets.get(spec.id)||{}),materialOverrides:sceneData.pack.materialOverrides||{}},colors=[[.63,.89,.35],[.98,.52,.39],[.51,.76,.99],[.95,.78,.42]],color=colors[i];
   const spawn=sceneData.track.spawns[id];
   const car=spec.type==='KART'?makeKart(app,id,spawn,color,ammoInstance,spec,visual):makeFlightVehicle(app,id,spawn,color,spec,visual);
   car.isNpc=!entry.human;car.label=entry.human?entry.label:`${entry.label} · ${spec.type}`;
   return car;
  });
  world={mode,track:sceneData.track,cars,bodies:cars,elapsed:0,race:makeLapState(sceneData.track,selectedLaps,roster.map(r=>r.id)),roster};
  for(const car of cars)car.entity.rigidbody.on('collisionstart',result=>{contacts++;lastContact=car.id+' → '+collisionObjectName(result);if(showDebug)console.info('[LAB5 collision]',lastContact);});
 }else{
  world.mode=mode;world.roster=roster;
  world.race=makeLapState(world.track,selectedLaps,roster.map(r=>r.id));
 }
 for(const car of world.cars){
  resetCar(car,{newRace:true});
  const notice=$(car.id+'-notice');if(notice)notice.textContent='';
  if(car.raycast){
   Object.assign(car.raycast.t,kartSpeedTuning(car.spec,which!=='explore',selectedRaceSpeed));
   const roll=Math.max(.028,.08/Math.sqrt(Math.max(1,selectedRaceSpeed)));
   for(let i=0;i<4;i++)car.raycast.vehicle.getWheelInfo(i).set_m_rollInfluence(roll);
  }
 }
 for(const prop of props){const original=world.track.collision.obstacles.find(x=>x.id===prop.id);if(!original&&!prop.initial)continue;
  if(prop.initial)prop.entity.rigidbody.teleport(new pc.Vec3(...prop.initial.position),new pc.Quat(...prop.initial.rotation));
  else prop.entity.rigidbody.teleport(new pc.Vec3(original.x,original.y??.65,original.z),new pc.Vec3(0,(original.yaw||0)*180/Math.PI,0));
  prop.entity.rigidbody.linearVelocity=new pc.Vec3(0,0,0);prop.entity.rigidbody.angularVelocity=new pc.Vec3(0,0,0);
 }
 controls.keys.clear();$('error-box').hidden=true;
 for(let k=0;k<18;k++)updateCameras(cameras,world.cars,mode,.1);
 setStatus(which==='explore'?`Free drive · ${sceneData.pack.packId}`:`${roster.length} racers (${humans} human + ${count} NPC) · ${selectedLaps} laps · ${selectedRaceSpeed}× speed`);
 setMenu();beginCountdown();
}
function pause(value=true){
 if(!world||world.race.finished||countdownActive)return;
 paused=value;app.timeScale=paused?0:1;controls.keys.clear();
 if(paused){stage('pause');for(const car of world.cars)if(car.raycast)stopRaycastVehicle(car);}
 else controls.beginRace();
 setMenu();
}
function finishRace(){
 const winner=world.race.winner;
 if(mode==='online')onlineAdapter?.setPhase('results');
 cancelCountdown();paused=true;app.timeScale=0;controls.keys.clear();
 for(const car of world.cars)if(car.raycast)stopRaycastVehicle(car);
 const results=racerResults(world.cars,world.race,c=>c.spec.type==='KART'?world.track.race.gates.length:airGates.length);
 $('winner-name').textContent=(results[0]?.label||winner.toUpperCase())+' WINS!';
 $('winner-stats').textContent=`${world.race.lapsToWin} laps · ${Math.floor(time/60)}:${String(Math.round(time%60)).padStart(2,'0')} race time · ${world.cars.length} racers`;
 const podium=$('finish-standings');podium.replaceChildren();
 for(const entry of results){
  const row=document.createElement('div');row.className='finish-rank';
  const label=document.createElement('b');label.textContent=`${entry.place}. ${entry.label}`;
  const progress=document.createElement('span');progress.textContent=`${Math.min(world.race.lapsToWin,entry.laps)} / ${world.race.lapsToWin} laps`;
  row.append(label,progress);podium.appendChild(row);
 }
 setMenu();
}
/** Physical rescue is the exception, not the AI steering strategy. When a
 * bot has failed repeated real manoeuvres, reinsert before the REQUIRED ring
 * (not the next ring), clear of other cars and a sampled wall/prop. Keep laps.
 * Never count the teleport as a signed checkpoint crossing. */
function rescueFlightNpcAtRequiredGate(car,before){
 const index=world?.race?.per?.[car.id]?.next??0,gate=airGates[index];
 if(!gate)return recoverCar(car,before,'npc-air-stuck');
 for(const candidate of flightNpcRecoveryCandidates(gate,car.id)){
  if(world.cars.some(other=>other!==car&&Math.hypot(other.x-candidate.x,(other.y||0)-candidate.y,other.z-candidate.z)<3.3))continue;
  const from=new pc.Vec3(candidate.x,candidate.y+.2,candidate.z);
  let blocked=false;
  for(const [dx,dz] of [[1.8,0],[-1.8,0],[0,1.8],[0,-1.8]]){
   const hit=app.systems.rigidbody.raycastFirst(from,new pc.Vec3(candidate.x+dx,candidate.y+.2,candidate.z+dz),
    {filterCallback:e=>e!==car.entity&&/^(?:p[1-4](?:\s+(?:HOVER|DRONE))?|Wall:|Dynamic:|Proxy:)/.test(String(e?.name||''))});
   if(hit?.point){blocked=true;break;}
  }
  if(blocked)continue;
  resetCar(car,{point:candidate});
  car.npcState=npcAirState();car.npcState.rescueCooldown=12;
  Object.assign(car,physicsState(car.entity));
  before[car.id]={x:car.x,y:car.y,z:car.z};
  if(showDebug)console.info('[NPC flight recovery] reset to required ring entry',car.id,gate.id);
  return true;
 }
 return recoverCar(car,before,'npc-air-stuck');
}
function announceGate(car,type,number,total){
 const notice=$(car.id+'-notice');if(notice){notice.textContent=`✓ ${type} ${number}/${total} CLEARED`;notice.hidden=false;}
 car.gateNoticeUntil=time+1.8;
 const state=world.race.per[car.id];
 setStatus(`${car.id.toUpperCase()} cleared ${type.toLowerCase()} ${number}/${total} · next ${state.next+1}/${total} · ${state.laps} laps completed`);
}
function update(dt){
 const escape=controls.keys.has('Escape')&&menu.hidden;if(escape&&!update.escLatch&&world&&!world.race.finished)pause(!paused);update.escLatch=escape;
 if(!world)return;
 const before={};
 for(const car of world.cars){const p=physicsState(car.entity);before[car.id]={x:car.x,y:car.y,z:car.z};Object.assign(car,p);}
 if(!paused&&!countdownActive&&!world.race.finished){
  time+=Math.min(dt,.08);world.elapsed=time;
  const inputs=controls.sample();
  for(const car of world.cars){
   let input=mode==='online'&&!car.isNpc?onlineAdapter.inputFor(car.id,inputs.p1):inputs[car.id];
   if(car.isNpc){
    if(car.spec.type==='KART'){
     const obstacle=scanNpcObstacle(app.systems.rigidbody,car,pc.Vec3);
     const surface=observeNpcSurface(app.systems.rigidbody,car,pc.Vec3);
     const decision=stepRaycastNpc(car,world.track,difficulty,dt,car.npcState,obstacle,surface,selectedRaceSpeed,world.cars.filter(other=>other!==car));
     car.npcState=decision.state;car.npcDiagnostics=decision.diagnostics;input=decision.input;
     if(decision.rescue){
      const reason=car.npcState.lastRescueReason||'off-track';
      const newPosition=rescueNpcToRoad(car,world.track,app.systems.rigidbody,pc.Vec3,world.cars.filter(other=>other!==car),car.npcState?.lastSafe,reason);
      if(newPosition){
       resetRaycastVehicle(car);car.npcState=npcRacerState();
       car.npcState.lastSafe={...newPosition};car.npcState.rescueCooldown=10;
       Object.assign(car,physicsState(car.entity));before[car.id]={x:car.x,y:car.y,z:car.z};
      }else{
       car.npcState.phase='REVERSE';car.npcState.phaseAge=0;
       car.npcState.trapSeconds=0;car.npcState.rescueCooldown=4;
      }
      continue;
     }
    }else{
     const obstacle=flightNpcObstacle(app.systems.rigidbody,car,pc.Vec3);
     const decision=stepAirNpc(car,airGates,world.race.per[car.id],car.npcState,dt,
      {difficulty,pace:selectedRaceSpeed,others:world.cars.filter(c=>c!==car),obstacle});
     car.npcState=decision.state;car.npcDiagnostics=decision.diagnostics;input=decision.input;
     if(decision.rescue){rescueFlightNpcAtRequiredGate(car,before);continue;}
    }
   }
   const effect=trackEffect(car,world.track,dt);
   input={...input};
   if(effect==='grease'){input.steer*=.27;input.throttle*=.65;}
   car.cameraYaw=(car.cameraYaw||0)-(input.cameraX||0)*Math.min(dt,.1)*2.4;
   car.cameraHeight=Math.max(-2.5,Math.min(5,(car.cameraHeight||0)+(input.cameraY||0)*Math.min(dt,.1)*5));
   car.input=input;
   if(input?.reset&&!car.isNpc){recoverCar(car,before,'manual');continue;}
   // btRaycastVehicle owns tire traction, suspension and yaw dynamics.
   // The older road probes are diagnostic only: never apply a second spring
   // or set rb.angularVelocity, and never snap wheels to manually sampled Y.
   if(car.spec.type==='KART'){
    const road=sampleRoadSupport(app.systems.rigidbody,car,pc.Vec3);
    car.roadNormal=road?.normal??null;
    car.roadGrade=road?.grade??0;
   }
   {
    // NPCs share the human boost cooldown and physical engine multiplier.
    // Air bots boost only when aligned with a distant required ring.
    const npcKartBoost=car.isNpc&&car.spec.type==='KART'&&car.npcDiagnostics?.phase==='FOLLOW'&&Math.abs(input.steer)<.15&&input.throttle>.72&&!car.npcDiagnostics?.avoidance;
    const boost=stepBoost(car.boost,!!(input.boost||npcKartBoost),dt);
    car.boost=boost.state;input.boostActive=boost.active||effect==='speed';
   }
   const gravityScale=Number($('gravity-scale').value);
   if(car.spec.type==='KART'){
    car.raycast.t.jumpSpeed=Number($('hop-speed').value)*(car.spec.jumpSpeed/5.5);
    car.gravityScale=gravityScale;
    driveRaycastVehicle(car,input,dt,pc);
   }else{
    // Shared hop slider controls the hovercraft impulse without mutating the
    // catalogue spec (shared between both players and future races).
    const hoverHopSpeed=Number($('hop-speed').value)*(car.spec.jumpSpeed/5.5);
    const flight=driveFlyingVehicle(car,input,dt,app.systems.rigidbody,pc,
     {gravityScale,competitive:mode!=='explore',hoverHopSpeed,raceSpeed:selectedRaceSpeed});
    if(flight.autoLeveled){const current=car.entity.getPosition();before[car.id]={x:current.x,y:current.y,z:current.z};Object.assign(car,physicsState(car.entity));}
   }

  }
  if(mode!=='explore'){
   const roadEvents=updateLaps(world,before);
   for(const event of roadEvents||[]){
    const driver=world.cars.find(c=>c.id===event.id);
    if(driver)announceGate(driver,'GATE',event.index+1,world.track.race.gates.length);
   }
   for(const car of world.cars){
    if(car.spec.type==='KART'||world.race.finished||!car.flightDiagnostics?.gateEligible)continue;
    const state=world.race.per[car.id],position=car.entity.getPosition();
    const result=advanceAirLap(state,before[car.id],position,airGates,world.race.lapsToWin);
    if(result.crossed){car.lastSafe={...airRespawn(airGates[state.lastGateIndex])};
     announceGate(car,'RING',state.lastGateIndex+1,airGates.length);}
    if(result.won){world.race.winner=car.id;world.race.finished=true;}
   }
  }
  // Invisible death volume: based on current track footprint AND the last
  // grounded height, so inclined tracks are not tied to world Y=-35.
  for(const car of world.cars){
   const pos=car.entity.getPosition();
   const onRoad=observeNpcSurface(app.systems.rigidbody,car,pc.Vec3);
   if(car.spec.type==='KART'&&onRoad.valid && (car.wheelDiagnostics?.probes??0)>=2){
    car.lastSafe={x:pos.x,z:pos.z,yaw:car.yaw,roadY:onRoad.height};
   }
   const zone=car.spec.type!=='KART'?{shouldRespawn:pos.y<(car.lastSafe?.roadY??0)-9 || pos.y< -200}:
    mode==='explore'? {shouldRespawn:!!car.lastSafe && pos.y<car.lastSafe.roadY-7}:
    deathZone(world.track,{x:pos.x,y:pos.y,z:pos.z},car.lastSafe);
   car.deathSeconds=zone.shouldRespawn?(car.deathSeconds||0)+Math.min(dt,.08):0;
   // Let a short jump/impact resolve physically before local respawn.
   if(car.deathSeconds>.65){
    if(car.isNpc&&car.spec.type!=='KART'){
     // Flying NPCs respawn at their LAST completed air ring, never at a
     // ground-only road probe. The teleport sample is excluded from laps.
     if(recoverCar(car,before,'npc-air-fall')){
      car.npcState=npcAirState();car.deathSeconds=0;
     }
    }else if(car.isNpc){
     // Kart NPC uses its dedicated, obstruction-aware road rescue logic.
     const recovered=rescueNpcToRoad(car,world.track,app.systems.rigidbody,pc.Vec3,world.cars.filter(other=>other!==car),car.npcState?.lastSafe,'off-track');
     if(recovered){resetRaycastVehicle(car);car.npcState=npcRacerState();car.npcState.lastSafe={...recovered};car.npcState.rescueCooldown=10;
      before[car.id]={x:recovered.x,z:recovered.z};car.deathSeconds=0;}
    }else recoverCar(car,before,'death-zone');
   }
  }
  if(world.race.finished)finishRace();
 }
 for(const car of world.cars)if(car.raycast)syncRaycastWheelVisuals(car,pc);
 updateCameras(cameras,world.cars,mode,dt);
 if(time-(update.lastHud||-10)>.13){update.lastHud=time;drawMap($('game-hud'),world.track,world.cars);
  const progress=Object.fromEntries(world.cars.map(c=>[c.id,raceProgress(world.race.per[c.id],c.spec.type==='KART'?world.track.race.gates.length:airGates.length,world.race.lapsToWin)]));
  const standings=racerResults(world.cars,world.race,c=>c.spec.type==='KART'?world.track.race.gates.length:airGates.length);
  for(const car of world.cars.filter(c=>!c.isNpc)){$(''+car.id+'-speed').textContent=`${Math.round(Math.hypot(car.vx,car.vz)*3.6)} km/h`;
   const id=car.id==='p1'?'p1-laps':'p2-laps';
   const lap=world.race.per[car.id];
   $(id).textContent=mode==='explore'?'FREE DRIVE · '+car.spec.label:
    (car.spec.type==='KART'?'Lap ':'Ring '+(lap.next+1)+'/'+airGates.length+' · Lap ')+`${lap.laps} / ${world.race.lapsToWin}`+(car.flightDiagnostics?.recovering?' · AUTO-LEVEL':'');
   $(car.id+'-boost').textContent=boostLabel(car.boost);
   $(car.id+'-place').textContent=String(standings.find(x=>x.id===car.id)?.place||1)+(standings.find(x=>x.id===car.id)?.place===1?'ST':standings.find(x=>x.id===car.id)?.place===2?'ND':standings.find(x=>x.id===car.id)?.place===3?'RD':'TH')+' / '+world.cars.length;
   const target=mode==='explore'?null:nextCheckpoint(world.track,airGates,car,lap);
   if(target?.kind==='ROAD'){
    // Road gates only export XY endpoints. Query Ammo for actual banked-road Y.
    const p=target.position;
    const hit=app.systems.rigidbody.raycastFirst(new pc.Vec3(p.x,p.y+90,p.z),new pc.Vec3(p.x,p.y-180,p.z),
     {filterCallback:e=>e?.tags?.has?.('lab5-drivable-road')});
    if(hit?.point?.y!==undefined)target.position.y=hit.point.y+.65;
   }
   routeMarkers?.update(car.id,target,target?.kind==='ROAD'?target.position.y-.65:undefined,time);
   const guide=target?waypointGuidance(car.entity.getPosition(),{
    x:-car.entity.forward.x,z:-car.entity.forward.z},target):null;
   $(car.id+'-target').textContent=target?`${target.kind==='AIR'?'RING':'GATE'} ${target.number} / ${target.count}`:'FREE DRIVE';
   $(car.id+'-direction').textContent=guide?`${guide.arrow} ${Math.round(guide.distance)} m  ·  ${guide.verticalHint}`:'Explore freely';
   $(car.id+'-progress-bar').style.width=`${Math.round((progress[car.id]||0)*100)}%`;
   $(car.id+'-progress').textContent=mode==='explore'?'NO CHECKPOINTS':
    `Lap ${Math.min(world.race.lapsToWin,lap.laps+1)} / ${world.race.lapsToWin} · ${Math.round(progress[car.id]*100)}% complete`;
   const rival=standings.find(c=>c.id!==car.id);
   $(car.id+'-rival').textContent=rival&&mode!=='explore'?`${rival.label} ${Math.round((progress[rival.id]||0)*100)}% · YOU ${Math.round(progress[car.id]*100)}%`:'';
   const notice=$(car.id+'-notice');if(notice)notice.hidden=!(notice.textContent&&time<(car.gateNoticeUntil||0));
  }
  if(!world.cars.some(c=>c.id==='p2'&&!c.isNpc))routeMarkers?.update('p2',null,undefined,time);
  $('mode-label').textContent=mode==='explore'?'FREE DRIVE · OPEN WORLD':`${mode==='solo'?'SOLO':mode==='online'?'ONLINE / AMMO':'LOCAL CO-OP'} · ${world.cars.length} RACERS`;
  $('gamepad-hint').textContent=controls.padNames.length?controls.padNames.length+' gamepad(s) detected':'ESC / START = PAUSE';
  $('debug-data').hidden=!showDebug;
  if(showDebug)$('debug-data').textContent=`Ammo btRaycastVehicle · mesh colliders: ${sceneData.meshes} · SOG: ${sceneData.sog?'ON':'OFF'} · contacts: ${contacts} · last: ${lastContact} · walls: ${wallMode} · props: ${props.length} · steering: native wheel physics\n`+world.cars.map(c=>`${c.id} x=${c.x.toFixed(2)} z=${c.z.toFixed(2)} speed=${(c.wheelDiagnostics?.speedKmh??0).toFixed(1)} km/h gas=${(c.input?.throttle||0).toFixed(1)} steer=${(c.input?.steer||0).toFixed(1)} wheelSteer=${(c.driverDiagnostics?.steeringRadians??0).toFixed(2)} heading=${c.entity.getEulerAngles().y.toFixed(1)} yawVel=${c.entity.rigidbody.angularVelocity.y.toFixed(2)} engine=${(c.driverDiagnostics?.engine??0).toFixed(0)} brake=${(c.driverDiagnostics?.brake??0).toFixed(1)} drift=${!!c.driftState?.active} wheels=${c.raycast?.vehicle?.getNumWheels?.()??0} pitch=${c.entity.getEulerAngles().x.toFixed(1)} roll=${c.entity.getEulerAngles().z.toFixed(1)} contact=${c.wheelDiagnostics?.probes??'?'} susp=${(c.wheelDiagnostics?.suspensionLength??0).toFixed(2)} vy=${c.entity.rigidbody.linearVelocity.y.toFixed(2)}`).join('\n')+(world.cars.some(c=>c.isNpc)?`\nNPC recovery: ${world.cars[1]?.npcDiagnostics?.phase||'FOLLOW'} · stuck ${Number(world.cars[1]?.npcDiagnostics?.stuck||0).toFixed(1)}s · offroad ${Number(world.cars[1]?.npcDiagnostics?.offroad||0).toFixed(1)}s · attempts ${world.cars[1]?.npcDiagnostics?.attempts||0} · avoid ${world.cars[1]?.npcDiagnostics?.avoidance||0} · bearing ${Number(world.cars[1]?.npcDiagnostics?.bearing||0).toFixed(2)}rad · target ${Number(world.cars[1]?.npcDiagnostics?.targetSpeed||0).toFixed(1)}m/s · lineErr ${Number(world.cars[1]?.npcDiagnostics?.nearest||0).toFixed(1)}m · trapped ${Number(world.cars[1]?.npcDiagnostics?.trappedFor||0).toFixed(1)}s · rescueCooldown ${Number(world.cars[1]?.npcDiagnostics?.respawnCooldown||0).toFixed(1)}s`:'');
 }
}

async function initialize(){
 try{
  ['solo-btn','local-btn','explore-btn'].forEach(id=>$(id).disabled=true);
  setStatus('Reading asset-pack.json and track.json…');
  const [pack,sourceTrack,alignment]=await Promise.all([json('assets/asset-pack.json'),json('assets/track.json'),json('assets/splat-alignment.json')]);
  console.info('[LAB5 SOG manifest]',{packId:pack.packId,sog:pack.splat?.sog??null,bytes:pack.splat?.sogBytes??null,sha256:pack.splat?.sogSha256??null,anchor:pack.splat?.anchorObject??null,hasAnchorMatrix:!!pack.splat?.anchorMatrixColumnMajor});
  // Blender-exported JSON is the portable fallback. An existing one-time browser
  // calibration is restored automatically on the same computer.
  calibration=validateAlignment(alignment);
  const track=validateTrack(sourceTrack),contract=checkRacePack(pack,track);
  track.spawns=ensureGridSpawns(track.spawns);
  catalog=vehicleCatalog(pack);
  airGates=validateAirGates(track.race.airGates?.length?track.race.airGates:legacyFlightGates(track));
  flightCourseReport=inspectFlightCourse(airGates,track.spawns);
  if(!flightCourseReport.ok)console.warn('[Splat Racers flight course preflight]',flightCourseReport.warnings);
  // All 3D assets authored in Blender in Y-up, +Z forward. No duplicate legacy geometry.
  setStatus('Initializing Ammo physics (WASM)…');
  // PlayCanvas WasmModule.getInstance callback is (instance), NOT (error, instance).
  // v1.7.0 incorrectly rejected the Ammo module itself, producing '[object Object]'.
  ammoInstance=await loadAmmoModule(pc.WasmModule,{
   glueUrl:new URL(base+'ammo/ammo.wasm.js',location.origin).href,
   wasmUrl:new URL(base+'ammo/ammo.wasm.wasm',location.origin).href,
   fallbackUrl:new URL(base+'ammo/ammo.js',location.origin).href
  });
  setStatus('Ammo loaded: native raycast-vehicle bindings found');
  app=new pc.Application(canvas,{graphicsDeviceOptions:{antialias:false,alpha:false}});
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.graphicsDevice.maxPixelRatio=Math.min(1.5,window.devicePixelRatio||1);
  app.systems.rigidbody.gravity=new pc.Vec3(0,-9.81,0);app.systems.rigidbody.fixedTimeStep=1/60;app.systems.rigidbody.maxSubSteps=5;
  app.scene.ambientLight=new pc.Color(.4,.44,.50);
  addLights(app,pack.lights||[]);cameras=addCameras(app);
 const graphics=$('graphics-quality');
 const updateGraphics=()=>{const setting=applyGraphicsConfiguration(app,pc,graphics.value,pack);
  $('graphics-current').textContent=`${app.graphicsDevice.deviceType||'WebGL'} · ${setting.shadowResolution}px shadows`;};
 graphics.addEventListener('change',updateGraphics);updateGraphics();
 try{await loadPrefilteredAtlas(app,base,pack);}catch(err){console.warn('[LAB5 environment atlas]',err);setStatus(err.message);}
  // PlayCanvas 2.23 installs Ammo's PhysicsWorld during app.start(), not
  // during app construction. Start in a paused state BEFORE creating any
  // mesh colliders or rigid bodies; otherwise collision.shape/body remain
  // empty and the road appears to have an invalid mesh.
  app.timeScale=0;
  app.start();
  // PlayCanvas first-person example uses the engine gsplat scene renderer.
  // Give the rasterizer a known budget; do not override the supported AUTO renderer.
  updateGraphics(); // Reapply splat budget after startup (the device may initialize the renderer lazily).
  requirePhysicsBackend(app);
  wallMode=chooseWallMode(location.search,track);
  geometry=await addPackGeometry(app,pack,track,base,setStatus,calibration,wallMode);
  props=await addDynamicObjects(app,pack,track,base,{enabled:new URLSearchParams(location.search).get('props')!=='off'});
  addFlightRingVisuals(app,airGates,!!track.race.airGateVisuals&&!!track.race.airGates?.length);
  routeMarkers=makeCheckpointMarkers(app);
  setStatus('Loading vehicle library textures and geometry…');
  vehicleAssets=await loadVehicleAssets(app,catalog,base,loadContainer);
  for(const id of ['p1-vehicle','p2-vehicle']){
   const select=$(id);select.replaceChildren();
   select.addEventListener('change',refreshNpcPreview);
   for(const spec of catalog){const option=document.createElement('option');option.value=spec.id;option.textContent=spec.label+' · '+spec.type;select.appendChild(option);}
  }
  if(new URLSearchParams(location.search).get('props')!=='off')props.push(...geometry.primitiveInfo.objects.filter(o=>o.bodyType==='dynamic'));
  sceneData={pack,track,meshes:geometry.staticInfo.count,sog:!!geometry.splat};
  const sogStatus=splatReadiness(pack,geometry.sogAsset);
  if(geometry.sogError)sogStatus.text='SOG: FAILED — '+geometry.sogError;
  $('sog-readiness').dataset.state=sogStatus.state;
  $('sog-readiness').textContent=sogStatus.text;
  if(geometry.sogError)sogStatus.state='failed';
  if(sogStatus.state==='missing')console.warn('[LAB5 SOG] No SOG configured in active pack',pack.packId);
  else if(sogStatus.state==='loaded')console.info('[LAB5 SOG] asset ready', {url:pack.splat.sog, version:pack.splat.sogSha256, resource:!!geometry.sogAsset?.resource});
  addFinishLineFallback(app,track,app.systems.rigidbody);
  controls=new Controls();attachTouch(controls,$('game-hud'),()=>['HOVER','DRONE'].includes(world?.cars.find(c=>c.id==='p1')?.spec.type));showEffects(app,pc,track);
  for(const event of ['gamepadconnected','gamepaddisconnected'])window.addEventListener(event,()=>{if(menuStage==='settings')stage('settings');});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){e.preventDefault();controls.keys.delete('Escape');backMenu();}});
  // The kart update is paused while the menu is displayed; this navigator
  // polls controllers independently of the PlayCanvas physics clock.
  menuNavigator=new GamepadMenuNavigator({
    getRoot:()=>!finish.hidden?finish:(!menu.hidden?menu:null),
    onPause:()=>{if(world&&!world.race.finished&&!paused&&!countdownActive)pause(true);},
    onBack:backMenu,
    getPads:()=>controls.getPads()
  });
  // Verify actual registered Ammo collisions, not only a GLB parse or component count.
  roadHits=testAmmoRoadAtSpawns(app.systems.rigidbody,track.spawns,pc.Vec3);
  // Extras are backward-compatible with two-spawn Blender exports; validate
  // their Ammo contact independently and relocate near the centreline if a
  // legacy scene's rear-row offset happens to fall outside the drivable mesh.
  for(const id of ['p3','p4']){
   const spawn=track.spawns[id];
   const from=new pc.Vec3(spawn.x,(spawn.y??0)+80,spawn.z),to=new pc.Vec3(spawn.x,(spawn.y??0)-120,spawn.z);
   const hit=app.systems.rigidbody.raycastFirst(from,to,{filterCallback:e=>e?.tags?.has?.('lab5-drivable-road')||/roadcollision|road:/i.test(e?.name||'')});
   if(hit?.point&&Number.isFinite(hit.point.y)&&hit.normal?.y>=.4){roadHits[id]={height:hit.point.y};continue;}
   const other=track.spawns[id==='p3'?'p1':'p2'];
   const safe=findRoadRespawn(track,app.systems.rigidbody,pc.Vec3,spawn,other,{...spawn,roadY:roadHits[id==='p3'?'p1':'p2'].height});
   if(safe){Object.assign(spawn,safe);roadHits[id]={height:safe.roadY};}
   else {roadHits[id]={height:spawn.y??0};console.warn('[LAB5 grid] No verified road under '+id+'. Move SPAWN_'+id.toUpperCase()+' onto the road in Blender and re-export.');}
  }
  setStatus('Road contact OK: '+Object.entries(roadHits).map(([id,v])=>id+' '+v.height.toFixed(2)+'m').join(', '));
  const hasRace=track.race.gates.length>=3&&track.race.waypoints.length>=8;
  $('solo-btn').disabled=!hasRace;$('local-btn').disabled=!hasRace;$('explore-btn').disabled=false;
  $('solo-btn').addEventListener('click',()=>newMode('solo'));
  $('local-btn').addEventListener('click',()=>newMode('local'));
  $('setup-back-btn').addEventListener('click',()=>stage('home'));
  $('setup-next-btn').addEventListener('click',()=>stage('vehicles'));
  $('vehicles-back-btn').addEventListener('click',()=>stage('setup'));
  $('start-race-btn').addEventListener('click',()=>start(pendingMode));
  $('explore-btn').addEventListener('click',()=>{pendingMode='explore';stage('vehicles');});
  $('open-settings-btn').addEventListener('click',()=>{settingsReturn='home';stage('settings');});
  $('pause-settings-btn').addEventListener('click',()=>{settingsReturn='pause';stage('settings');});
  $('settings-back-btn').addEventListener('click',()=>stage(settingsReturn));
  $('touch-recover').onclick=()=>{const car=world?.cars.find(c=>c.id==='p1');if(car){recoverCar(car,{},'manual');pause(false);}};
  $('resume-btn').addEventListener('click',()=>pause(false));
  $('pause-btn').addEventListener('click',()=>pause(true));
  $('restart-btn').addEventListener('click',()=>start(mode||'solo'));
  $('pause-new-race-btn').addEventListener('click',()=>{stopAndClearRace();stage('home');});
  $('play-again-btn').addEventListener('click',()=>start(mode||'solo'));
  $('win-menu-btn').addEventListener('click',()=>{stopAndClearRace();stage('home');});
  $('debug-btn').addEventListener('click',()=>{showDebug=!showDebug;$('debug-data').hidden=!showDebug;});
  $('ai-difficulty').addEventListener('change',()=>{difficulty=$('ai-difficulty').value;});
  for(const field of ['gravity-scale','hop-speed']){
   const slider=$(field),readout=$(field+'-value');
   const refresh=()=>{readout.textContent=Number(slider.value).toFixed(2)+(field==='gravity-scale'?'×':' m/s');};
   slider.addEventListener('input',refresh);refresh();
  }
  $('race-laps').addEventListener('change',()=>{selectedLaps=configuredRaceTarget($('race-laps').value);});
  $('error-restart').addEventListener('click',()=>location.reload());
  window.addEventListener('resize',()=>app.resizeCanvas());
  app.on('update',dt=>{try{update(dt);}catch(e){app.timeScale=0;error(e);}});
  app.timeScale=0;
  setStatus(`Ready: ${pack.packId} · vehicle choices: ${catalog.length} · air rings: ${airGates.length} · terrain meshes: ${geometry.staticInfo.count} · primitive colliders: ${geometry.primitiveInfo.count} · walls: ${wallMode} (${geometry.wallInfo.count} boxes) · SOG: ${geometry.splat?'loaded':'not configured'}.${flightCourseReport.ok?'':` FLIGHT ROUTE WARNING: ${flightCourseReport.warnings[0]}`} Select a mode.`);
  setMenu();
  if(new URLSearchParams(location.search).has('online-host')){
   const [{createAmmoHostAdapter},{mountAmmoHostUI}]=await Promise.all([import('../network/ammo-host.js'),import('../network/ammo-host-ui.js')]);
   onlineAdapter=createAmmoHostAdapter({
    getWorld:()=>world,
    startRace:()=>start('online'),
    backToLobby:()=>{stopAndClearRace();stage('home');}
   });
   mountAmmoHostUI(onlineAdapter,track);
  }
  const alignmentIds=['sog-x','sog-y','sog-z','sog-rx','sog-ry','sog-rz','sog-scale'];
  const readCalibration=()=>validateAlignment({position:alignmentIds.slice(0,3).map(id=>Number($(id).value)),rotationEuler:alignmentIds.slice(3,6).map(id=>Number($(id).value)),scale:Number($('sog-scale').value)});
  if(geometry.splatGroup){
    const startValues=[...calibration.position,...calibration.rotationEuler,calibration.scale];
    alignmentIds.forEach((id,i)=>{$(id).value=String(startValues[i]);$(id).addEventListener('input',()=>{try{const next=readCalibration();setSplatCalibration(geometry.splatGroup,next);calibration=next;}catch(err){setStatus(err.message);}});});
    $('align-btn').hidden=!new URLSearchParams(location.search).has('calibrate');
    $('align-btn').addEventListener('click',()=>{$('sog-align-panel').hidden=!$('sog-align-panel').hidden;});
    $('close-align').addEventListener('click',()=>{$('sog-align-panel').hidden=true;});
    $('reset-align').addEventListener('click',()=>{
      clearStoredCalibration(pack);
      const identity={position:[0,0,0],rotationEuler:[0,0,0],scale:1};
      calibration=identity;setSplatCalibration(geometry.splatGroup,identity);
      const values=[0,0,0,0,0,0,1];alignmentIds.forEach((id,i)=>{$(id).value=String(values[i]);});
      setStatus('Browser fine alignment cleared. Blender SOG_PLACEMENT is still applied.');
    });
    $('save-align').addEventListener('click',()=>{
      let value;try{value=JSON.stringify({...readCalibration(),note:'Relative to Blender anchor; visual SOG only'},null,2);}catch(e){setStatus(e.message);return;}
      if(navigator.clipboard?.writeText){navigator.clipboard.writeText(value).then(()=>setStatus('Preview copied. Save as assets/splat-alignment.json to publish for every racer.')).catch(()=>window.prompt('Copy alignment JSON:',value));}
      else window.prompt('Copy alignment JSON:',value);
    });
  }
  window.__LAB5_RACE_V14={status:()=>({pack:pack.packId,colliders:geometry.staticInfo.count,primitiveColliders:geometry.primitiveInfo.count,wallMode,wallBoxes:geometry.wallInfo.count,lastContact,props:props.length,sog:!!geometry.splat,sogReadiness:splatReadiness(pack,geometry.sogAsset),sogInfo:{url:pack.splat?.sog??null,bytes:pack.splat?.sogBytes??null,sha256:pack.splat?.sogSha256??null,anchor:pack.splat?.anchorObject??null,calibration},mode,paused,menuStage,roster:world?.roster||[],vehicleCatalog:catalog.map(v=>({id:v.id,type:v.type})),airGateCount:airGates.length,flightCourseWarnings:flightCourseReport.warnings,npcStatus:world?.cars.filter(c=>c.isNpc).map(c=>({id:c.id,type:c.spec.type,gate:world.race.per[c.id].next,phase:c.npcDiagnostics?.phase,secondsOnGate:c.npcDiagnostics?.gateTime,targetSpeed:c.npcDiagnostics?.targetSpeed,altitudeTarget:c.npcDiagnostics?.altitudeTarget,stuck:c.npcDiagnostics?.stuck,reapproaches:c.npcDiagnostics?.reapproaches,rescues:c.npcDiagnostics?.rescues}))||[],raceSpeedMultiplier:selectedRaceSpeed,gravityScale:Number($('gravity-scale').value),hopSpeed:Number($('hop-speed').value),checkpoints:world?.cars.map(c=>({id:c.id,type:c.spec.type,next:world.race.per[c.id].next,laps:world.race.per[c.id].laps,progress:raceProgress(world.race.per[c.id],c.spec.type==='KART'?world.track.race.gates.length:airGates.length,world.race.lapsToWin),hoverTarget:c.hoverWorldTarget,hopCooldown:c.hoverHopCooldown}))||[],carPositions:world?.cars.map(c=>({id:c.id,type:c.spec.type,x:c.x,z:c.z,y:c.entity.getPosition().y,vY:c.entity.rigidbody.linearVelocity.y,pitch:c.entity.getEulerAngles().x,roll:c.entity.getEulerAngles().z,roadNormal:c.roadNormal,wheelHits:c.wheelDiagnostics?.probes}))||[]})};
 }catch(e){error(e);}
}
initialize();
