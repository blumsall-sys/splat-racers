/** Splat Racers v2.3 — renderer-independent, physically-driven flight racing AI.
 *
 * A flight gate is an oriented aperture.  This planner NEVER grants progress:
 * vehicles must still cross the real plane in vehicles/air-race.js.  It produces
 * the same steer/throttle/boost input as a human plus an NPC-only altitude
 * setpoint, tracked by the real Ammo flight motors (not a teleport).
 *
 * Intentional stages: return to ENTRY side -> align -> commit through aperture.
 * Progress/state is maintained per car, not per gate or per viewport.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const magnitude=a=>Math.hypot(a.x,a.y,a.z);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const point=(a,b,t)=>({x:a.x+b.x*t,y:a.y+b.y*t,z:a.z+b.z*t});
const unit=v=>{const l=magnitude(v)||1;return {x:v.x/l,y:v.y/l,z:v.z/l};};
const xyz=a=>({x:Number(a?.[0])||0,y:Number(a?.[1])||0,z:Number(a?.[2])||0});
const fin=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
export const AIR_NPC_LEVELS=Object.freeze({
 easy:  Object.freeze({cruise:.79,throttleGain:.75,turnRate:.95,alignSpeed:5.3,crossMin:5.4,lookAhead:1.4,stuckTime:15}),
 medium:Object.freeze({cruise:.91,throttleGain:1.0,turnRate:1.6,alignSpeed:7.1,crossMin:6.5,lookAhead:1.1,stuckTime:12}),
 hard:  Object.freeze({cruise:1.0,throttleGain:1.25,turnRate:1.18,alignSpeed:7.8,crossMin:7.6,lookAhead:.85,stuckTime:10})
});
export function npcAirState(){return {lastTarget:-1,phase:'STAGING',phaseAge:0,commit:false,
 stuckFor:0,rescueCooldown:7,avoidSide:0,avoidFor:0,
 previousDistance:Infinity,escapeFor:0,
 reapproaches:0,gateTime:0,gateStartDistance:0,progressAge:0,progressAnchor:null,
 rescueAttempts:0};}
export function npcAirChoice(roster,humanChoices,catalog,gateCount=0){
 const safe=spec=>catalog.find(v=>v.id===spec)?.type||'KART';
 const byType=type=>catalog.find(v=>v.type===type)?.id||'kart';
 const choices=[];
 const humanTypes=humanChoices.map(safe);
 const options=gateCount>0?['KART','HOVER','DRONE']:['KART'];
 const missing=[...new Set(humanTypes.filter(type=>type!=='KART'))];
 for(const type of (gateCount>0?['HOVER','DRONE','KART']:options))if(!missing.includes(type))missing.push(type);
 let n=0;
 for(const entry of roster){
  if(entry.human){choices.push(humanChoices[Number(entry.id.slice(1))-1]||'kart');continue;}
  const type=missing[n++%missing.length];
  const matching=humanChoices.find(id=>safe(id)===type);
  choices.push(matching||byType(type));
 }
 return choices;
}
/** Raycast ahead without mistaking the ground, visual rings, or own hull for
 * obstacles. The engine collision still does the actual contact resolution. */
export function flightNpcObstacle(physics,car,Vec3){
 if(!physics?.raycastFirst||!Vec3||!car?.entity)return null;
 const p=car.entity.getPosition(),f=car.entity.forward;
 const forward={x:-f.x,z:-f.z};const right={x:forward.z,z:-forward.x};
 const cast=(side=0)=>{
  const from=new Vec3(p.x+right.x*side,p.y,p.z+right.z*side);
  const to=new Vec3(from.x+forward.x*9,from.y,from.z+forward.z*9);
  const hit=physics.raycastFirst(from,to,{filterCallback:e=>e!==car.entity&&/^(?:p[1-4](?:\s+(?:HOVER|DRONE))?|Wall:|Dynamic:|Proxy:)/.test(String(e?.name||''))});
  return hit?.point?{distance:Math.hypot(hit.point.x-from.x,hit.point.y-from.y,hit.point.z-from.z),name:hit.entity?.name||'obstacle',point:hit.point}:null;
 };
 const hits=[cast(),cast(-.70),cast(.70)].filter(Boolean).sort((a,b)=>a.distance-b.distance);
 return hits[0]||null;
}
/** Small per-racer lateral lane bias. It contracts close to a narrow ring. */
export function airNpcLane(id,radius){
 const lane={p1:-.38,p2:.38,p3:-.18,p4:.18}[id]??0;
 return lane*Math.max(.6,Math.min(12,radius));
}
/** 3D entry / exit planning in ring-local space; useful for artist-authored
 * tilted rings and road-relative rings. Horizontal lateral alone is invalid
 * for tilted rings, so distance is measured in the actual gate plane. */
