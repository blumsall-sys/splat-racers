import Peer from 'peerjs';
import {createNetworkRoadSurface} from './road-surface.js';
import {makeLanState,joinLan,leaveLan,setLanVehicle,setLanReady,sendLanInput,startLanRace,resetLanLobby,stepLan,lanSnapshot} from './host-core.js';

function waitFor(emitter,event){
 return new Promise((resolve,reject)=>{
  const finish=(fn,value)=>{clearTimeout(timer);emitter.off(event,ok);emitter.off('error',fail);fn(value);};
  const ok=value=>finish(resolve,value),fail=err=>finish(reject,err);
  const timer=setTimeout(()=>fail(Error('Connection timed out. Check the code and keep the host tab open.')),20000);
  emitter.once(event,ok);emitter.once('error',fail);
 });
}
export async function openRoom(code,track,onSnapshot,onClose,{peerFactory=(id)=>new Peer(id,{secure:true}),requestTimeoutMs=10000,surface=null}={}){
 const hosting=!code;
 code=code||crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase();
 if(!/^[A-F0-9]{10}$/.test(code))throw Error('Enter the 10-character room code.');
 const id='splat-racers-room-'+code;
 const peer=peerFactory(hosting?id:undefined);
 const room=hosting?makeLanState(track,{surface:surface||createNetworkRoadSurface(track)}):null;
 const local={},guests=new Map(),pending=new Map();
 let channel,timer,serial=0,closed=false;
 function close(message){
  if(closed)return;closed=true;clearInterval(timer);
  for(const job of pending.values())job.reject(Error(message));
  pending.clear();peer.destroy();if(message)onClose(message);
 }
 function execute(member,action,data){
  if(action==='join'){
   if(member.token)throw Error('Already joined');
   const player=joinLan(room,data.name);member.token=player.token;
   return {id:player.id,token:player.id};
  }
  if(!member.token)throw Error('Join the room first');
  const t=member.token;
  const commands={vehicle:()=>setLanVehicle(room,t,data.vehicle),ready:()=>setLanReady(room,t,data.ready),
   input:()=>sendLanInput(room,t,data),start:()=>startLanRace(room,t,data),reset:()=>resetLanLobby(room,t)};
  if(!Object.hasOwn(commands,action)||commands[action]()===false)throw Error('Action unavailable');
  return {};
 }
 try{
  await waitFor(peer,'open');
  if(hosting){
   peer.on('connection',conn=>{
    if(guests.size>=3){conn.on('open',()=>{conn.send({error:'Room full'});setTimeout(()=>conn.close(),250);});return;}
    const member={};guests.set(conn,member);
    conn.on('data',msg=>{
     try{const result=execute(member,msg.action,msg.data||{});if(msg.seq)conn.send({seq:msg.seq,result});}
     catch(err){if(msg?.seq)conn.send({seq:msg.seq,error:err.message});}
    });
    const remove=()=>{if(!guests.has(conn))return;guests.delete(conn);if(member.token)leaveLan(room,member.token);};
    conn.on('close',remove);conn.on('error',remove);
   });
   let frame=0;
   timer=setInterval(()=>{stepLan(room);if(++frame%4===0){const snapshot=lanSnapshot(room);onSnapshot(snapshot);
    for(const [conn,member] of guests)if(conn.open&&member.token)conn.send({snapshot});}},1000/60);
  }else{
   channel=peer.connect(id,{reliable:true});const opened=waitFor(channel,'open');
   await Promise.race([opened,new Promise((_,reject)=>peer.once('error',reject))]);
   channel.on('close',()=>close('Host disconnected. Open Online to join a new room.'));
   channel.on('error',err=>close('Connection error: '+(err?.message||err)));
   peer.on('error',err=>close('Signaling error: '+(err?.message||err)));
   channel.on('data',msg=>{
    if(!msg||typeof msg!=='object')return;
    if(msg.snapshot){onSnapshot(msg.snapshot);return;}
    const job=pending.get(msg.seq);
    if(job){pending.delete(msg.seq);if(msg.error)job.reject(Error(msg.error));else job.resolve(msg.result);}
    else if(msg.error)close(msg.error);
   });
  }
 }catch(err){close('');throw err;}
 if(typeof window!=='undefined')window.addEventListener('pagehide',()=>close(''),{once:true});
 return {code,close,async call(action,data){
  if(closed)throw Error('Room closed');
  if(hosting)return execute(local,action,data);
  if(action==='input'){channel.send({action,data});return {};}
  const seq=++serial;
  return new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{pending.delete(seq);reject(Error('Host did not respond. Check the connection and try again.'));},requestTimeoutMs);
   const finish={resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}};
   pending.set(seq,finish);
   try{channel.send({action,data,seq});}catch(error){pending.delete(seq);finish.reject(error);}
  });
 }};
}
