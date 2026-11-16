import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {TRAINING_TRACK} from '../src/track/training-circuit.js';
import {openRoom} from '../src/network/online-room.js';
import {createAmmoHostAdapter} from '../src/network/ammo-host.js';

class Connection extends EventEmitter {
 constructor(){super();this.open=false;this.peerConnection=null;}
 send(data){if(!this.open)throw Error('Connection closed');queueMicrotask(()=>{if(this.peerConnection?.open)this.peerConnection.emit('data',structuredClone(data));});}
 close(){if(!this.open)return;const other=this.peerConnection;this.open=false;if(other)other.open=false;queueMicrotask(()=>{this.emit('close');other?.emit('close');});}
}
function makePeerFactory(){
 const registry=new Map();let next=0;
 return id=>{
  const peer=new EventEmitter();peer.id=id||'guest-'+(++next);const connections=new Set();
  peer.connect=remoteId=>{
   const conn=new Connection();connections.add(conn);const remote=registry.get(remoteId);
   if(!remote){queueMicrotask(()=>conn.emit('error',Error('Host unavailable')));return conn;}
   const other=new Connection();other.peerConnection=conn;conn.peerConnection=other;remote.connections.add(other);
   queueMicrotask(()=>{remote.peer.emit('connection',other);conn.open=true;other.open=true;conn.emit('open');other.emit('open');});
   return conn;
  };
  peer.destroy=()=>{for(const conn of connections)conn.close();registry.delete(peer.id);};
  if(registry.has(peer.id))queueMicrotask(()=>peer.emit('error',Error('Room already exists')));
  else {registry.set(peer.id,{peer,connections});queueMicrotask(()=>peer.emit('open',peer.id));}
  return peer;
 };
}
async function until(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Timed out waiting for peer room update');}
test('Online transport requires the actual native host adapter (never a substitute physics loop)',async()=>{
 await assert.rejects(openRoom('',TRAINING_TRACK,()=>{},()=>{}),/requires the running PlayCanvas\/Ammo race/);
});
test('Host adapter passes four players through native race callbacks and snapshots authoritative transforms',async()=>{
 let world=null,created=0,cleared=0;
 const adapter=createAmmoHostAdapter({
  getWorld:()=>world,
  startRace:()=>{
   created++;
   const cars=[...adapter.roster(),...adapter.aiIds().map(id=>({id,human:false,label:'NPC'}))].map((entry,i)=>{
    const vehicle=adapter.vehicleFor(entry.id);
    return {id:entry.id,label:entry.label,isNpc:!entry.human,spec:{type:vehicle},x:10+i,y:3,z:4,vx:2,vz:0,yaw:.5,
     entity:{getPosition:()=>({x:10+i,y:3,z:4}),getRotation:()=>({x:0,y:0,z:0,w:1})}};
   });
   world={cars,elapsed:3,race:{winner:null,per:Object.fromEntries(cars.map(c=>[c.id,{laps:0,next:0,launched:false}]))},track:TRAINING_TRACK};
  },
  backToLobby:()=>{world=null;cleared++;}
 });
 const peerFactory=makePeerFactory(),opts={peerFactory,hostAdapter:adapter,requestTimeoutMs:600};
 const snapshots=[[],[],[],[]],departures=[];
 const host=await openRoom('',TRAINING_TRACK,s=>snapshots[0].push(s),()=>{},opts);
 const guests=[];
 try{
  for(let i=1;i<4;i++)guests.push(await openRoom(host.code,TRAINING_TRACK,s=>snapshots[i].push(s),msg=>departures.push(msg),{peerFactory,requestTimeoutMs:600}));
  const racers=[host,...guests],joined=[];
  for(let i=0;i<racers.length;i++)joined.push(await racers[i].call('join',{name:'Driver '+i}));
  assert.deepEqual(joined.map(x=>x.id),['p1','p2','p3','p4']);
  await guests[0].call('vehicle',{vehicle:'DRONE'});
  await guests[1].call('vehicle',{vehicle:'HOVER'});
  for(const racer of racers)await racer.call('ready',{ready:true});
  await assert.rejects(guests[0].call('start',{npcCount:0,laps:1,pace:1,difficulty:'medium'}),/Only room host/);
  await host.call('start',{npcCount:0,laps:1,pace:1,difficulty:'medium'});
  assert.equal(created,1,'Exactly one native start callback');
  await until(()=>snapshots[1].some(s=>s.phase==='countdown'));
  const snapshot=snapshots[1].find(s=>s.phase==='countdown');
  assert.equal(snapshot.physics,'playcanvas-ammo-btRaycastVehicle');
  assert.deepEqual(snapshot.racers.map(r=>r.vehicle),['KART','DRONE','HOVER','KART']);
  assert.equal(snapshot.racers[0].x,10);
  assert.equal(snapshot.racers[0].y,3);
  assert.deepEqual(snapshot.racers[0].rotation,[0,0,0,1]);
  adapter.setPhase('race');
  await guests[0].call('input',{seq:1,throttle:9,steer:-3,x:999999,laps:100});
  await until(()=>adapter.inputFor('p2',{}).throttle===1);
  const input=adapter.inputFor('p2',{});
  assert.equal(input.throttle,1);assert.equal(input.steer,-1);
  assert.equal(snapshot.racers[1].x,11,'Client-authored position cannot alter authoritative physics pose');
  await host.call('reset',{});
  assert.equal(cleared,1);assert.equal(adapter.phase(),'lobby');
  host.close();
  await until(()=>departures.length>0);
  assert.match(departures[0],/Host disconnected/);
 }finally{host.close();for(const guest of guests)guest.close();}
});
test('Host adapter reuses local Ammo initialization and drives existing raycast vehicles',()=>{
 const source=readFileSync(new URL('../src/v14/main.js',import.meta.url),'utf8');
 for(const signature of ['addPackGeometry(app,pack,track','makeKart(app,id,spawn','driveRaycastVehicle(car,input,dt,pc)','createAmmoHostAdapter(','onlineAdapter.inputFor(']){
  assert(source.includes(signature),'Shared native runtime missing '+signature);
 }
 const client=readFileSync(new URL('../src/network/client.js',import.meta.url),'utf8');
 assert(!client.includes("import('./road-surface.js')"),'No independent online surface solver should be used');
 assert(!client.includes("import('./host-core.js')"),'No independent online vehicle solver should be used');
});
