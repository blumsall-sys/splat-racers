import * as pc from 'playcanvas';

/** Nonphysical P1 lime / P2 coral beacons. They overlay any baked Blender ring
 * art, keeping the two players' NEXT targets independent. Zero collision.
 */
const PALETTE={p1:[.70,1,.34],p2:[1,.48,.36]};
function material(tint){
 const m=new pc.StandardMaterial();m.useLighting=false;
 m.diffuse=new pc.Color(...tint);m.emissive=new pc.Color(...tint);m.emissiveIntensity=1.35;
 m.update();return m;
}
function beam(parent,p,q,width,mat){
 const a=new pc.Vec3(p.x,p.y,p.z),b=new pc.Vec3(q.x,q.y,q.z);
 const e=new pc.Entity('Next checkpoint light — no collider');parent.addChild(e);
 e.setPosition(a.clone().add(b).mulScalar(.5));e.lookAt(b);
 e.addComponent('render',{type:'box',material:mat,castShadows:false});
 e.setLocalScale(width,width,Math.max(.05,a.distance(b)));
 return e;
}
export function makeCheckpointMarkers(app){
 const markers={};
 for(const id of ['p1','p2']){
  const root=new pc.Entity('Next '+id.toUpperCase()+' gate visual — NO PHYSICS');app.root.addChild(root);
  const mat=material(PALETTE[id]);markers[id]={root,mat,key:null};root.enabled=false;
 }
 function update(id,target,roadY,time){
  const item=markers[id];if(!item)return;
  if(!target){item.root.enabled=false;item.key=null;return;}
  item.root.enabled=true;
  const key=target.kind+':'+target.id;
  if(item.key!==key){
   for(const child of [...item.root.children])child.destroy();
   item.key=key;
   if(target.kind==='AIR'){
    const n=new pc.Vec3(...target.gate.normal);
    let u=new pc.Vec3().cross(new pc.Vec3(0,1,0),n);
    if(u.length()<.1)u=new pc.Vec3(1,0,0);u.normalize();
    const v=new pc.Vec3().cross(n,u).normalize();
    const center=new pc.Vec3(...target.gate.position),segments=30;
    // Distinct slightly enlarged halos even when both players need the same ring.
    const radius=target.gate.radius+(id==='p1'?.22:.43);
    for(let i=0;i<segments;i++){
     const a=i*2*Math.PI/segments,b=(i+1)*2*Math.PI/segments;
     const p=center.clone().add(u.clone().mulScalar(Math.cos(a)*radius)).add(v.clone().mulScalar(Math.sin(a)*radius));
     const q=center.clone().add(u.clone().mulScalar(Math.cos(b)*radius)).add(v.clone().mulScalar(Math.sin(b)*radius));
     beam(item.root,p,q,.13,item.mat);
    }
    // Entry -> exit arrow above the aperture. Unlike a coloured hoop alone,
    // this shows the required one-way crossing normal to each player.
    // Pure render geometry; the plane test and collision are unaffected.
    const arrowCenter=center.clone().add(v.clone().mulScalar(radius*.68));
    const tip=arrowCenter.clone().add(n.clone().mulScalar(Math.min(radius*.55,1.8)));
    const tail=arrowCenter.clone().sub(n.clone().mulScalar(Math.min(radius*.55,1.8)));
    beam(item.root,tail,tip,.10,item.mat);
    for(const sign of [-1,1]){
     const wing=tip.clone().sub(n.clone().mulScalar(Math.min(.62,radius*.2))).add(u.clone().mulScalar(sign*Math.min(.36,radius*.15)));
     beam(item.root,tip,wing,.10,item.mat);
    }
   }else{
    const g=target.gate,y=Number.isFinite(roadY)?roadY:target.position.y;
    // Elevated goal line and posts are legible even on a banked road.
    beam(item.root,{x:g.a.x,y:y+2.2,z:g.a.z},{x:g.b.x,y:y+2.2,z:g.b.z},.16,item.mat);
    for(const p of [g.a,g.b])beam(item.root,{x:p.x,y:y+.2,z:p.z},{x:p.x,y:y+3,z:p.z},.11,item.mat);
   }
  }
  if(Number.isFinite(time)){
   const brightness=1.55+.55*Math.sin(time*3.6+(id==='p1'?0:1.5));
   if(Math.abs(brightness-item.mat.emissiveIntensity)>.07){item.mat.emissiveIntensity=brightness;item.mat.update();}
  }
 }
 return {markers,update,destroy:()=>Object.values(markers).forEach(i=>i.root.destroy())};
}
