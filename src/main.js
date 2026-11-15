import {STEP,makeWorld,stepWorld,resetBody} from './physics/engine.js';
import {SceneRenderer} from './render/scene.js';
import {Controls} from './input/controls.js';
import {DEFAULT_TRACK,loadTrack} from './track/track.js';
import {loadPack} from './assets/asset-pack.js';
const byId=id=>document.getElementById(id);
const canvas=byId('viewport'),overlay=byId('menu'),gameBar=byId('game-hud');
const title=byId('menu-title'),sub=byId('menu-subtitle'),debug=byId('debug-data');
const soloButton=byId('solo-btn'),localButton=byId('local-btn'),resumeButton=byId('resume-btn');
const pauseButton=byId('pause-btn'),restartButton=byId('restart-btn'),debugButton=byId('debug-btn');
const status=byId('status'),winScreen=byId('win-screen');
let renderer,controls,world=null,mode=null,paused=true,track=DEFAULT_TRACK,difficulty='medium';
let prev=performance.now(),accumulator=0,lastFps=60,frames=0,fpsAt=performance.now(),uiAt=0;
const pendingReset={p1:false,p2:false};
let debugVisible=new URLSearchParams(location.search).has('debug');
function updateMenu(){
  overlay.hidden=!paused || !!world?.race?.finished;
  winScreen.hidden=!world?.race?.finished;
  resumeButton.hidden=!world;
  title.textContent=world?'PAUSED':'SPLAT RACERS';
  sub.textContent=world?'Choose a mode, or return to your circuit.':'One screen. Two bumper cars. One very bouncy training track.';
  gameBar.hidden=!world;
}
function start(which){
  try{
    difficulty=byId('ai-difficulty').value;
    world=makeWorld(which,{track,difficulty});mode=which;
    byId('error-box').hidden=true;byId('error-restart').hidden=true;
    renderer.cameras={};
    accumulator=0;prev=performance.now();paused=false;pendingReset.p1=false;pendingReset.p2=false;
    status.textContent=which==='local'?'Local race · split-screen · first to five laps':'Solo race · '+difficulty+' AI · first to five laps';
    updateMenu();
    // Release stale key presses when changing modes to avoid phantom throttle.
    controls.keys.clear();
  }catch(e){showError(e);}
}
function showError(error){
  paused=true;updateMenu();
  status.textContent='Game error: '+(error?.message||error);
  console.error('[Splat Racers]',error);
  byId('error-box').hidden=false;
  byId('error-box').textContent=`Could not run: ${error?.message||error}. Open Chrome Console (F12) for details.`;
  byId('error-restart').hidden=false;
}
function pause(value=true){if(!world||world.race.finished)return;paused=value;updateMenu();if(!paused){prev=performance.now();accumulator=0;controls.keys.clear();}}
function updateHUD(now){
  if(now-uiAt<100)return;uiAt=now;
  const get=id=>world?.bodies.find(b=>b.id===id);
  const p1=get('p1'),p2=get('p2');
  byId('p1-speed').textContent=p1?`${Math.round(Math.hypot(p1.vx,p1.vz)*3.6)} km/h`:'0 km/h';
  byId('p2-speed').textContent=p2?`${Math.round(Math.hypot(p2.vx,p2.vz)*3.6)} km/h`:'0 km/h';
  byId('p2-panel').hidden=false;
  byId('p1-laps').textContent=`Lap ${world.race.per.p1.laps} / ${world.race.lapsToWin}`;
  byId('p2-laps').textContent=`${mode==='solo'?'NPC':'P2'} · Lap ${world.race.per.p2.laps} / ${world.race.lapsToWin}`;
  byId('mode-label').textContent=mode==='local'?'2-PLAYER LOCAL':'1-PLAYER SOLO';
  byId('gamepad-hint').textContent=controls.padNames.length?`${controls.padNames.length} gamepad(s) detected`:'Keyboard ready · plug in a controller';
  const hasDebug=debugVisible;
  debug.hidden=!hasDebug;
  if(hasDebug){
    debug.textContent=`FPS ${lastFps} | physics ${world.ticks} steps | contacts ${world.contacts} | AI ${difficulty}\n`+
      `P1: x ${p1.x.toFixed(2)} z ${p1.z.toFixed(2)} vx ${p1.vx.toFixed(2)} vz ${p1.vz.toFixed(2)} | W/S ${p1.input.throttle.toFixed(1)} A/D ${p1.input.steer.toFixed(1)}\n`+
      `P2: x ${p2.x.toFixed(2)} z ${p2.z.toFixed(2)} vx ${p2.vx.toFixed(2)} vz ${p2.vz.toFixed(2)} | arrows ${p2.input.throttle.toFixed(1)} / ${p2.input.steer.toFixed(1)}\n`+
      `P1 gate ${world.race.per.p1.next} lap ${world.race.per.p1.laps} | P2 gate ${world.race.per.p2.next} lap ${world.race.per.p2.laps}\n`+
      `P1 tire roll ${p1.wheelAngles[0].toFixed(2)} rad | front steer ${p1.steerVisual.toFixed(2)} rad | P2 tire roll ${p2.wheelAngles[0].toFixed(2)} rad | front steer ${p2.steerVisual.toFixed(2)} rad`; 
  }
}
function frame(now){
  requestAnimationFrame(frame);
  try{
    const delta=Math.min((now-prev)/1000,0.06);prev=now;
    frames++;if(now-fpsAt>1000){lastFps=Math.round(frames*1000/(now-fpsAt));frames=0;fpsAt=now;}
    if(!world){renderer?.resize();return;}
    const escapePressed=controls.keys.has('Escape');
    if(escapePressed&&!frame.escLatch){pause(!paused);}
    frame.escLatch=escapePressed;
    if(!paused){
      accumulator+=delta;
      let steps=0;
      // Poll every frame; cached controls supply stable input to each fixed physics step.
      const inputs=controls.sample();
      pendingReset.p1 ||= inputs.p1.reset;pendingReset.p2 ||= inputs.p2.reset;
      while(accumulator>=STEP&&steps<8){
        stepWorld(world,{p1:{...inputs.p1,reset:pendingReset.p1},p2:{...inputs.p2,reset:pendingReset.p2}},STEP);
        pendingReset.p1=false;pendingReset.p2=false;
        accumulator-=STEP;steps++;
        if(world.race.finished){
          paused=true;controls.keys.clear();
          const win=world.race.winner;
          byId('winner-name').textContent=(win==='p1'?'PLAYER 1':(mode==='solo'?'NPC RACER':'PLAYER 2'))+' WINS!';
          byId('winner-stats').textContent=`First to ${world.race.lapsToWin} laps · P1 ${world.race.per.p1.laps} / ${world.race.per.p2.laps} ${mode==='solo'?'NPC':'P2'} · ${Math.round(world.elapsed)} seconds`;
          updateMenu();break;
        }
      }
      if(steps===8)accumulator=0; // avoid runaway catch-up after tab sleep
    }else{controls.sample();}
    renderer.draw(world,mode==='local'?['p1','p2']:['p1'],delta);
    updateHUD(now);
  }catch(error){
    if(!paused)showError(error);
  }
}
function initialize(){
  try{
    renderer=new SceneRenderer(canvas);
    controls=new Controls();
    byId('ai-difficulty').addEventListener('change',()=>{difficulty=byId('ai-difficulty').value;if(world?.mode==='solo'){world.difficulty=difficulty;status.textContent='NPC difficulty: '+difficulty+' (updated live)';}});
    soloButton.addEventListener('click',()=>start('solo'));
    localButton.addEventListener('click',()=>start('local'));
    resumeButton.addEventListener('click',()=>pause(false));
    pauseButton.addEventListener('click',()=>pause());
    restartButton.addEventListener('click',()=>{if(mode)start(mode);});
    byId('play-again-btn').addEventListener('click',()=>start(mode||'solo'));
    byId('win-menu-btn').addEventListener('click',()=>{world=null;paused=true;mode=null;updateMenu();status.textContent='Select a mode for a new race.';});
    debugButton.addEventListener('click',()=>{debugVisible=!debugVisible;updateHUD(performance.now()+101);});
    byId('error-restart').addEventListener('click',()=>{byId('error-box').hidden=true;byId('error-restart').hidden=true;start(mode||'solo');});
    updateMenu();
    // Any exported Blender track is an optional sidecar replacement for the default.
    loadTrack(new URL('../assets/track.json',import.meta.url)).then(value=>{
      track=value;status.textContent='Track ready: '+(track.title||track.id);
    }).catch(error=>{console.warn('Track sidecar load failed; using packaged default',error);status.textContent='Using built-in training track; custom track unavailable: '+error.message;});
    loadPack(renderer).then(result=>{
      if(result.rendered && result.staticMeshes)status.textContent='Blender GLB assets linked · '+result.staticMeshes+' meshes · '+(result.pack.packId||'asset pack');
      else if(result.pack.splat?.sog)console.info('SOG is staged in pack; requires future gsplat renderer.');
    }).catch(e=>{console.warn('Optional asset pack unavailable:',e);});
    requestAnimationFrame(frame);
    // This is a read-only automated smoke-test hook, not gameplay state persistence.
    window.__splatRacersTest=Object.freeze({
      state:()=>({mode,paused,ticks:world?.ticks||0,contacts:world?.contacts||0,
        renderer:renderer?.fallback?'software':'webgl',difficulty,race:world?.race?JSON.parse(JSON.stringify(world.race)):null,
        cars:world?.bodies.map(({id,kind,x,z,vx,vz,y,yaw,steerVisual,wheelAngles})=>({id,kind,x,z,vx,vz,y,yaw,steerVisual,wheelAngles}))||[]}),
      startSolo:()=>start('solo'),startLocal:()=>start('local')
    });
  }catch(error){console.error(error);status.textContent='Renderer initialization failed: '+error.message;byId('error-box').hidden=false;byId('error-box').textContent='WebGL is unavailable: '+error.message;}
}
initialize();
