import './race-overlay.css';
export function attachTouch(controls,hud){
 const pad=document.createElement('div');
 pad.className='race-touch';
 for(const [name,key] of [['Left','KeyA'],['Right','KeyD'],['Brake','KeyS'],['Go','KeyW'],['Up','ShiftLeft'],['Down','KeyQ'],['Boost','Space'],['Reset','KeyR']]){
  const button=document.createElement('button');
  button.textContent=name;
  button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);controls.keys.add(key);};
  button.onlostpointercapture=()=>controls.keys.delete(key);
  pad.append(button);
 }
 hud.append(pad);
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
