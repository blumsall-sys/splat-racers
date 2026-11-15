/** Gamepad menu navigation independent of app.timeScale/Ammo update.
 * Left stick or D-pad navigates focus; A/X/Start confirms; B returns.
 * ONLY Start opens pause while racing. B is Back only inside visible menus.
 * A/X are reserved for hop/drift during racing and confirm while a menu is visible.
 * Polls via requestAnimationFrame even while the game simulation is paused.
 */
export function menuPadIntent(pad){
 if(!pad?.connected)return {vertical:0,horizontal:0,confirm:false,confirmA:false,confirmX:false,start:false,back:false};
 const btn=pad.buttons||[];
 // Some browser/controller combinations set pressed=true with value=0.
 // Treat either signal as a press, and never depend on physics timeScale.
 const v=i=>typeof btn[i]==='number'?btn[i]:Math.max(Number(btn[i]?.value||0),btn[i]?.pressed?1:0);
 const y=Number(pad.axes?.[1]||0),x=Number(pad.axes?.[0]||0);
 const confirmA=v(0)>.5,confirmX=v(2)>.5,start=v(9)>.5;
 return {
  vertical:(y>.55||v(13)>.5?1:0)-(y<-.55||v(12)>.5?1:0),
  horizontal:(x>.55||v(15)>.5?1:0)-(x<-.55||v(14)>.5?1:0),
  confirm:confirmA||confirmX||start,
  confirmA,confirmX,start,
  back:v(1)>.5
 };
}
export class GamepadMenuNavigator {
 constructor({getRoot,onBack=()=>{},onPause=()=>{},getPads=()=>navigator.getGamepads?.()||[],raf=fn=>requestAnimationFrame(fn)}={}){
  this.getRoot=getRoot;this.onBack=onBack;this.onPause=onPause;this.getPads=getPads;this.raf=raf;
  this.previous={vertical:0,horizontal:0,confirm:false,confirmA:false,confirmX:false,start:false,back:false};
  this.previousPads=[];this.nextAllowed=0;this.selected=null;this.activeRoot=null;this.running=true;
  this.tick=this.tick.bind(this);this.raf(this.tick);
 }
 available(root){return [...root.querySelectorAll('button,select')].filter(el=>!el.disabled&&!el.hidden&&!el.closest('[hidden]'));}
 focus(el){if(this.selected)this.selected.classList.remove('gamepad-focused');this.selected=el;if(el){el.classList.add('gamepad-focused');el.focus({preventScroll:true});}}
 tick(){
  if(!this.running)return;
  const root=this.getRoot?.();
  // The race, pause, and checkered-flag menus are different focus groups.
  // Drop stale highlights as soon as the visible overlay changes.
  if(root!==this.activeRoot){this.focus(null);this.activeRoot=root;this.nextAllowed=0;}
  const pads=Array.from(this.getPads()||[]).filter(x=>x?.connected);
  const intents=pads.map(menuPadIntent);
  // Either local player may pause or confirm, independently of the other pad's held buttons.
  const rising=button=>intents.some((intent,i)=>intent[button]&&!this.previousPads[i]?.[button]);
  // Whichever controller is navigating gets focus authority; don't consume
  // Player 2 menu inputs simply because Player 1's controller is connected.
  const navigating=intents.findIndex(intent=>intent.vertical||intent.horizontal);
  const padIndex=navigating>=0?navigating:Math.max(0,pads.findIndex(p=>p.mapping==='standard'));
  const current=intents[padIndex]||menuPadIntent(null);
  const pad=pads[padIndex];
  if(!root){
   this.focus(null);
   // Start is the ONLY gamepad pause button during racing.
   // B is intentionally inert here; it retains Back while an overlay is visible.
   // A/X are exclusively hop/drift in the driving controls, never hidden clicks.
   if(rising('start'))this.onPause();
   this.previous=current;this.previousPads=intents;this.raf(this.tick);return;
  }
  const elements=this.available(root);
  if(!elements.includes(this.selected))this.focus(null);
  if(pad&&elements.length){
   const now=typeof performance!=='undefined'?performance.now():Date.now();
   const vertical=current.vertical;
   const horizontal=current.horizontal;
   const moved=vertical||horizontal;
   const changed=vertical!==this.previous.vertical||horizontal!==this.previous.horizontal;
   if(moved && (changed||now>=this.nextAllowed)){
    if(!this.selected)this.focus(elements[0]);
    else if(this.selected.tagName==='SELECT'&&horizontal){
     const opts=this.selected.options,step=horizontal;
     this.selected.selectedIndex=Math.max(0,Math.min(opts.length-1,this.selected.selectedIndex+step));
     this.selected.dispatchEvent(new Event('change',{bubbles:true}));
    }else{
     const direction=vertical||horizontal;
     const i=elements.indexOf(this.selected);
     this.focus(elements[(i+direction+elements.length)%elements.length]);
    }
    this.nextAllowed=now+230;
   }
   // Don't OR A, X and Start before edge detection: holding A for a hop at
   // the finish line could otherwise block a *new* Start press forever.
   // Treat each button as its own rising edge, while requiring release
   // and re-press of an already held button when the screen changes.
   const confirmed=rising('confirmA')||rising('confirmX')||rising('start');
   if(confirmed){
    if(!this.selected){this.focus(elements[0]);this.selected.click();}
    else if(this.selected.tagName==='SELECT'){
     // A on a select moves to the next option; left/right navigate options.
     this.selected.selectedIndex=(this.selected.selectedIndex+1)%this.selected.options.length;
     this.selected.dispatchEvent(new Event('change',{bubbles:true}));
    }else this.selected.click();
   }
   if(rising('back'))this.onBack();
  }
  this.previous=current;this.previousPads=intents;this.raf(this.tick);
 }
 destroy(){this.running=false;this.focus(null);}
}
