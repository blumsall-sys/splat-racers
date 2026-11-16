/** Browser LAN viewer: network snapshots own race transforms, PlayCanvas
 * owns rendering (including Blender-authored GLBs and optional Gaussian SOG).
 * Client does not run competing physics or accept client-authored lap counts.
 */
import {drawMap,attachTouch,showEffects} from '../race/race-overlay.js';
import * as pc from 'playcanvas';
import {Controls} from '../input/controls.js';
import {addLights,loadContainer,setSplatCalibration} from '../v14/pc-scene.js';
import {refineImportedMaterials} from '../assets/playcanvas-materials.js';
import {loadSogAsset,versionedSogUrl} from '../v14/sog-loader.js';
import {applySogAnchorTransform} from '../v14/sog-transform.js';
import {vehicleCatalog} from '../vehicles/library.js';
const $=id=>document.getElementById(id);
const canvas=$('lan-viewport'),app=new pc.Application(canvas,{graphicsDeviceOptions:{antialias:true}});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);app.setCanvasResolution(pc.RESOLUTION_AUTO);app.graphicsDevice.maxPixelRatio=Math.min(1.5,window.devicePixelRatio||1);
app.scene.ambientLight=new pc.Color(.4,.5,.59);app.start();
addLights(app,[]);
const camera=new pc.Entity('LAN chase camera');camera.addComponent('camera',{clearColor:new pc.Color(.08,.16,.21),farClip:5000,fov:65});app.root.addChild(camera);
const keys=new Controls(),cars=new Map(),snapshots=new Map();let lastData=null,token=null,playerId=null,stream=null,seq=1,ready=false,track=null,pack=null,vehicleSpecs=[];
const params=new URLSearchParams(location.search),online=params.has('online')||params.has('room');
let transport;
if(online){
 document.title='Splat Racers · Online';
 document.querySelector('.topbar span').textContent='ONLINE';
 document.querySelector('#lan-lobby h1').textContent='Online rooms';
 document.querySelector('#lan-lobby p').textContent='Create a room or enter an invite code. Up to four racers. The host keeps this tab open.';
 $('lan-message').textContent='Enter a code from your host or create a room.';
 document.querySelector('#lan-lobby .small').textContent='The host runs the race in their browser. Keep the game open while racing.';
 $('online-actions').hidden=false;$('room-code').value=params.get('room')||'';
 $('create-room').onclick=()=>enter(true);
 $('share-room').onclick=async()=>{const url=$('invite-url').value;try{
 if(navigator.share)await navigator.share({title:'Race with me in Splat Racers',url});
 else {await navigator.clipboard.writeText(url);$('lan-message').textContent='Invite link copied.';}
 }catch{ $('invite-url').select(); }};
}
const palette=[[.63,.89,.35],[.98,.52,.39],[.51,.76,.99],[.95,.78,.42]];
function material(color){const m=new pc.StandardMaterial();m.diffuse=new pc.Color(...color);m.metalness=.18;m.gloss=.47;m.update();return m;}
function box(parent,name,scale,offset,mat){const e=new pc.Entity(name);e.addComponent('render',{type:'box',material:mat,castShadows:true});e.setLocalScale(...scale);e.setLocalPosition(...offset);parent.addChild(e);return e;}
async function loadScene(){
 try{
  [pack,track]=await Promise.all([fetch('./assets/asset-pack.json').then(r=>r.json()),fetch('./assets/track.json').then(r=>r.json())]);
  vehicleSpecs=vehicleCatalog(pack);attachTouch(keys,$('lan-hud'),()=>['HOVER','DRONE'].includes(snapshots.get(playerId)?.vehicle));showEffects(app,pc,track);
  if(pack.visualGlb){
   const asset=await loadContainer(app,'./assets/'+pack.visualGlb);
   const render=asset.resource.instantiateRenderEntity({castShadows:true});app.root.addChild(render);
   refineImportedMaterials(render,pack.materialOverrides||{},pc);
  }else{
   const pts=track.race.waypoints||[];
   for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length],len=Math.hypot(a.x-b.x,a.z-b.z);
    const e=box(app.root,'Road reference strip',[track.race.roadWidth||5,.14,len],[(a.x+b.x)/2,-.12,(a.z+b.z)/2],material([.29,.31,.34]));
    e.setEulerAngles(0,Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI,0);
   }
  }
  if(pack.splat?.sog){try{
   const url=versionedSogUrl(new URL('./assets/'+pack.splat.sog,location.href).href,pack);
   const asset=await loadSogAsset(app,pc,url);
   const group=new pc.Entity('Pack alignment');app.root.addChild(group);
   setSplatCalibration(group,await fetch('./assets/splat-alignment.json').then(r=>r.json()));
   const e=new pc.Entity('LAN SOG');group.addChild(e);e.addComponent('gsplat',{asset});applySogAnchorTransform(e,pack.splat.anchorMatrixColumnMajor,pc);
  }catch(err){console.warn('LAN SOG not available; track remains visible',err);}}
  $('lan-message').textContent='Scene loaded. Join the room to race.';
 }catch(err){console.error(err);$('lan-message').textContent='Scene loading: '+err.message;}
}
function makeRacer(data){
 const root=new pc.Entity('LAN '+data.id);app.root.addChild(root);
 const color=palette[Math.max(0,['p1','p2','p3','p4'].indexOf(data.id))];
 const kind=data.vehicle;
 const mat=material(color);
 box(root,kind+' body',kind==='DRONE'?[1.15,.36,1.2]:kind==='HOVER'?[1.7,.40,2.25]:[1.4,.55,1.8],[0,.1,0],mat);
 if(kind==='KART')for(const x of [-.75,.75])for(const z of [-.67,.67])box(root,'Wheel',[.3,.49,.51],[x,-.3,z],material([.07,.085,.09]));
 if(kind==='DRONE')for(const x of [-.68,.68])for(const z of [-.68,.68]){
  const arm=box(root,'Rotor arm',[.9,.07,.12],[x/2,.1,z/2],mat);arm.setLocalEulerAngles(0,45*Math.sign(x*z),0);
  box(root,'Rotor',[.45,.055,.45],[x,.12,z],material([.12,.14,.15]));
 }
 return {root,kind,position:{x:data.x,y:data.y,z:data.z},yaw:data.yaw};
}
function lerpAngle(a,b,t){return a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;}
function onSnapshot(data){
 if(!data||!Array.isArray(data.racers))return;
 lastData=data;if(track)drawMap($('lan-hud'),track,data.racers);
 snapshots.clear();
 $('lan-connection').textContent=`CONNECTED · ${data.racers.length}/4 RACERS · ${data.phase.toUpperCase()}`;
 $('lan-roster').replaceChildren(...data.racers.map(p=>{
  const el=document.createElement('div');el.textContent=`${p.id.toUpperCase()}  ${p.label}  ${p.vehicle}  ${p.isNpc?'NPC':p.ready?'READY':'WAITING'}`;return el;}));
 for(const p of data.racers){
  let v=cars.get(p.id);
  if(!v||v.kind!==p.vehicle){v?.root.destroy();v=makeRacer(p);cars.set(p.id,v);}
  snapshots.set(p.id,p);
 }
 for(const [id,v] of cars)if(!snapshots.has(id)){v.root.destroy();cars.delete(id);}
 const racing=['countdown','race','results'].includes(data.phase);
 $('lan-lobby').hidden=racing;$('lan-hud').hidden=!racing;
 $('lan-countdown').hidden=data.phase!=='countdown';
 if(data.phase==='countdown')$('lan-countdown').textContent=String(Math.max(1,Math.ceil(data.countdownMs/1000)));
 $('lan-results').hidden=data.phase!=='results';
 if(data.phase==='results'){
  $('lan-back').hidden=playerId!=='p1';
  const champion=data.racers.find(p=>p.id===data.winner);
  $('lan-winner').textContent=(champion?.label||data.winner||'UNKNOWN').toUpperCase()+' WINS!';
  $('lan-standings').replaceChildren(...data.standings.map(p=>{const e=document.createElement('div');e.textContent=`${p.place}. ${p.label} — ${p.laps} laps`;return e;}));
 }
 if(data.phase==='lobby'){
  $('lan-after-join').hidden=!token;
  const humanCount=data.racers.filter(p=>!p.isNpc&&!p.disconnected).length;
  const availableNpcSlots=Math.max(0,4-humanCount);
  for(const option of $('lan-npcs').options)option.disabled=Number(option.value)>availableNpcSlots;
  if(Number($('lan-npcs').value)>availableNpcSlots)$('lan-npcs').value=String(availableNpcSlots);
 }
 const self=data.racers.find(p=>p.id===playerId);
 if(self){
  if(data.phase==='lobby'){ready=self.ready;$('lan-ready').textContent=ready?'CANCEL READY':'READY';}
  $('lan-speed').textContent=Math.round(Math.abs(self.speed)*3.6)+' km/h';
  $('lan-progress').textContent=`Lap ${self.laps} / ${data.settings.laps}`;
  $('lan-next').textContent=`Next checkpoint ${self.next+1}`;
  $('lan-rank').textContent='Position '+(data.standings.find(p=>p.id===self.id)?.place||'—');
 }
}
async function call(endpoint,payload){if(online)return transport.call(endpoint,payload);const r=await fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||'Action denied');return d;}
function report(err){$('lan-message').textContent='Error: '+err.message;}
$('lan-join').onclick=()=>enter(false);
async function enter(create){try{
 if(online){
  if(!track)throw Error('Track is loading. Try again shortly.');
  const code=$('room-code').value.trim().toUpperCase();
  if(!create&&!code)throw Error('Enter a room code or choose Create room.');
  $('lan-join').disabled=$('create-room').disabled=true;$('lan-message').textContent='Connecting…';
  const {openRoom}=await import('./online-room.js');
  let surface=null;
  if(create){
   $('lan-message').textContent='Loading Blender road collision for network host…';
   const {createNetworkRoadSurface}=await import('./road-surface.js');
   try{
    if(!pack?.staticCollisionGlb)throw Error('No collision GLB configured');
    const url=new URL('./assets/'+pack.staticCollisionGlb,location.href);
    const response=await fetch(url);
    if(!response.ok)throw Error('Road collision HTTP '+response.status);
    surface=createNetworkRoadSurface(track,await response.arrayBuffer());
    console.info('[Splat Racers online] Road surface ready:',surface.source,surface.triangles,'triangles');
   }catch(err){
    console.warn('[Splat Racers online] Collision mesh unavailable; using Blender navigation road height',err);
    surface=createNetworkRoadSurface(track);
   }
  }
  transport=await openRoom(create?'':code,track,onSnapshot,msg=>{token=null;$('lan-lobby').hidden=false;$('lan-hud').hidden=true;$('lan-results').hidden=true;$('lan-countdown').hidden=true;$('lan-message').textContent=msg;$('lan-after-join').hidden=true;$('lan-join').disabled=$('create-room').disabled=false;},{surface});
 }

 const d=await call('join',{name:$('lan-name').value});token=d.token;playerId=d.id;
 $('lan-after-join').hidden=false;$('lan-player-id').textContent=`YOU ARE ${d.id.toUpperCase()}`;
 $('lan-host-settings').hidden=d.id!=='p1';$('lan-join').disabled=true;
 if(online){const url=new URL(location.href);url.search='';url.searchParams.set('room',transport.code);
 $('invite-url').value=url.href;$('active-code').textContent=transport.code;$('invite-tools').hidden=false;
 $('lan-message').textContent='Choose a vehicle and mark yourself ready.';return;}
 stream?.close();stream=new EventSource('/api/events?token='+encodeURIComponent(token));
 stream.addEventListener('snapshot',e=>onSnapshot(JSON.parse(e.data)));
 stream.onerror=()=>{$('lan-connection').textContent='RECONNECTING…';};
 }catch(err){if(online){transport?.close('');$('lan-join').disabled=$('create-room').disabled=false;}report(err);}}
