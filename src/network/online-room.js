/**
 * PeerJS room transport ONLY. No game physics, collision approximation or
 * client-owned poses. The host must provide the live local Ammo race adapter.
 */
import Peer from 'peerjs';

function waitFor(emitter,event,timeoutMs=20000){
 return new Promise((resolve,reject)=>{
  const finish=(fn,value)=>{clearTimeout(timer);emitter.off(event,ok);emitter.off('error',fail);fn(value);};
  const ok=value=>finish(resolve,value),fail=err=>finish(reject,err);
  const timer=setTimeout(()=>finish(reject,Error('Connection timed out. Check room code and host tab.')),timeoutMs);
  emitter.once(event,ok);emitter.once('error',fail);
 });
}
export async function openRoom(code,track,onSnapshot=()=>{},onClose=()=>{},
 {peerFactory=id=>new Peer(id,{secure:true}),requestTimeoutMs=10000,hostAdapter=null}={}){
 const hosting=!code;
 if(hosting&&!hostAdapter)throw Error('Online hosting requires the running PlayCanvas/Ammo race. Open the native host page.');
 code=code||crypto.randomUUID().replaceAll('-','').slice(0,10).toUpperCase();
 if(!/^[A-F0-9]{10}$/.test(code))throw Error('Enter the 10-character room code.');
 const peer=peerFactory(hosting?'splat-racers-room-'+code:undefined);
 const local={},guests=new Map(),pending=new Map();
 let channel,timer,serial=0,closed=false;
 function close(message=''){
  if(closed)return;closed=true;clearInterval(timer);
  for(const job of pending.values())job.reject(Error(message||'Room closed'));
  pending.clear();
  for(const conn of guests.keys())conn.close();
  peer.destroy();if(message)onClose(message);
 }
 function execute(member,action,data={}){
  return hostAdapter.execute(member,action,data);
 }
 try{
  await waitFor(peer,'open');
  if(hosting){
   peer.on('connection',conn=>{
    if(guests.size>=3){conn.on('open',()=>{conn.send({error:'Room full'});conn.close();});return;}
    const member={};guests.set(conn,member);
    conn.on('data',msg=>{
     if(!msg||typeof msg!=='object'||typeof msg.action!=='string')return;
     try{
      const result=execute(member,msg.action,msg.data||{});
      if(msg.seq)conn.send({seq:msg.seq,result});
     }catch(err){if(msg.seq)conn.send({seq:msg.seq,error:String(err.message||err)});}
    });
    const leave=()=>{if(!guests.has(conn))return;guests.delete(conn);hostAdapter.leave(member);};
    conn.on('close',leave);conn.on('error',leave);
   });
   timer=setInterval(()=>{
    if(closed)return;
    const snapshot=hostAdapter.snapshot();
    if(!snapshot)return;
    onSnapshot(snapshot);
    for(const [conn,member] of guests)if(conn.open&&member.id){
     try{conn.send({snapshot});}catch(err){console.warn('[Splat Racers] Snapshot send:',err);}
    }
   },50);
  }else{
   channel=peer.connect('splat-racers-room-'+code,{reliable:true});
   await waitFor(channel,'open');
   channel.on('close',()=>close('Host disconnected. Create or join a new race.'));
   channel.on('error',err=>close('Peer connection failed: '+String(err?.message||err)));
   peer.on('error',err=>close('Signaling failed: '+String(err?.message||err)));
   channel.on('data',msg=>{
    if(!msg||typeof msg!=='object')return;
    if(msg.snapshot){onSnapshot(msg.snapshot);return;}
    const job=pending.get(msg.seq);
    if(job){pending.delete(msg.seq);if(msg.error)job.reject(Error(msg.error));else job.resolve(msg.result);}
    else if(msg.error)close(msg.error);
   });
  }
 }catch(err){close();throw err;}
 if(typeof window!=='undefined')window.addEventListener('pagehide',()=>close(),{once:true});
 return {code,close,async call(action,data={}){
  if(closed)throw Error('Room closed');
  if(hosting)return execute(local,action,data);
  if(action==='input'){channel.send({action,data});return {};}
  const seq=++serial;
  return new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{pending.delete(seq);reject(Error('Host did not respond. Check network connectivity.'));},requestTimeoutMs);
   const complete={resolve:value=>{clearTimeout(timeout);resolve(value);},reject:e=>{clearTimeout(timeout);reject(e);}};
   pending.set(seq,complete);
   try{channel.send({action,data,seq});}catch(err){pending.delete(seq);complete.reject(err);}
  });
 }};
}
