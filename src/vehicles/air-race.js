// One spatial flight route derived from the existing circuit centreline in Blender.
// Physical race rings are visual-only; oriented 3D plane tests count passages.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((n,i)=>n-b[i]);
const norm=v=>{const d=Math.hypot(...v);return d>1e-8?v.map(x=>x/d):null;};
export function validateAirGates(gates=[]){
 if(!Array.isArray(gates)||gates.length>64)throw new Error('Invalid flight checkpoint array');
 const ids=new Set();
 return gates.map((g,i)=>{
  if(!g?.id||ids.has(g.id))throw new Error('Missing or duplicate flight checkpoint '+i);
  const pos=g.position,normal=g.normal;
  if(!Array.isArray(pos)||pos.length!==3||!pos.every(Number.isFinite)||!Array.isArray(normal)||normal.length!==3||!normal.every(Number.isFinite)||!Number.isFinite(g.radius)||g.radius<=.4||g.radius>30)throw new Error('Invalid flight checkpoint '+g.id);
  const n=norm(normal);if(!n)throw new Error('Flight checkpoint has no direction '+g.id);
  ids.add(g.id);return {...g,normal:n};
 });
}
export function crossFlightGate(before,after,gate,{margin=.25,maxStep=14}={}){
 const a=[before.x,before.y,before.z],b=[after.x,after.y,after.z];
 const step=Math.hypot(...sub(b,a));if(step>maxStep||step<1e-6)return false;
 const n=gate.normal,c=gate.position;
 const s0=dot(sub(a,c),n),s1=dot(sub(b,c),n);
 if(!(s0<-.00001&&s1>=0))return false;
 const t=-s0/(s1-s0);if(t<0||t>1)return false;
 const hit=a.map((v,i)=>v+(b[i]-v)*t);
 const v=sub(hit,c),perpSq=dot(v,v)-dot(v,n)**2;
 return perpSq<=Math.max(.2,gate.radius-margin)**2;
}
export function advanceAirLap(state,previous,current,gates,lapsToWin){
 if(!gates.length||!state)return {crossed:false,won:false};
 const gate=gates[state.next];if(!crossFlightGate(previous,current,gate))return {crossed:false,won:false};
 if(state.next===0){if(state.launched)state.laps++;else state.launched=true;}
 state.lastGateIndex=state.next;
 state.next=(state.next+1)%gates.length;
 return {crossed:true,gate:gate.id,won:state.laps>=lapsToWin};
}
export function airRespawn(gate){
 const [x,y,z]=gate.position,[nx,ny,nz]=gate.normal;
 return {x:x-nx*2.8,y:y-ny*2.8,z:z-nz*2.8,
  yaw:Math.atan2(nx,nz),roadY:y-3.2};
}
/** Emergency-only NPC relocation candidates. Each is BEHIND the CURRENT
 * required checkpoint, never past it; consuming one grants no progress and
 * main.js resets the crossing sample to exclude the teleport. Artist-authored
 * gate offsets and normals remain authoritative. */
export function flightNpcRecoveryCandidates(gate,racerId='p3'){
 const c=gate.position,n=gate.normal;
 const radius=Math.max(.6,gate.radius||2.6);
 let side=[n[2],0,-n[0]];
 const len=Math.hypot(...side);
 side=len>.01?side.map(v=>v/len):[1,0,0];
 const sign=({'p1':-1,'p2':1,'p3':-1,'p4':1})[racerId]||1;
 const list=[];
 for(const back of [Math.max(6,radius*2.2),Math.max(10,radius*3.2),Math.max(15,radius*4.5)]){
  for(const lane of [0,sign*radius*.30,-sign*radius*.30]){
   const x=c[0]-n[0]*back+side[0]*lane;
   const y=c[1]-n[1]*back+side[1]*lane;
   const z=c[2]-n[2]*back+side[2]*lane;
   if((x-c[0])*n[0]+(y-c[1])*n[1]+(z-c[2])*n[2] >-.5)continue;
   list.push({x,y,z,yaw:Math.atan2(n[0],n[2]),roadY:y-3.0});
  }
 }
 return list;
}

/** Flight-course diagnostics are non-destructive: hand-authored AIR_OFFSET
 * transforms remain authoritative, and the game never awards or skips gates.
 * The first gate must be ahead of the grid and face its intended travel path.
 */
