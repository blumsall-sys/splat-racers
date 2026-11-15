// Browsers provide gamepads through the standard Gamepad API, not native XInput DLLs.
// P1 = WASD / pad 1, P2 = arrows / pad 2. The two keyboard channels never overlap.
// Controller: A/X hop or ascend; LB descend ONLY; B nitro; Y respawn; Start pause.
const WATCHED = new Set(['KeyW','KeyA','KeyS','KeyD','KeyR','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','KeyP','ShiftLeft','ShiftRight','ControlRight','Space','Numpad0','KeyM','KeyQ','KeyO','KeyJ','KeyL','KeyI','KeyK','Numpad4','Numpad6','Numpad8','Numpad2']);
const deadzone=(v,limit=.16)=>Math.abs(v)<limit?0:(Math.sign(v)*(Math.abs(v)-limit)/(1-limit));
const clamp=v=>Math.max(-1,Math.min(1,v));
export function fromKeys(keys,player){
  const a=player==='p1';
  const f=a?'KeyW':'ArrowUp',rev=a?'KeyS':'ArrowDown';
  const l=a?'KeyA':'ArrowLeft',r=a?'KeyD':'ArrowRight';
  const accelerate=keys.has(f),brake=keys.has(rev);
  return {throttle:Number(accelerate)-Number(brake),steer:Number(!!keys.has(r))-Number(!!keys.has(l)),
    accelerate,brake,drift:keys.has(a?'ShiftLeft':'ShiftRight')||(!a&&keys.has('ControlRight')),descend:keys.has(a?'KeyQ':'KeyO'),boost:a?keys.has('Space'):(keys.has('Numpad0')||keys.has('KeyM'))};
}
export function fromPad(pad){
  if(!pad || !pad.connected) return {throttle:0,steer:0,reset:false,drift:false,boost:false,descend:false,accelerate:false,brake:false};
  const buttons=pad.buttons||[];
  const trigger=i=>typeof buttons[i]==='object'?Math.max(Number(buttons[i]?.value||0),buttons[i]?.pressed?1:0):Number(buttons[i]||0);
  const throttle=trigger(7)-trigger(6);
  const steer=deadzone(Number(pad.axes?.[0]||0));
  const dpad=(trigger(15)>.5?1:0)-(trigger(14)>.5?1:0);
  const fwd=(trigger(12)>.5?1:0)-(trigger(13)>.5?1:0);
  return {throttle:clamp(throttle+fwd),steer:clamp(steer||dpad),reset:trigger(3)>.5,
    accelerate:trigger(7)>.1||fwd>0,brake:trigger(6)>.1||fwd<0,
    drift:trigger(0)>.5||trigger(2)>.5,descend:trigger(4)>.5,boost:trigger(1)>.5};
}
export class Controls {
  constructor(){
    this.keys=new Set();this.resetLatch={p1:false,p2:false};this.padLatch={p1:false,p2:false};
    this.padNames=[];this.padSlots=[null,null];
    // Ignore an A/X/LB confirmation still held after entering or resuming a race.
    // Each player/pad becomes armed as soon as those buttons are released.
    this.driftGate={p1:false,p2:false};this.boostGate={p1:false,p2:false};this.keydown=e=>{
      if(WATCHED.has(e.code)&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target?.tagName)){
        e.preventDefault();this.keys.add(e.code);
      }
    };
    this.keyup=e=>{if(WATCHED.has(e.code)){e.preventDefault();this.keys.delete(e.code);}};
    this.blur=()=>this.keys.clear();
    window.addEventListener('keydown',this.keydown,{passive:false});
    window.addEventListener('keyup',this.keyup,{passive:false});
    window.addEventListener('blur',this.blur);
  }
  getPads(){const all=typeof navigator.getGamepads==='function'?Array.from(navigator.getGamepads()||[]):[];const live=all.map((pad,index)=>pad?.connected?index:-1).filter(index=>index>=0);
    this.padSlots=this.padSlots.map(index=>live.includes(index)?index:null);
    for(const index of live){const free=this.padSlots.indexOf(null);if(free>=0&&!this.padSlots.includes(index))this.padSlots[free]=index;}
    return this.padSlots.map(index=>all[index]);}
  beginRace(){this.driftGate.p1=true;this.driftGate.p2=true;this.boostGate.p1=true;this.boostGate.p2=true;}
  sample(){
    const pads=this.getPads();this.padNames=pads.filter(Boolean).map(x=>x.id||'Controller');
    return Object.fromEntries(['p1','p2'].map((id,index)=>{
      const keys=fromKeys(this.keys,id),pad=fromPad(pads[index]);
      const touch=index===0?this.touch:null;
      if(touch?.accelerate||touch?.brake){
        keys.throttle=touch.brake?-1:1;keys.accelerate=touch.accelerate;keys.brake=touch.brake;
      }
      if(touch?.steer)keys.steer=touch.steer;
      keys.boost||=!!touch?.boost;keys.drift||=!!touch?.drift;keys.descend||=!!touch?.descend;
      const resetKey=id==='p1'?'KeyR':'Enter';
      if(!pad.drift)this.driftGate[id]=false;
      if(!pad.boost)this.boostGate[id]=false;
      const keyReset=this.keys.has(resetKey),padReset=pad.reset;
      const justKey=keyReset&&!this.resetLatch[id],justPad=padReset&&!this.padLatch[id];
      this.resetLatch[id]=keyReset;this.padLatch[id]=padReset;
      // Keyboard takes precedence per axis when active, preserving two players on one keyboard.
      const cameraKeys=index?['Numpad4','Numpad6','Numpad8','Numpad2']:['KeyJ','KeyL','KeyI','KeyK'];
      const cameraAxis=(axis,negative,positive)=>clamp(deadzone(pads[index]?.axes?.[axis]||0)+Number(this.keys.has(cameraKeys[positive]))-Number(this.keys.has(cameraKeys[negative])));
      return [id,{cameraX:cameraAxis(2,0,1),cameraY:cameraAxis(3,2,3),throttle:keys.accelerate||keys.brake?keys.throttle:pad.throttle,
        steer:keys.steer||pad.steer,reset:justKey||justPad,
        accelerate:keys.accelerate||pad.accelerate,brake:keys.brake||pad.brake,
        drift:keys.drift||(!this.driftGate[id]&&pad.drift),descend:keys.descend||pad.descend,boost:keys.boost||(!this.boostGate[id]&&pad.boost)}];
    }));
  }
  destroy(){window.removeEventListener('keydown',this.keydown);window.removeEventListener('keyup',this.keyup);window.removeEventListener('blur',this.blur);}
}