export function planAirGateApproach(position,gate,{committed=false,laneOffset=0}={}){
 const center=xyz(gate.position),normal=unit(xyz(gate.normal));
 const radius=Math.max(.65,fin(gate.radius,2.6));
 const relative=subtract(position,center),signed=dot(relative,normal);
 let horizontal={x:normal.z,y:0,z:-normal.x};
 if(magnitude(horizontal)<.02)horizontal={x:1,y:0,z:0};
 horizontal=unit(horizontal);
 const lane=point(center,horizontal,clamp(laneOffset,-radius*.36,radius*.36));
 const planeProjection=point(position,normal,-signed);
 const lateral=magnitude(subtract(planeProjection,lane));
 const entryDistance=clamp(radius*1.6+1.2,4.6,10);
 const exitDistance=clamp(radius*1.6+1.4,5.0,10.5);
 const entry=point(lane,normal,-entryDistance),exit=point(lane,normal,exitDistance);
 const tolerance=clamp(radius*.47,.65,2.7);
 // Once on the wrong side, drive back to the entry face. Do not award a
 // backward pass; the gate's authoritative signed crossing remains intact.
 let phase,target;
 if(signed>.28){phase='REAPPROACH';target=entry;}
 else if(lateral>(committed?radius*.84:tolerance)){
  phase='ALIGN';target=entry;
 }else{phase='CROSS';target=exit;}
 const aligned=signed<-.30&&lateral<tolerance;
 return {phase,target,entry,exit,center,normal,lane,radius,tolerance,
  signed,lateral,aligned,wrongSide:signed>.28,
  crossingReady:signed<0&&lateral<radius*.64};
}
/** Pure throttle planner. It never asks for negative thrust merely because the
 * next ring is close; doing so caused flight NPCs to stop while crossing. */
export function airNpcPace({phase,bearing,distance,signed,radius,elevation,altitudeReady,speed,pace=1,difficulty='medium'}={}){
 const cfg=AIR_NPC_LEVELS[difficulty]||AIR_NPC_LEVELS.medium;
 const openStraight=distance>26 && altitudeReady && Math.abs(bearing)<.20;
 const base=12.5*(openStraight?1.05:.87)*clamp(pace,.75,2.5)*cfg.cruise;
 const turn=Math.abs(bearing);
 const approach=phase==='CROSS' ? base : Math.min(base,cfg.alignSpeed*Math.sqrt(clamp(pace,.7,2.5)));
 const turnFactor=turn>2.3?.27:turn>1.35?.42:turn>.8?.63:turn>.35?.85:1;
 const verticalFactor=altitudeReady?1:clamp(1-Math.abs(elevation)*.027,.42,.80);
 // Never panic-brake on the actual ring centreline. Cross decisively once
 // aligned and altitude-ready, then immediately plan the next gate.
 const crossFloor=cfg.crossMin*clamp(pace,.8,1.7);
 const stageFloor=phase==='REAPPROACH'?2.6:3.7;
 const floor=phase==='CROSS'&&turn<.55&&altitudeReady?crossFloor:stageFloor;
 const wanted=clamp(approach*turnFactor*verticalFactor,floor,base);
 const error=wanted-fin(speed);
 const gain=error<0?.38:cfg.throttleGain;
 return {desiredSpeed:wanted,throttle:clamp(error*gain,-.72,1),maxSpeed:base};
}
/** Active NPC driving: 3D waypoint geometry, heading velocity preview,
 * altitude hold, traffic separation, progress watchdog, physical recovery.
 * Only actual ring plane crossings change laps or checkpoint counters. */
