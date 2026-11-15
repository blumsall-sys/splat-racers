// Effects trigger on entry. Leaving and returning re-arms the marker.
export function trackEffect(racer,track,dt){
 const zone=track.race.effects?.find(e=>
  Math.hypot(racer.x-e.x,racer.z-e.z)<=e.radius && Math.abs((racer.y??0)-e.y)<=e.radius+1);
 racer.effectTime=Math.max(0,(racer.effectTime||0)-dt);
 if(zone && racer.effectZone!==zone){
  racer.effectTime=zone.kind==='speed'?1.6:1.2;
  racer.effectKind=zone.kind;
 }
 racer.effectZone=zone;
 return racer.effectTime>0?racer.effectKind:null;
}
