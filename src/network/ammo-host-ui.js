/**
 * Small host-only lobby for the existing native PlayCanvas/Ammo race.
 * This module does NOT create any physics world or render a substitute car.
 */
import {openRoom} from './online-room.js';

export function mountAmmoHostUI(adapter,track){
 const wrap=document.createElement('section');
 wrap.setAttribute('aria-label','Native Ammo online host');
 wrap.style.cssText='position:fixed;top:56px;left:18px;width:min(430px,calc(100vw - 36px));max-height:83vh;overflow:auto;z-index:9999;background:#102e3af5;color:#ecf3e9;border:1px solid #7aa8ac;padding:20px;border-radius:15px;box-shadow:0 20px 60px #021b20d9;font:14px/1.5 system-ui';
 wrap.innerHTML=`<h2 style="margin:0 0 5px">ONLINE · NATIVE AMMO HOST</h2>
 <p style="margin:0 0 12px">Road colliders, native raycast karts, physics and NPCs are the same as local racing.</p>
 <label>Racer name <input id="ammo-online-name" maxlength="24" value="Host"></label>
 <button id="ammo-online-create">CREATE ROOM</button>
 <div id="ammo-online-connected" hidden>
 <p>Invite URL <input id="ammo-online-invite" readonly style="width:100%"></p>
 <button id="ammo-online-copy">COPY INVITE</button>
 <p id="ammo-online-roster">Players connecting…</p>
 <label>Vehicle <select id="ammo-online-vehicle"><option value="KART">Kart</option><option value="HOVER">Hovercraft</option><option value="DRONE">Drone</option></select></label>
 <label>NPCs <select id="ammo-online-npcs"><option value="0">None</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
 <label>Laps <select id="ammo-online-laps"><option value="1">1</option><option value="3" selected>3</option><option value="5">5</option></select></label>
 <label>Speed <select id="ammo-online-pace"><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="2.5">2.5×</option></select></label>
 <label>NPC skill <select id="ammo-online-difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></label>
 <p><button id="ammo-online-ready">READY</button>
 <button id="ammo-online-start">START RACE</button>
 <button id="ammo-online-reset" hidden>BACK TO LOBBY</button></p>
 </div>
 <p id="ammo-online-status" role="status">Create a room to invite players.</p>
 <a style="color:#c7ec98" href="./">Return to local racing</a>`;
 const style=document.createElement('style');
 style.textContent='#ammo-online-host button{padding:10px 12px;margin:4px;background:#bce95b;color:#18342c;border:0;border-radius:7px;font-weight:bold;cursor:pointer}#ammo-online-host input,#ammo-online-host select{background:#173744;color:white;border:1px solid #7a9fa8;padding:7px;border-radius:5px}#ammo-online-host label{display:flex;justify-content:space-between;align-items:center;margin:7px 0}#ammo-online-host label input,#ammo-online-host label select{width:55%}';
 wrap.id='ammo-online-host';document.body.append(style,wrap);
 const $=name=>wrap.querySelector('#ammo-online-'+name);
 let room=null,ready=false,joined=false;
 function report(msg){$('status').textContent=String(msg);}
 function render(snapshot){
  if(!snapshot)return;
  const phase=snapshot.phase,results=phase==='results',playing=phase==='race'||phase==='countdown';
  wrap.hidden=playing;
  $('reset').hidden=!results;
  $('start').hidden=results;
  $('ready').hidden=results;
  if(phase==='lobby'){
   $('roster').textContent=snapshot.racers.map(p=>p.id.toUpperCase()+' '+p.label+' · '+(p.ready?'READY':'WAITING')+' · '+p.vehicle).join(' | ');
   const humans=snapshot.racers.length;
   for(const option of $('npcs').options)option.disabled=+option.value>4-humans;
   if(+$('npcs').value>4-humans)$('npcs').value=String(4-humans);
   const me=snapshot.racers.find(p=>p.id==='p1');
   if(me){ready=me.ready;$('ready').textContent=ready?'CANCEL READY':'READY';}
  }else if(results){report('RACE COMPLETE · '+(snapshot.winner||'unknown')+' wins. Return everyone to the lobby.');}
 }
 $('create').onclick=async()=>{
  try{
   if(room)return;
   $('create').disabled=true;report('Registering native Ammo room…');
   room=await openRoom('',track,render,msg=>report(msg),{hostAdapter:adapter});
   await room.call('join',{name:$('name').value});
   joined=true;
   const url=new URL('./LAN.html',location.href);url.searchParams.set('room',room.code);
   $('invite').value=url.href;
   $('connected').hidden=false;$('create').hidden=true;
   report('Host ready. Send the invite link and choose your vehicle.');
  }catch(err){room?.close();room=null;$('create').disabled=false;report('Room error: '+(err?.message||err));}
 };
 $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('invite').value);report('Invite copied.');}catch{ $('invite').select();report('Select and copy the invite URL.');}};
 $('vehicle').onchange=async()=>{try{await room.call('vehicle',{vehicle:$('vehicle').value});ready=false;}catch(err){report(err.message);}};
 $('ready').onclick=async()=>{try{await room.call('ready',{ready:!ready});ready=!ready;}catch(err){report(err.message);}};
 $('start').onclick=async()=>{try{
  await room.call('start',{npcCount:+$('npcs').value,laps:+$('laps').value,pace:+$('pace').value,difficulty:$('difficulty').value});
  report('Starting native Ammo race.');
 }catch(err){report('Start failed: '+err.message);}};
 $('reset').onclick=async()=>{try{await room.call('reset',{});report('Back in lobby. Everyone must ready again.');}catch(err){report(err.message);}};
}
