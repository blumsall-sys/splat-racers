// Column-major 4x4 matrices; the browser OpenGL / WebGL convention.
export function multiply(a,b){
  const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){
    let s=0;for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;
  }
  return o;
}
export function identity(){return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);}
export function translation(x,y,z){let a=identity();a[12]=x;a[13]=y;a[14]=z;return a;}
export function scaling(x,y,z){return new Float32Array([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);}
export function rotationY(t){let c=Math.cos(t),s=Math.sin(t);return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);}
export function rotationX(t){let c=Math.cos(t),s=Math.sin(t);return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);}
export function rotationZ(t){let c=Math.cos(t),s=Math.sin(t);return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);}
export function compose(x,y,z,yaw=0,pitch=0,roll=0,sx=1,sy=1,sz=1){
  return multiply(multiply(multiply(multiply(translation(x,y,z),rotationY(yaw)),rotationX(pitch)),rotationZ(roll)),scaling(sx,sy,sz));
}
function norm(a){let l=Math.hypot(...a)||1;return a.map(v=>v/l);}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot(a,b){return a.reduce((s,v,i)=>s+v*b[i],0);}
export function lookAt(eye,target){
  const z=norm(eye.map((v,i)=>v-target[i])),x=norm(cross([0,1,0],z)),y=cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
export function perspective(fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2),q=1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*q,-1, 0,0,2*far*near*q,0]);
}
