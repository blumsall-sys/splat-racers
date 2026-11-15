import {TRAINING_TRACK} from './training-circuit.js';
const clone=o=>JSON.parse(JSON.stringify(o));
const valid=v=>typeof v==='number'&&Number.isFinite(v);
const point=p=>p&&valid(p.x)&&valid(p.z);
const fail=(s)=>{throw new Error('Track invalid: '+s);};
export function validateTrack(source){
 const t=clone(source);
 if(t.version!==1)fail('version must be 1');
 if(!t.spawns||!['p1','p2'].every(id=>point(t.spawns[id])&&valid(t.spawns[id].yaw)))fail('spawns p1/p2');
 if(!Array.isArray(t.collision?.walls)||(t.levelType!=='FREE_ROAM'&&t.collision.walls.length<4)||t.collision.walls.length>2000)fail('collision.walls');
 for(const w of t.collision.walls){if(!point(w)||!valid(w.hx)||!valid(w.hz)||w.hx<=0||w.hz<=0||w.hx>500||w.hz>500||!valid(w.yaw??0))fail('collision wall '+w.id);}
 if(!Array.isArray(t.race?.waypoints)||(t.levelType!=='FREE_ROAM'&&t.race.waypoints.length<8)||t.race.waypoints.length>1000||!t.race.waypoints.every(point))fail('race.waypoints');
 if(t.race.navigation){
   const n=t.race.navigation;
   if(n.version!==1||!Array.isArray(n.points)||n.points.length<8||n.points.length>1000||!n.points.every(p=>point(p)&&(!('left' in p)||valid(p.left)&&p.left>0)&&(!('right' in p)||valid(p.right)&&p.right>0)))fail('race.navigation.points');
 }
 if(!Array.isArray(t.race.gates)||(t.levelType!=='FREE_ROAM'&&t.race.gates.length<3)||t.race.gates.length>100||!t.race.gates.every(g=>g.id&&point(g.a)&&point(g.b)&&Math.hypot(g.a.x-g.b.x,g.a.z-g.b.z)>1))fail('race.gates');
 if(!Number.isInteger(t.race.lapsToWin)||t.race.lapsToWin<1||t.race.lapsToWin>100)fail('race.lapsToWin');
 const b=t.collision.bumps||[];
 if(!Array.isArray(b)||b.length>500||!b.every(v=>point(v)&&valid(v.hx)&&valid(v.hz)&&valid(v.height)&&v.hx>0&&v.hz>0&&v.height>=0))fail('collision.bumps');
 const obs=t.collision.obstacles||[];
 if(!Array.isArray(obs)||obs.length>100||!obs.every(v=>point(v)&&valid(v.hx)&&valid(v.hz)&&valid(v.mass)&&v.mass>0&&v.hx>0&&v.hz>0))fail('collision.obstacles');
 if(t.collision.heightfield){const h=t.collision.heightfield;
   if(!point(h.origin)||!valid(h.cellSize)||h.cellSize<=0||!Number.isInteger(h.width)||!Number.isInteger(h.depth)||h.width*h.depth>200000||h.width<2||h.depth<2||!Array.isArray(h.samples)||h.samples.length!==h.width*h.depth||!h.samples.every(valid))fail('collision.heightfield');
 }
 if(t.visuals?.boxes && (!Array.isArray(t.visuals.boxes)||t.visuals.boxes.length>8000))fail('visuals.boxes');
 return t;
}
export const DEFAULT_TRACK=validateTrack(TRAINING_TRACK);
const smooth=x=>{const s=Math.max(0,Math.min(1,x));return s*s*(3-2*s);};
export function terrainHeight(track,x,z){
 let height=0;
 for(const b of track.collision.bumps||[]){const sx=smooth(1-Math.abs(x-b.x)/b.hx),sz=smooth(1-Math.abs(z-b.z)/b.hz);height+=b.height*sx*sz;}
 const h=track.collision.heightfield;
 if(h){
   const gx=(x-h.origin.x)/h.cellSize,gz=(z-h.origin.z)/h.cellSize;
   if(gx>=0&&gz>=0&&gx<=h.width-1&&gz<=h.depth-1){
     const ix=Math.min(Math.floor(gx),h.width-2),iz=Math.min(Math.floor(gz),h.depth-2),tx=gx-ix,tz=gz-iz;
     const at=(px,pz)=>h.samples[pz*h.width+px];
     height+=(1-tz)*((1-tx)*at(ix,iz)+tx*at(ix+1,iz))+tz*((1-tx)*at(ix,iz+1)+tx*at(ix+1,iz+1));
   }
 }
 return height;
}
export async function loadTrack(url){
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok)throw new Error(`Track HTTP ${response.status}: ${url}`);
 return validateTrack(await response.json());
}
