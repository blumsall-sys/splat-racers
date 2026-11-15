import * as pc from 'playcanvas';
import {assetURL} from './pack-contract.js';
import {applySogAnchorTransform} from './sog-transform.js';
import {matrixDecomposeColumnMajor} from './pack-contract.js';
import {loadSogAsset,versionedSogUrl} from './sog-loader.js';
import {setSplatCalibration} from './pc-scene.js';
import {readStoredCalibration} from './sog-calibration-store.js';
import {validateAlignment} from './ground-check.js';
const $=id=>document.getElementById(id),base=import.meta.env.BASE_URL;
async function readJson(path){const r=await fetch(new URL(base+path,location.origin),{cache:'no-store'});if(!r.ok)throw Error(path+' HTTP '+r.status);return r.json();}
let app;
async function begin(){
 const info=$('sog-message');
 try{
  const [pack,alignment]=await Promise.all([readJson('assets/asset-pack.json'),readJson('assets/splat-alignment.json')]);
  if(!pack.splat?.sog)throw Error('No SOG linked in assets/asset-pack.json. Re-export with the Blender SOG file field populated.');
  $('sog-file').textContent=pack.splat.sog+' · '+(pack.splat.sogSha256?.slice(0,16)||'no hash');
  const anchor=matrixDecomposeColumnMajor(pack.splat.anchorMatrixColumnMajor);
  const origin=anchor?.position??[0,0,0],scale=anchor?Math.max(...anchor.scale.map(Math.abs)):1;
  const canvas=$('preview');
  app=new pc.Application(canvas,{graphicsDeviceOptions:{antialias:false,alpha:false}});
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.graphicsDevice.maxPixelRatio=Math.min(1.5,window.devicePixelRatio||1);
  const camera=new pc.Entity('Orbit camera');camera.addComponent('camera',{clearColor:new pc.Color(.08,.13,.17),nearClip:.05,farClip:2000,fov:70});app.root.addChild(camera);
  app.start();if(app.scene.gsplat)app.scene.gsplat.splatBudget=5000000;
  info.textContent='Loading SOG through PlayCanvas gsplat handler…';
  const url=versionedSogUrl(assetURL(base,pack.splat.sog),pack);
  const asset=await loadSogAsset(app,pc,url);
  const group=new pc.Entity('Browser fine SOG adjustment');app.root.addChild(group);
  const splat=new pc.Entity('Blender-placed SOG');group.addChild(splat);
  splat.addComponent('gsplat',{asset});applySogAnchorTransform(splat,pack.splat.anchorMatrixColumnMajor,pc);
  setSplatCalibration(group,validateAlignment(alignment));
  info.className='loaded';info.textContent='SOG decoded and attached successfully. If invisible, adjust orbit/zoom or inspect the placement transform.';
  let yaw=0.7,pitch=.28,dist=Math.max(12,Math.min(1500,18*scale)),drag=false,lastX=0,lastY=0;
  function reset(){yaw=.7;pitch=.28;dist=Math.max(12,Math.min(1500,18*scale));}
  $('reset-view').addEventListener('click',reset);
  canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointerup',()=>drag=false);
  canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-lastX)*.007;pitch=Math.max(-1.45,Math.min(1.45,pitch+(e.clientY-lastY)*.007));lastX=e.clientX;lastY=e.clientY;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(.1,Math.min(10000,dist*Math.exp(e.deltaY*.001)));},{passive:false});
  app.on('update',()=>{const cp=Math.cos(pitch);camera.setPosition(origin[0]+dist*Math.sin(yaw)*cp,origin[1]+dist*Math.sin(pitch),origin[2]+dist*Math.cos(yaw)*cp);camera.lookAt(...origin);});
  window.addEventListener('resize',()=>app.resizeCanvas());
  window.__LAB5_SOG_INSPECT={pack:pack.packId,url,sogAsset:asset,splat,anchor:anchor?.matrix??null};
 }catch(err){console.error('[LAB5 SOG Inspector]',err);info.className='failed';info.textContent='FAILED: '+(err?.message||String(err));}
}
begin();