export function inspectFlightCourse(gates,spawns){
 const warnings=[];
 if(!gates?.length)return {ok:true,warnings};
 const front=['p1','p2'].map(id=>spawns?.[id]).filter(Boolean);
 const first=gates[0];
 for(const spawn of front){
  const f=[Math.sin(spawn.yaw||0),0,Math.cos(spawn.yaw||0)];
  const origin=[spawn.x,Number(spawn.y)||0,spawn.z];
  const to=sub(first.position,origin);
  const ahead=dot(to,f);
  const startSide=dot(sub(origin,first.position),first.normal);
  if(ahead<Math.max(1.5,first.radius*.4))warnings.push(`First flight ring ${first.id} is not sufficiently ahead of the starting grid (P${spawn===spawns.p1?1:2}; forward ${ahead.toFixed(1)} m). Refresh Flight Rings from the road curve in Blender and re-export.`);
  if(startSide>-.25)warnings.push(`Starting grid is already beyond the required entry face of ${first.id}. Its normal or centreline order may be reversed.`);
 }
 for(let i=0;i<gates.length;i++){
  const a=gates[i],b=gates[(i+1)%gates.length],v=sub(b.position,a.position),d=Math.hypot(...v);
  if(d<Math.max(.5,Math.min(a.radius,b.radius)*.35))warnings.push(`${a.id} and ${b.id} are nearly coincident; their crossing order may be ambiguous.`);
  if(i+1<gates.length&&d>1&&dot(a.normal,v)/d<-.6)warnings.push(`${a.id} faces away from the next flight ring ${b.id}; verify AIR_OFFSET orientation.`);
 }
 return {ok:warnings.length===0,warnings};
}
/** Legacy training packs have no Blender rings. Use the road's start/finish
 * projection and its ordered direction, NOT waypoint[0]. The old fallback
 * placed AIR_00 behind the grid and caused an immediate NPC U-turn.
 */
export function legacyFlightGates(track){
 const original=track?.race?.waypoints||[];
 if(original.length<8)return [];
 const spawns=track.spawns||{},start=track.race?.gates?.[0];
 if(!start?.a||!start?.b||!spawns.p1)return [];
 const cx=(start.a.x+start.b.x)/2,cz=(start.a.z+start.b.z)/2;
 const f={x:Math.sin(spawns.p1.yaw||0),z:Math.cos(spawns.p1.yaw||0)};
 // Track direction can be reversed by a custom source: align it to grid yaw.
 let path=original.map(w=>({x:w.x,z:w.z,y:w.y}));
 let closest=-1,best=Infinity,along=0;
 const project=arr=>{
  let nearest={dist:Infinity,index:0,t:0};
  for(let i=0;i<arr.length;i++){
   const a=arr[i],b=arr[(i+1)%arr.length],dx=b.x-a.x,dz=b.z-a.z;
   const t=Math.max(0,Math.min(1,((cx-a.x)*dx+(cz-a.z)*dz)/Math.max(1e-8,dx*dx+dz*dz)));
   const dist=(cx-a.x-dx*t)**2+(cz-a.z-dz*t)**2;
   if(dist<nearest.dist)nearest={dist,index:i,t,dx,dz};
  }
  return nearest;
 };
 let proj=project(path);
 if(proj.dx*f.x+proj.dz*f.z<0){path=path.slice().reverse();proj=project(path);}
 const lengths=path.map((a,i)=>Math.hypot(path[(i+1)%path.length].x-a.x,path[(i+1)%path.length].z-a.z));
 const length=lengths.reduce((a,b)=>a+b,0);
 if(length<20)return [];
 const prefix=lengths.slice(0,proj.index).reduce((a,b)=>a+b,0);
 const finishDist=prefix+proj.t*lengths[proj.index];
 const count=Math.min(8,Math.floor(path.length/2)),radius=Math.min(2.6,Math.max(1.4,length/count*.3));
 const clearance=Math.max(5,radius+4);
 const altitude=Number(spawns.p1.y)||0;
 const at=(distance)=>{
  let d=((distance%length)+length)%length;
  for(let i=0;i<path.length;i++){
   const segment=lengths[i];
   if(d<=segment||i===path.length-1){
    const a=path[i],b=path[(i+1)%path.length],t=Math.min(1,d/Math.max(segment,1e-8));
    const tangent=[(b.x-a.x)/Math.max(segment,1e-8),0,(b.z-a.z)/Math.max(segment,1e-8)];
    return {point:[a.x+(b.x-a.x)*t,altitude+3,a.z+(b.z-a.z)*t],normal:tangent};
   }
   d-=segment;
  }
 };
 return Array.from({length:count},(_,i)=>{
  const sample=at(finishDist+clearance+i*length/count);
  return {id:'LEGACY_AIR_'+i,position:sample.point,normal:sample.normal,radius};
 });
}
