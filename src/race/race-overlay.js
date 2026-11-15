import './race-overlay.css';
export function attachTouch(controls,hud,isFlying){
 const pad=document.createElement('div');
 pad.className='race-touch';
 pad.innerHTML='<div class="thumb-stick" aria-label="Steering joystick"><span class="stick-tip"></span><b>STEER</b></div><div class="pedals"><button data-action="boost">Turbo</button><button data-action="gas">Gas</button><button data-action="brake">Brake</button></div>';
 hud.append(pad);
 const stick=pad.querySelector('.thumb-stick'),tip=pad.querySelector('.stick-tip');
 let stickId=null;
 const fingers=new Map();
 const state=controls.touch={};
 function center(){
  stickId=null;state.steer=0;state.drift=false;state.descend=false;
  tip.style.transform='';
 }
 function pedals(){
  const actions=new Set(fingers.values());
  state.boost=actions.has('boost');state.brake=actions.has('brake');
  state.accelerate=!state.brake&&(actions.has('gas')||state.boost);
  for(const b of pad.querySelectorAll('button'))b.classList.toggle('pressed',actions.has(b.dataset.action));
 }
 function clear(){center();fingers.clear();pedals();}
 function move(e){
  const box=stick.getBoundingClientRect(),r=box.width/2;
  const dx=(e.clientX-box.left-r)/r,dy=(e.clientY-box.top-r)/r;
  const scale=Math.max(1,Math.hypot(dx,dy));
  state.steer=Math.abs(dx)<.10?0:Math.sign(dx)*Math.min(1,(Math.abs(dx)-.10)/.65);
  state.drift=dy<(isFlying()?-.36:-.8);state.descend=isFlying()&&dy>.36;
  tip.style.transform='translate('+dx/scale*r*.62+'px,'+dy/scale*r*.62+'px)';
 }
 stick.onpointerdown=e=>{if(stickId!==null)return;e.preventDefault();stickId=e.pointerId;stick.setPointerCapture(stickId);move(e);};
 stick.onpointermove=e=>{if(e.pointerId===stickId)move(e);};
 stick.onlostpointercapture=e=>{if(e.pointerId===stickId)center();};
 const cluster=pad.querySelector('.pedals');
 const actionAt=e=>document.elementFromPoint(e.clientX,e.clientY)?.closest('.pedals button')?.dataset.action;
 cluster.onpointerdown=e=>{if(!actionAt(e))return;e.preventDefault();cluster.setPointerCapture(e.pointerId);fingers.set(e.pointerId,actionAt(e));pedals();};
 cluster.onpointermove=e=>{if(fingers.has(e.pointerId)){fingers.set(e.pointerId,actionAt(e));pedals();}};
 cluster.onlostpointercapture=e=>{fingers.delete(e.pointerId);pedals();};
 window.addEventListener('blur',clear);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
 new MutationObserver(()=>{clear();stick.querySelector('b').textContent=isFlying()?'STEER / ALT':'STEER';}).observe(hud,{attributes:true,attributeFilter:['hidden']});
}
export function drawMap(hud,track,racers){
 const points=track.race.waypoints;
 if(!points?.length)return;
 let canvas=hud.querySelector('.race-map');
 if(!canvas){
  canvas=document.createElement('canvas');
  canvas.className='race-map';canvas.width=280;canvas.height=192;
  canvas.setAttribute('aria-label','Course and live racer positions');
  hud.append(canvas);
 }
 const all=[...points,...racers];
 const xs=all.map(p=>p.x),zs=all.map(p=>p.z);
 const left=Math.min(...xs),top=Math.min(...zs);
 const width=Math.max(...xs)-left,height=Math.max(...zs)-top;
 const scale=Math.min(236/Math.max(1,width),156/Math.max(1,height));
 const x=p=>140+(p.x-left-width/2)*scale;
 const y=p=>96+(p.z-top-height/2)*scale;
 const ctx=canvas.getContext('2d');
 ctx.clearRect(0,0,280,192);ctx.beginPath();
 points.forEach((p,i)=>i?ctx.lineTo(x(p),y(p)):ctx.moveTo(x(p),y(p)));
 ctx.closePath();ctx.strokeStyle='#a0b0af';ctx.lineWidth=5;ctx.stroke();
 for(const [i,p] of racers.entries()){
  ctx.fillStyle=['#c5fb82','#ff977a','#91c9ff','#ffdf72'][i%4];
  ctx.beginPath();ctx.arc(x(p),y(p),7,0,Math.PI*2);ctx.fill();
  ctx.font='bold 16px sans-serif';ctx.strokeStyle='#12252a';ctx.lineWidth=3;
  const label=p.isNpc?'N'+p.id.slice(1):p.id.toUpperCase();ctx.strokeText(label,x(p)-9,y(p)-9);ctx.fillText(label,x(p)-9,y(p)-9);
 }
}
export function showEffects(app,pc,track){
 for(const zone of track.race.effects||[]){
  const speed=zone.kind==='speed';
  const material=new pc.StandardMaterial();
  material.diffuse=speed?new pc.Color(.25,1,.55):new pc.Color(.43,.15,.65);
  material.opacity=speed?.85:.58;material.blendType=pc.BLEND_NORMAL;material.update();
  const marker=new pc.Entity(speed?'Speed Blast':'Grease Cloud');
  marker.addComponent('render',{type:speed?'cylinder':'sphere',material});
  marker.setPosition(zone.x,zone.y+(speed?.13:.7),zone.z);
  marker.setLocalScale(zone.radius*2,speed?.22:1.4,zone.radius*2);
  app.root.addChild(marker);
 }
}
