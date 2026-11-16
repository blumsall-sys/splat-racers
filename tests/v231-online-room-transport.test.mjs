import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {openRoom} from '../src/network/online-room.js';

class Connection extends EventEmitter {
 constructor(){super();this.open=false;this.peerConnection=null;}
 send(data){if(!this.open)throw Error('Connection closed');queueMicrotask(()=>{if(this.peerConnection?.open)this.peerConnection.emit('data',structuredClone(data));});}
 close(){if(!this.open)return;const other=this.peerConnection;this.open=false;if(other)other.open=false;queueMicrotask(()=>{this.emit('close');other?.emit('close');});}
}
function makePeerFactory(){
 const registry=new Map();let next=0;
 return id=>{
  const peer=new EventEmitter();peer.id=id||'test-guest-'+(++next);
  const connections=new Set();
  peer.connect=remoteId=>{
   const conn=new Connection();connections.add(conn);
   const remote=registry.get(remoteId);
   if(!remote){queueMicrotask(()=>conn.emit('error',Error('Host unavailable')));return conn;}
   const hostConn=new Connection();hostConn.peerConnection=conn;conn.peerConnection=hostConn;
   remote.connections.add(hostConn);
   queueMicrotask(()=>{remote.peer.emit('connection',hostConn);conn.open=true;hostConn.open=true;conn.emit('open');hostConn.emit('open');});
   return conn;
  };
  peer.destroy=()=>{for(const conn of connections)conn.close();registry.delete(peer.id);};
  if(registry.has(peer.id))queueMicrotask(()=>peer.emit('error',Error('Room ID taken')));
  else {registry.set(peer.id,{peer,connections});queueMicrotask(()=>peer.emit('open',peer.id));}
  return peer;
 };
}
async function until(check){for(let i=0;i<70;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Timed out waiting for room updates');}
test('Online room supports four clients, validates ownership, streams snapshots and disconnects',async()=>{
 const peerFactory=makePeerFactory(),opts={peerFactory,requestTimeoutMs:500};
 const snapshots=[[],[],[],[]],departures=[];
 const host=await openRoom('',TRAINING_TRACK,data=>snapshots[0].push(data),()=>{},opts);
 const guest1=await openRoom(host.code,TRAINING_TRACK,data=>snapshots[1].push(data),msg=>departures.push(msg),opts);
 const guest2=await openRoom(host.code,TRAINING_TRACK,data=>snapshots[2].push(data),()=>{},opts);
 const guest3=await openRoom(host.code,TRAINING_TRACK,data=>snapshots[3].push(data),()=>{},opts);
 try{
  const racers=[host,guest1,guest2,guest3],joined=[];
  for(const [i,client] of racers.entries())joined.push(await client.call('join',{name:'Racer '+i}));
  assert.deepEqual(joined.map(p=>p.id),['p1','p2','p3','p4']);
  await guest1.call('vehicle',{vehicle:'DRONE'});
  await guest2.call('vehicle',{vehicle:'HOVER'});
  for(const client of racers)await client.call('ready',{ready:true});
  await assert.rejects(guest1.call('start',{laps:1,pace:1,npcCount:0,difficulty:'medium'}),/Only the room host/);
  await host.call('start',{laps:1,pace:1,npcCount:0,difficulty:'medium'});
  await until(()=>snapshots[1].some(s=>s.phase==='countdown'&&s.racers.length===4));
  const frame=snapshots[1].find(s=>s.phase==='countdown');
  assert.deepEqual(frame.racers.map(r=>r.vehicle),['KART','DRONE','HOVER','KART']);
  await guest1.call('input',{seq:1,throttle:1,steer:.2,x:900000,laps:999});
  await assert.rejects(guest2.call('reset',{}),/Action unavailable/);
  host.close('');
  await until(()=>departures.length>0);
  assert.match(departures[0],/Host disconnected/);
 }finally{host.close('');guest1.close('');guest2.close('');guest3.close('');}
});
test('Missing room rejects a guest rather than hanging',async()=>{
 const peerFactory=makePeerFactory();
 await assert.rejects(openRoom('ABCDEF1234',TRAINING_TRACK,()=>{},()=>{},{peerFactory}),/Host unavailable/);
});