export function stepAirNpc(car,gates,progress,previous,dt=1/60,{difficulty='medium',pace=1,others=[],obstacle=null}={}){
 const s=previous||npcAirState(),delta=clamp(fin(dt),0,.1),idx=progress?.next??0,gate=gates[idx];
 if(!gate)return {state:s,input:{steer:0,throttle:0,drift:false,descend:false,boost:false},diagnostics:{reason:'no gates'},rescue:false};
 const cfg=AIR_NPC_LEVELS[difficulty]||AIR_NPC_LEVELS.medium;
 const p={x:fin(car.x),y:fin(car.y,car.entity?.getPosition?.().y??0),z:fin(car.z)};
 const vel={x:fin(car.vx),y:fin(car.vy,car.entity?.rigidbody?.linearVelocity?.y??0),z:fin(car.vz)};
 const speed=Math.hypot(vel.x,vel.z);
 s.rescueCooldown=Math.max(0,fin(s.rescueCooldown)-delta);
 if(s.lastTarget!==idx){
  s.lastTarget=idx;s.phase='STAGING';s.phaseAge=0;s.commit=false;
  s.stuckFor=0;s.escapeFor=0;s.gateTime=0;s.progressAge=0;
  s.progressAnchor={...p};s.previousDistance=Infinity;s.avoidFor=0;
  s.gateStartDistance=magnitude(subtract(xyz(gate.position),p));
 }
 const rival=others.find(other=>other.id!==car.id&&Math.hypot(other.x-p.x,other.z-p.z)<9&&Math.abs((other.y??p.y)-p.y)<3);
 const laneOffset=airNpcLane(car.id,gate.radius)+(rival?Math.sin(idx*2.4+(Number(car.id?.slice(1))||0))*gate.radius*.15:0);
 let plan=planAirGateApproach(p,gate,{committed:s.commit,laneOffset});
 if(plan.aligned) s.commit=true;
 if(plan.wrongSide)s.commit=false;
 plan=planAirGateApproach(p,gate,{committed:s.commit,laneOffset});
 let phase=plan.phase,target=plan.target;
 s.gateTime+=delta;
 s.phaseAge=phase===s.phase?s.phaseAge+delta:0;s.phase=phase;
 // Flight lanes only provide early collision separation. We converge back
 // to the real aperture before crossing instead of steering around its rim.
 const forward={x:Math.sin(fin(car.yaw)),z:Math.cos(fin(car.yaw))};
 let nearest=null;
 for(const other of others){
  if(!other||other.id===car.id)continue;
  const op=other.entity?.getPosition?.()||other;
  const dx=fin(op.x)-p.x,dz=fin(op.z)-p.z,dy=fin(op.y,p.y)-p.y;
  const ahead=dx*forward.x+dz*forward.z;
  const side=dx*forward.z-dz*forward.x;
  if(ahead<-.8||ahead>9.5||Math.abs(dy)>2.7||Math.abs(side)>3)continue;
  const distance=Math.hypot(dx,dy,dz);
  if(!nearest||distance<nearest.distance)nearest={distance,side,ahead,id:other.id};
 }
 const nearPlane=phase==='CROSS'&&plan.signed>-plan.radius*1.5;
 let trafficBrake=false;
 if(nearest){
  const away=nearest.side>=0?1:-1;s.avoidSide=away;s.avoidFor=.85;
  trafficBrake=nearest.distance<4.5;
 }else{s.avoidFor=Math.max(0,s.avoidFor-delta);if(!s.avoidFor)s.avoidSide=0;}
 const threat=!!obstacle&&obstacle.distance<7.5;
 if(threat&&s.avoidSide===0){s.avoidSide=car.id==='p4'?-1:1;s.avoidFor=.85;}
 // Avoidance is blended OUT near a ring where the aperture is narrow.
 if(s.avoidFor>0&&!nearPlane){
  const dir={x:plan.normal.z,y:0,z:-plan.normal.x};
  const sideFactor=clamp((plan.radius-plan.lateral)/Math.max(1,plan.radius),0,1);
  const offset=s.avoidSide*Math.min(1.25,plan.radius*.20)*sideFactor;
  target=point(target,unit(dir),offset);
 }
 // The target is a real physical waypoint; compensate a little for lateral
 // momentum (drift) without snapping velocity or rotating the rigid body.
 const lookAhead=cfg.lookAhead;
 const dx=target.x-p.x-vel.x*lookAhead*.22;
 const dz=target.z-p.z-vel.z*lookAhead*.22;
 const distHorizontal=Math.hypot(dx,dz);
 const bearing=wrap(Math.atan2(dx,dz)-fin(car.yaw));
 const elevation=target.y-p.y;
 const targetAltitude=clamp(target.y,-500,5000);
 const altitudeError=targetAltitude-p.y;
 const altitudeReady=Math.abs(altitudeError)<Math.max(.75,plan.radius*.24)&&Math.abs(vel.y)<2.5;
 // The 2x/2.5x preset is intended for proportionally larger levels. On a
 // compact course with gates only ~15-25m apart, full doubled speed would
 // require an impossible turning radius. Scale the NPC's usable speed by
 // the actual local gate spacing, not the nominal menu multiplier alone.
 const prevGate=gates[(idx-1+gates.length)%gates.length];
 const nextGate=gates[(idx+1)%gates.length];
 const gapPrev=prevGate===gate?Infinity:magnitude(subtract(xyz(prevGate.position),plan.center));
 const gapNext=nextGate===gate?Infinity:magnitude(subtract(xyz(nextGate.position),plan.center));
 const localGap=Math.min(gapPrev,gapNext);
 const routePace=Number.isFinite(localGap)?Math.max(1,1+(localGap-20)/36):pace;
 const effectivePace=Math.min(pace,routePace);
 const paceInfo=airNpcPace({phase,bearing,distance:distHorizontal,signed:plan.signed,radius:plan.radius,
  elevation,altitudeReady,speed,pace:effectivePace,difficulty});
 // Size the crossing speed to the distance available for turning into the
 // NEXT ring. This is essential on tight custom tracks at 2x/2.5x speed:
 // simply multiplying acceleration and cap without preview causes a miss.
 const next=nextGate;
 if(next && next!==gate && phase==='CROSS'){
  const link=subtract(xyz(next.position),plan.center),linkLength=magnitude(link);
  if(linkLength>1){
   const out={x:link.x/linkLength,y:link.y/linkLength,z:link.z/linkLength};
   const cornerAngle=Math.acos(clamp(dot(out,plan.normal),-1,1));
   const cornerSpeed=clamp((13-cornerAngle*4.1)*clamp(effectivePace,.85,1.2),4.6,15);
   const remaining=Math.max(0,linkLength-plan.radius-(next.radius||3)*.5);
   // Ring-dense layouts are not driveable at a multiplied global top speed.
   // A long open straight still permits the full 2x/2.5x preset.
   const safeSpeed=Math.min(paceInfo.maxSpeed,cornerSpeed+Math.max(0,remaining-9)*.30);
   const revised=Math.min(paceInfo.desiredSpeed,safeSpeed);
   paceInfo.throttle=clamp((revised-speed)*(revised<speed?.50:cfg.throttleGain),-.72,1);
   paceInfo.desiredSpeed=revised;
  }
 }
 let steer=clamp(-bearing/.78*cfg.turnRate,-1,1);
 let throttle=paceInfo.throttle;
 if(phase==='REAPPROACH'&&Math.abs(bearing)>1.95)throttle=Math.min(throttle,.32);
 else if(Math.abs(bearing)>1.6)throttle=Math.min(throttle,.48);
 if(threat){
  throttle=Math.min(throttle,clamp((obstacle.distance-2.4)*.32,-.50,.60));
  if(!nearPlane)steer=clamp(steer+(s.avoidSide||1)*.25,-1,1);
 }
 if(nearest){
  throttle=Math.min(throttle,clamp((nearest.distance-2.0)*.37,-.55,.65));
  if(!nearPlane)steer=clamp(steer+s.avoidSide*.25,-1,1);
 }
 // A blocked NPC that is not moving must not sit there turning forever.
 // First use a short climb/escape manoeuvre, THEN request a checkpoint-safe
 // rescue if no progress is observed. The rescue logic lives in main.js.
 s.progressAge+=delta;
 if(s.progressAge>=1.2){
  const moved=magnitude(subtract(p,s.progressAnchor||p));
  const distance=magnitude(subtract(plan.center,p));
  const madeProgress=distance<s.previousDistance-.8||moved>1.15;
  if(madeProgress)s.stuckFor=Math.max(0,s.stuckFor-1.6);
  else if(!trafficBrake||s.gateTime>7)s.stuckFor+=s.progressAge;
  s.previousDistance=distance;s.progressAnchor={...p};s.progressAge=0;
 }
 // Age-based circuit breaker catches continuous circles that make lots of
 // motion but cannot align with the next ring. Gate timer resets on crossing.
 const gateTimeBudget=Math.max(24,15+3.4*s.gateStartDistance/Math.max(3.3,paceInfo.maxSpeed));
 const lost=s.stuckFor>cfg.stuckTime || s.gateTime>gateTimeBudget;
 if(lost&&s.escapeFor<=0){s.escapeFor=2.4;s.reapproaches++;s.commit=false;}
 if(s.escapeFor>0){
  phase='UNSTICK';s.phase=phase;s.escapeFor=Math.max(0,s.escapeFor-delta);
  // Use real steering / forward force to get behind the entry face. No
  // teleporting or checkpoint advancement during the escape attempt.
  const ex=plan.entry.x-p.x,ez=plan.entry.z-p.z;
  steer=clamp(-wrap(Math.atan2(ex,ez)-fin(car.yaw))/.65,-1,1);
  throttle=Math.max(.70,throttle);
 }
 // After a physical escape try, a further sustained lack of progress invokes
 // controlled safe respawn at the CURRENT required ring's entry side.
 const rescue=s.rescueCooldown===0&&(s.stuckFor>cfg.stuckTime+5||s.gateTime>gateTimeBudget+10);
 if(rescue){s.stuckFor=0;s.gateTime=0;s.escapeFor=0;s.commit=false;s.rescueCooldown=8;s.rescueAttempts++;}
 // Drone pitch and hovercraft hop are not repurposed as altitude-hold buttons.
 // The physical controller follows npcAltitudeTarget using forces, while human
 // A/LB controls keep their previous exact meaning.
 // Commit to a passing line and vary the throttle away from the ring mouth.
 const racingRoom=!threat&&altitudeReady&&distHorizontal>8&&Math.abs(bearing)<.65;
 const rhythm=Math.sin(s.gateTime*1.6+idx*2.3+(Number(car.id?.slice(1))||0)*1.9);
 if(racingRoom&&!nearest && phase==='CROSS')throttle=clamp(throttle+.35*rhythm,-.72,1);
 const boost=phase==='CROSS'&&!nearest&&!threat&&altitudeReady&&Math.abs(bearing)<.16&&distHorizontal>8&&throttle>.40&&rhythm>0;
 const input={steer,throttle,drift:altitudeError>.45,descend:altitudeError<-.45,reset:false,boost,
  npcAltitudeTarget:targetAltitude,npcYawRateScale:cfg.turnRate};
 return {state:s,input,rescue,diagnostics:{phase,next:idx,wrongSide:plan.wrongSide,
  distance:Math.hypot(distHorizontal,elevation),elevation,bearing,targetSpeed:paceInfo.desiredSpeed,
  stuck:s.stuckFor,obstacle:obstacle?.distance??null,signed:plan.signed,lateral:plan.lateral,
  committed:s.commit,altitudeTarget:targetAltitude,altitudeReady,nearestNpc:nearest?.id??null,
  gateTime:s.gateTime,gateTimeBudget,effectivePace,reapproaches:s.reapproaches,rescues:s.rescueAttempts}};
}