$('lan-vehicle').onchange=async()=>{try{await call('vehicle',{token,vehicle:$('lan-vehicle').value});ready=false;$('lan-ready').textContent='READY';}catch(err){report(err);}};
$('lan-ready').onclick=async()=>{try{const desired=!ready;await call('ready',{token,ready:desired});ready=desired;$('lan-ready').textContent=ready?'CANCEL READY':'READY';}catch(err){report(err);}};
$('lan-start').onclick=async()=>{try{await call('start',{token,npcCount:+$('lan-npcs').value,laps:+$('lan-laps').value,pace:+$('lan-pace').value,difficulty:$('lan-skill').value});}catch(err){report(err);}};
$('lan-back').onclick=async()=>{try{await call('reset',{token});}catch(err){report(err);}};
// Input samples are untrusted requests, never positions or lap counters.
setInterval(()=>{if(!token||lastData?.phase!=='race')return;
 const c=keys.sample().p1;
 call('input',{token,seq:seq++,throttle:c.throttle,steer:c.steer,ascend:c.drift,descend:c.descend,boost:c.boost}).catch(()=>{});
},33);
app.on('update',dt=>{
 const blend=Math.min(1,dt*13);
 for(const [id,v] of cars){const p=snapshots.get(id);if(!p)continue;
  v.position.x+=(p.x-v.position.x)*blend;v.position.y+=(p.y-v.position.y)*blend;v.position.z+=(p.z-v.position.z)*blend;
  // Host snapshot Y is the chassis world-space height (including road clearance).
  // The old extra +0.95 offset masked flat-ground errors and disconnected wheels.
  v.yaw=lerpAngle(v.yaw,p.yaw,blend);v.root.setPosition(v.position.x,v.position.y,v.position.z);v.root.setEulerAngles(0,v.yaw*180/Math.PI,0);
 }
 const target=cars.get(playerId);
 if(target){const f={x:Math.sin(target.yaw),z:Math.cos(target.yaw)};
  const desired=new pc.Vec3(target.position.x-f.x*8,target.position.y+6.1,target.position.z-f.z*8);
  const current=camera.getPosition().clone();current.lerp(current,desired,Math.min(1,dt*4));camera.setPosition(current);
  camera.lookAt(target.position.x,target.position.y+1,target.position.z);
 }else{camera.setPosition(10,25,22);camera.lookAt(0,0,0);}
});
window.addEventListener('resize',()=>app.resizeCanvas());
loadScene();
