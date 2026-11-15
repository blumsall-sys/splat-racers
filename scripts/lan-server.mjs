/** LAN test host (HTTP+SSE) on port 3000; browser never trusts client poses.
 * Uses Vite middleware already required by the local game. The Node server
 * provides its own simple fixed-step physics (NOT yet Ammo parity).
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer as createVite} from 'vite';
import {validateTrack} from '../src/track/track.js';
import {makeLanState,joinLan,leaveLan,setLanVehicle,setLanReady,sendLanInput,startLanRace,resetLanLobby,stepLan,lanSnapshot} from '../src/network/host-core.js';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const port=Number(process.env.SPLAT_LAN_PORT||3000);
const track=validateTrack(JSON.parse(await fs.readFile(path.join(root,'assets/track.json'),'utf8')));
const room=makeLanState(track),streams=new Map();
const vite=await createVite({root,configFile:path.join(root,'vite.config.mjs'),server:{middlewareMode:true,hmr:false},appType:'mpa',clearScreen:false});
function send(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
async function payload(req){let data='';for await(const c of req){data+=c;if(data.length>8192)throw new Error('Request is too large');}
 const value=JSON.parse(data||'{}');if(typeof value!=='object'||!value||Array.isArray(value))throw new Error('Object payload expected');return value;}
const handlers={
 '/api/join':(d)=>joinLan(room,d.name),
 '/api/ready':(d)=>({ok:setLanReady(room,d.token,d.ready)}),
 '/api/vehicle':(d)=>({ok:setLanVehicle(room,d.token,d.vehicle)}),
 '/api/start':(d)=>({ok:startLanRace(room,d.token,d)}),
 '/api/reset':(d)=>({ok:resetLanLobby(room,d.token)}),
 '/api/leave':(d)=>({ok:leaveLan(room,d.token)}),
 '/api/input':(d)=>({ok:sendLanInput(room,d.token,d)}),
};
const httpServer=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url||'/', 'http://localhost');
  if(u.pathname.startsWith('/api/')){
   if(u.pathname==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,phase:room.phase,version:'2.0.0-lan-experiment'});
   if(u.pathname==='/api/events'&&req.method==='GET'){
    const player=room.participants.get(u.searchParams.get('token'));
    if(!player||player.disconnected)return send(res,401,{error:'Unknown player session'});
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
    res.write('retry: 1500\n\n');
    const streamId=player.id;
    const previous=streams.get(streamId);if(previous&&previous!==res){previous.end();}
    streams.set(streamId,res);res.on('close',()=>{if(streams.get(streamId)===res)streams.delete(streamId);});
    res.write('event: snapshot\ndata: '+JSON.stringify(lanSnapshot(room))+'\n\n');return;
   }
   if(req.method!=='POST'||!handlers[u.pathname])return send(res,404,{error:'Unknown endpoint'});
   const data=await payload(req);const answer=handlers[u.pathname](data);
   return send(res,200,answer);
  }
  // No arbitrary file reads, directory traversal, shell access or uploads.
  vite.middlewares(req,res,()=>send(res,404,{error:'Not found'}));
 }catch(err){send(res,400,{error:String(err.message||err)});}
});
let previous=process.hrtime.bigint(),accumulator=0;
const simulation=setInterval(()=>{
 const now=process.hrtime.bigint();accumulator+=Math.min(.20,Number(now-previous)/1e9);previous=now;
 let steps=0;while(accumulator>=1/60&&steps++<8){stepLan(room,1/60);accumulator-=1/60;}
 if(steps>=8)accumulator=0;
},8);
const snapshots=setInterval(()=>{const msg='event: snapshot\ndata: '+JSON.stringify(lanSnapshot(room))+'\n\n';
 for(const [id,res] of streams){if(res.destroyed){streams.delete(id);continue;}res.write(msg);}},50);
const heart=setInterval(()=>{for(const res of streams.values())if(!res.destroyed)res.write(': keepalive\n\n');},10000);
httpServer.listen(port,'0.0.0.0',()=>{
 console.log('Splat Racers LAN prototype 2.0.0');console.log('Host: http://localhost:'+port+'/LAN.html');
 for(const entry of Object.values(os.networkInterfaces()).flat())if(entry?.family==='IPv4'&&!entry.internal)console.log('Other PCs: http://'+entry.address+':'+port+'/LAN.html');
 console.log('Authoritative snapshots 20 Hz, fixed physics 60 Hz, 4 racers maximum.');
});
const shutdown=async()=>{clearInterval(simulation);clearInterval(snapshots);clearInterval(heart);for(const c of streams.values())c.end();httpServer.close();await vite.close();process.exit(0);};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
