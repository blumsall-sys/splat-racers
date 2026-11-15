import {roadHeight} from '../physics/engine.js';
import {multiply,compose,lookAt,perspective,rotationX} from './math.js';
import {wheelPose,WHEEL_RADIUS} from '../vehicle/wheels.js';
const VERT=`attribute vec3 a_position; attribute vec3 a_normal;
uniform mat4 u_model, u_vp;
varying float v_light; varying float v_depth;
void main(){vec4 world=u_model*vec4(a_position,1.0);gl_Position=u_vp*world;
vec3 normal=normalize(mat3(u_model)*a_normal);
vec3 sunlight=normalize(vec3(-0.48,0.92,0.37));
v_light=0.57+0.43*max(0.0,dot(normal,sunlight));v_depth=gl_Position.w;}`;
const FRAG=`precision mediump float;
uniform vec4 u_color;varying float v_light;varying float v_depth;
void main(){float fog=clamp((v_depth-28.0)/95.0,0.0,0.55);
vec3 rgb=mix(u_color.rgb*v_light,vec3(0.105,0.23,0.27),fog);
gl_FragColor=vec4(rgb,u_color.a);}`;
function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('WebGL shader: '+gl.getShaderInfoLog(s));return s;}
function chaseEye(car){
  const f=[Math.sin(car.yaw),Math.cos(car.yaw)];
  const x=car.x-f[0]*6,z=car.z-f[1]*6;
  // Camera rises above guardrails when there is not enough space behind a car.
  const overshoot=Math.max(0,Math.abs(x)-15.25,Math.abs(z)-10.5);
  return [x,5.75+Math.min(8,overshoot*1.75)+Math.min(.7,Math.abs(car.speed)*.05),z];
}
function color(raw,alpha=1){const s=raw.replace('#','');const n=parseInt(s,16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,alpha];}
function cubeGeometry(){
  const faces=[
    [[0,0,1],[[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]]],
    [[0,0,-1],[[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]]],
    [[1,0,0],[[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]]],
    [[-1,0,0],[[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]],
    [[0,1,0],[[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]]],
    [[0,-1,0],[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]]]
  ];
  const arr=[];for(const [normal,verts] of faces)for(const i of [0,1,2,0,2,3])arr.push(...verts[i],...normal);
  return new Float32Array(arr);
}
export class SceneRenderer {
  constructor(canvas){
    this.canvas=canvas;
    const forceSoftware=new URLSearchParams(window.location.search).get('renderer')==='software';
    const gl=forceSoftware?null:(canvas.getContext('webgl',{antialias:true,alpha:false})||canvas.getContext('webgl2',{antialias:true,alpha:false}));
    if(!gl){this.fallback=new CanvasRenderer(canvas);this.cameras={};return;}
    this.gl=gl;
    const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,VERT));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.program=p;gl.useProgram(p);
    this.pos=gl.getAttribLocation(p,'a_position');this.normal=gl.getAttribLocation(p,'a_normal');
    this.model=gl.getUniformLocation(p,'u_model');this.vp=gl.getUniformLocation(p,'u_vp');this.tint=gl.getUniformLocation(p,'u_color');
    const buffer=gl.createBuffer();this.cubeBuffer=buffer;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,cubeGeometry(),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.pos);gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(this.normal);gl.vertexAttribPointer(this.normal,3,gl.FLOAT,false,24,12);
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
    this.cameras={};
  }
  bindCube(){
    const gl=this.gl;if(!gl)return;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.cubeBuffer);
    gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,24,0);
    gl.vertexAttribPointer(this.normal,3,gl.FLOAT,false,24,12);
  }
  assetMeshes(meshes,parent=null){
    const gl=this.gl;if(!gl||!meshes)return;
    for(const mesh of meshes){
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
      gl.vertexAttribPointer(this.pos,3,gl.FLOAT,false,24,0);
      gl.vertexAttribPointer(this.normal,3,gl.FLOAT,false,24,12);
      gl.uniformMatrix4fv(this.model,false,parent?multiply(parent,mesh.model):mesh.model);
      gl.uniform4fv(this.tint,mesh.color);
      gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }
  }
  resize(){if(this.fallback){this.fallback.resize();return;}const c=this.canvas,scale=Math.min(window.devicePixelRatio||1,1.7);const w=Math.max(1,Math.round(c.clientWidth*scale)),h=Math.max(1,Math.round(c.clientHeight*scale));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}}
  box(x,y,z,w,h,d,hex,yaw=0,alpha=1,pitch=0,roll=0,parent=null){
    const gl=this.gl;this.bindCube();
    const transform=compose(x,y,z,yaw,pitch,roll,w,h,d);
    gl.uniformMatrix4fv(this.model,false,parent?multiply(parent,transform):transform);
    gl.uniform4fv(this.tint,color(hex,alpha));
    if(alpha<1){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);}
    gl.drawArrays(gl.TRIANGLES,0,36);
    if(alpha<1){gl.disable(gl.BLEND);gl.depthMask(true);}
  }
  worldGeometry(world){
    if(world.track.visuals?.mode==='asset' && this.modelAssets?.static?.length){
      this.assetMeshes(this.modelAssets.static);
      // Wall collision boxes remain visible during the modular prototype.
      for(const w of world.walls)this.box(w.x,w.y??.46,w.z,w.hx*2,w.height??.92,w.hz*2,w.color||'#edb67b',w.yaw||0);
      return;
    }
    if(world.track.visuals?.mode==='boxes' || world.track.visuals?.mode==='asset'){
      // Blender-authored primitive visuals, expressed in the same Y-up coordinates
      // as collision boxes. Advanced GLB/SOG is NOT silently treated as cubes.
      for(const b of world.track.visuals.boxes||[])
        this.box(b.x,b.y||0,b.z,b.w,b.h,b.d,b.color||'#879a8d',b.yaw||0);
      for(const w of world.walls){
        const outer=w.id?.startsWith('outer');
        this.box(w.x,w.y??.46,w.z,w.hx*2,w.height??.92,w.hz*2,w.color|| (outer?'#f5a083':'#e7d77e'),w.yaw||0);
      }
      return;
    }
    this.box(0,-0.57,0,180,1,180,'#3c7865');
    this.box(0,-0.13,0,35.0,0.15,24.6,'#3b4658');
    // Texture-free stylized asphalt details and painted road separators.
    for(let i=-14;i<=14;i+=3.5){
      this.box(i,-0.035,-8.38,1.45,0.022,0.09,'#c9d5c6');
      this.box(i,-0.035,8.38,1.45,0.022,0.09,'#c9d5c6');
    }
    for(let i=-8;i<=8;i+=3.5){
      this.box(-13.15,-0.035,i,0.08,0.024,1.5,'#c9d5c6');
      this.box(13.15,-0.035,i,0.08,0.024,1.5,'#c9d5c6');
    }
    this.box(0,-0.01,0,18.9,0.22,8.95,'#397f65');
    this.box(0,0.11,0,17.4,0.16,7.7,'#4b9275');
    // Center island decorations: low poly trees and podiums.
    for(const [x,z,s] of [[-5,0,1.1],[0,1.4,1.3],[4,-1,1.0]]){
      this.box(x,0.45,z,0.30,0.9,0.30,'#946f4d');
      this.box(x,1.15,z,1.3*s,1.05*s,1.3*s,'#71b76d');
      this.box(x,1.75,z,0.72*s,0.78*s,0.72*s,'#91cf76');
    }
    for(const wall of world.walls){
      const outer=wall.id.startsWith('outer');
      this.box(wall.x,0.46,wall.z,wall.hx*2,0.92,wall.hz*2,outer?'#f5a083':'#e7d77e');
      this.box(wall.x,0.94,wall.z,wall.hx*2+0.035,0.12,wall.hz*2+0.035,outer?'#ffe5ac':'#fbf3ab');
    }
    // Finish stripe on the lower straight; wholly visual / not a wall.
    for(let k=0;k<7;k++)this.box(-4.7,-0.035,-10.75+k*0.69,0.37,0.022,0.67,k%2?'#f5edca':'#27323e');
    // Low raised road feature, modeled from multiple strips and sampled in physics.
    for(let i=-7;i<=7;i++){
      const x=6.8+i*0.19,ht=world.bodies[0]?.getHeight?.(x,-8.25)??roadHeight(x,-8.25);
      this.box(x,ht*0.5-0.055,-8.25,0.19,Math.max(.012,ht),3.9,'#e8b979');
    }
    for(const [x,z] of [[-15,-10],[-15,10],[15,-10],[15,10]]){
      this.box(x,0.33,z,0.5,0.66,0.5,'#fff4c4');
      this.box(x,0.77,z,0.28,0.32,0.28,'#ee7f74');
    }
  }
  checkpointStripes(world){
    // Visible directional gates; only src/race/laps.js decides whether a lap counts.
    for(const [i,g] of world.track.race.gates.entries()){
      const dx=g.b.x-g.a.x,dz=g.b.z-g.a.z,L=Math.hypot(dx,dz);
      this.box((g.a.x+g.b.x)/2,-.029,(g.a.z+g.b.z)/2,
        i===0?.36:.18,.026,L,i===0?'#f5f1cf':'#72c6cf',Math.atan2(dx,dz));
    }
  }
  wheel(pose) {
    // Wheel geometry lives in its own world-space assembly, not on the bouncing chassis.
    // Steering rotates only the front wheel assemblies, then rolling rotates around the axle.
    const assembly=multiply(compose(pose.x,pose.y,pose.z,pose.yaw),rotationX(pose.spin));
    const n=12,rad=WHEEL_RADIUS-0.0475;
    for(let i=0;i<n;i++){
      const a=2*Math.PI*i/n;
      this.box(0,-rad*Math.sin(a),rad*Math.cos(a),.34,.173,.095,
        (i%3===0?'#303942':'#202a32'),0,1,a,0,assembly);
    }
    // Visible wheel hub and unevenly colored spokes rotate with the tire.
    const exterior=pose.side>0?0.185:-0.185;
    this.box(exterior,0,0,.055,.15,.15,'#dde5df',0,1,0,0,assembly);
    for(let i=0;i<5;i++){
      const angle=2*Math.PI*i/5;
      this.box(exterior,0,0,.065,.055,.405,i===0?'#fbe0a0':'#8699a3',0,1,angle,0,assembly);
    }
    // One accent valve/mark helps a human see the wheel rotation at low speed.
    this.box(exterior+(pose.side>0?0.036:-0.036),0,.22,.045,.065,.085,'#f4c77a',0,1,0,0,assembly);
  }
  car(body){
    this.box(body.x,-0.048,body.z,1.84,0.012,2.65,'#142b31',body.yaw,0.35);
    const base=compose(body.x,body.y,body.z,body.yaw,body.pitch,body.roll);
    // The sprung car body moves independently of four road-following tire contact patches.
    for(const axle of [-1,1])for(const side of [-1,1]){
      const wheel=wheelPose(body,side,axle);
      const strutTop=body.y-0.095;
      const span=Math.abs(strutTop-wheel.y);
      if(span>0.025) this.box(wheel.x,(strutTop+wheel.y)/2,wheel.z,.12,span,.12,'#a1aeb1');
      this.wheel(wheel);
    }
    this.box(0,-0.065,0,1.43,.38,2.22,body.color,0,1,0,0,base);
    this.box(0,0.17,-0.48,1.28,.26,.78,body.color,0,1,0,0,base);
    this.box(0,0.33,0.35,1.03,.58,.89,'#f0ead7',0,1,0,0,base);
    this.box(0,0.66,0.31,1.1,.13,.92,body.color,0,1,0,0,base);
    this.box(0,0.22,1.07,1.45,.30,.22,'#faf3ca',0,1,0,0,base);
    this.box(0,0.16,-1.08,1.48,.25,.17,'#2f3b42',0,1,0,0,base);
    for(const x of [-0.48,0.48])this.box(x,0.28,1.12,.27,.11,.06,'#ffe1a9',0,1,0,0,base);
    this.box(0,0.58,0.20,.43,.35,.38,'#4a5c68',0,1,0,0,base);
    // Small fenders follow chassis suspension, but cannot drag the tires up from the road.
    for(const x of [-.78,.78])for(const z of [-.82,.82])
      this.box(x,-.055,z,.43,.12,.59,body.color,0,1,0,0,base);
  }
  crate(b){
    this.box(b.x,0.008,b.z,1.35,.014,1.35,'#172c31',b.yaw,0.32);
    const m=compose(b.x,b.y,b.z,b.yaw,b.pitch,b.roll);
    this.box(0,0,0,1.24,1.14,1.18,'#eac783',0,1,0,0,m);
    this.box(0,0.59,0,1.25,0.09,1.19,'#fff0b8',0,1,0,0,m);
    this.box(0.63,0,0,0.08,1.02,0.82,'#c38c56',0,1,0,0,m);
    this.box(-0.63,0,0,0.08,1.02,0.82,'#c38c56',0,1,0,0,m);
  }
  draw(world,playerIds,delta=1/60){
    if(this.fallback){this.fallback.cameras=this.cameras;this.fallback.draw(world,playerIds,delta);return;}
    const gl=this.gl;this.resize();gl.enable(gl.SCISSOR_TEST);
    const count=playerIds.length,w=this.canvas.width,h=this.canvas.height;
    const width=Math.floor(w/count);
    for(let i=0;i<count;i++){
      const x=i*width,ww=i===count-1?w-x:width;
      gl.viewport(x,0,ww,h);gl.scissor(x,0,ww,h);
      gl.clearColor(0.09,0.21,0.26,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const car=world.bodies.find(b=>b.id===playerIds[i]);
      if(!car)continue;
      const f=[Math.sin(car.yaw),Math.cos(car.yaw)];
      const targetEye=chaseEye(car);
      const cam=this.cameras[playerIds[i]]||(this.cameras[playerIds[i]]=[...targetEye]);
      const rate=1-Math.exp(-Math.min(delta,.08)*6);
      for(let k=0;k<3;k++)cam[k]+=(targetEye[k]-cam[k])*rate;
      const target=[car.x,0.52,car.z];
      const vp=multiply(perspective(56*Math.PI/180,ww/Math.max(1,h),0.1,170),lookAt(cam,target));
      gl.uniformMatrix4fv(this.vp,false,vp);
      this.worldGeometry(world);this.checkpointStripes(world);
      for(const b of world.bodies){
        if(b.kind==='car')this.car(b);
        else if(this.modelAssets?.dynamic?.has(b.id))this.assetMeshes(this.modelAssets.dynamic.get(b.id),compose(b.x,b.y,b.z,b.yaw,b.pitch,b.roll));
        else this.crate(b);
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  }
}

// Software-rendered fallback: keeps local training functional when a browser blocks
// WebGL entirely. Same track, cameras, karts and physics. Perspective cuboid faces
// are depth-sorted on a 2D canvas; no shaders or external packages required.
class CanvasRenderer {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.cameras={};this.faces=[];this.vp=null;this.region=null;}
  resize(){const c=this.canvas,dpr=Math.min(window.devicePixelRatio||1,1.5);const w=Math.max(1,Math.round(c.clientWidth*dpr)),h=Math.max(1,Math.round(c.clientHeight*dpr));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}}
  box(x,y,z,w,h,d,hex,yaw=0,alpha=1,pitch=0,roll=0,parent=null){
    const m0=compose(x,y,z,yaw,pitch,roll,w,h,d),model=parent?multiply(parent,m0):m0;
    const m=multiply(this.vp,model);
    const pt=(a,b,c)=>{
      const q=[a,b,c,1],t=[0,0,0,0];for(let col=0;col<4;col++)for(let row=0;row<4;row++)t[row]+=m[col*4+row]*q[col];
      if(t[3]<0.1)return null;
      const ndcx=t[0]/t[3],ndcy=t[1]/t[3];
      return [this.region.x+(ndcx*.5+.5)*this.region.w,this.region.y+(1-(ndcy*.5+.5))*this.region.h,t[3]];
    };
    const v=[pt(-.5,-.5,-.5),pt(.5,-.5,-.5),pt(.5,-.5,.5),pt(-.5,-.5,.5),
      pt(-.5,.5,-.5),pt(.5,.5,-.5),pt(.5,.5,.5),pt(-.5,.5,.5)];
    const faces=[[[4,5,6,7],1.11],[[0,1,2,3],.48],[[3,2,6,7],.86],[[1,0,4,5],.62],[[2,1,5,6],.71],[[0,3,7,4],.72]];
    for(const [indices,light] of faces){
      const points=indices.map(i=>v[i]);if(points.some(p=>!p))continue;
      this.faces.push({points,depth:points.reduce((a,p)=>a+p[2],0)/4,hex,light,alpha});
    }
  }
  draw(world,playerIds,delta){
    this.resize();const c=this.canvas,ctx=this.ctx;ctx.fillStyle='#193d47';ctx.fillRect(0,0,c.width,c.height);
    for(let i=0;i<playerIds.length;i++){
      const x=i*c.width/playerIds.length,w=c.width/playerIds.length,h=c.height;
      this.region={x,y:0,w,h};
      ctx.save();ctx.beginPath();ctx.rect(x,0,w,h);ctx.clip();ctx.fillStyle='#1b404b';ctx.fillRect(x,0,w,h);
      const car=world.bodies.find(b=>b.id===playerIds[i]);if(!car){ctx.restore();continue;}
      const forward=[Math.sin(car.yaw),Math.cos(car.yaw)];
      const e=chaseEye(car);
      const cam=this.cameras[playerIds[i]]||(this.cameras[playerIds[i]]=[...e]);
      const k=1-Math.exp(-Math.min(delta,.08)*6);for(let j=0;j<3;j++)cam[j]+=(e[j]-cam[j])*k;
      this.vp=multiply(perspective(56*Math.PI/180,w/Math.max(h,1),.1,170),lookAt(cam,[car.x,.52,car.z]));
      this.faces=[];this.worldGeometry(world);this.checkpointStripes(world);for(const b of world.bodies){if(b.kind==='car')this.car(b);else this.crate(b);}
      this.faces.sort((a,b)=>b.depth-a.depth);
      for(const face of this.faces){
        const n=parseInt(face.hex.slice(1),16),components=[n>>16&255,n>>8&255,n&255];
        const rgb=components.map(t=>Math.min(255,Math.round(t*face.light)));
        ctx.fillStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${face.alpha})`;
        ctx.beginPath();ctx.moveTo(face.points[0][0],face.points[0][1]);
        for(let k=1;k<face.points.length;k++)ctx.lineTo(face.points[k][0],face.points[k][1]);
        ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
  }
}
for(const name of ['worldGeometry','checkpointStripes','wheel','car','crate'])CanvasRenderer.prototype[name]=SceneRenderer.prototype[name];
