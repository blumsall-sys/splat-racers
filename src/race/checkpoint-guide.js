/** Shared race navigation for karts and flight rigs. These are projections of
 * the EXISTING road gates / flight rings; they do not create a second track or
 * alter authoritative gate-crossing, win or respawn logic.
 */
const norm=(x,z)=>{const n=Math.hypot(x,z);return n>1e-6?{x:x/n,z:z/n}:{x:0,z:1};};
export function roadGateTarget(track,index){
 const gates=track?.race?.gates||[],gate=gates[index];if(!gate)return null;
 const cx=(gate.a.x+gate.b.x)*.5,cz=(gate.a.z+gate.b.z)*.5;
 const near=(track.race.waypoints||[]).reduce((best,w)=>{
  const d=(Number(w.x)-cx)**2+(Number(w.z)-cz)**2;
  return Number.isFinite(d)&&(!best||d<best.d)?{d,waypoint:w}:best;
 },null);
 const elevation=Number.isFinite(near?.waypoint?.y)?near.waypoint.y:(track.spawns?.p1?.y??0);
 const dir=norm(gate.b.z-gate.a.z,gate.a.x-gate.b.x);
 return {id:gate.id,kind:'ROAD',number:index+1,count:gates.length,
  position:{x:cx,y:elevation+.65,z:cz},direction:dir,gate};
}
export function airGateTarget(gates,index){
 const gate=gates?.[index];if(!gate)return null;
 const [x,y,z]=gate.position;
 return {id:gate.id,kind:'AIR',number:index+1,count:gates.length,
  position:{x,y,z},direction:norm(gate.normal[0],gate.normal[2]),gate};
}
export function nextCheckpoint(track,airGates,car,state){
 if(!state||!car)return null;
 const idx=state.next;
 return car.spec?.type==='KART'?roadGateTarget(track,idx):airGateTarget(airGates,idx);
}
export function raceProgress(state,gateCount,lapsToWin){
 if(!state||!gateCount||!lapsToWin)return 0;
 const partial=!state.launched?0:state.next===0?1:state.next/gateCount;
 return Math.max(0,Math.min(1,(state.laps+partial)/lapsToWin));
}
export function waypointGuidance(pos,forward,target){
 const delta={x:target.position.x-pos.x,y:target.position.y-pos.y,z:target.position.z-pos.z};
 const f=norm(forward.x,forward.z),flat=Math.hypot(delta.x,delta.z),distance=Math.hypot(flat,delta.y);
 const ahead=delta.x*f.x+delta.z*f.z,side=-delta.x*f.z+delta.z*f.x;
 const radians=Math.atan2(side,ahead),abs=Math.abs(radians),positive=radians>0;
 const arrow=abs<Math.PI/8?'↑':abs<3*Math.PI/8?(positive?'↗':'↖'):
  abs<5*Math.PI/8?(positive?'→':'←'):abs<7*Math.PI/8?(positive?'↘':'↙'):'↓';
 return {arrow,distance,flatDistance:flat,heightDelta:delta.y,bearing:radians,
  verticalHint:delta.y>2?'↑ '+Math.round(delta.y)+' m':delta.y< -2?'↓ '+Math.round(-delta.y)+' m':'LEVEL'};
}
