/** Geometry-level preflight for static GLB floors. Works without PlayCanvas or Ammo.
 * This catches missing road meshes, exports without scale or misplaced spawn points.
 * Mesh vertices are as decoded from glTF; transforms are column-major. */
export function transformPoint(matrix, x, y, z) {
  const w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];
  if(Math.abs(w)<1e-10)throw new Error('Invalid GLB transform W=0');
  return [(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w,
          (matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w,
          (matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])/w];
}
function heightAt(a,b,c,x,z){
  const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
  if(Math.abs(d)<1e-9)return null; // vertical faces are not driveable road
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d;
  const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d;
  const w=1-u-v;
  if(u<-.0001||v<-.0001||w<-.0001)return null;
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  const slope=Math.abs(ny)/(Math.hypot(nx,ny,nz)||1);
  if(slope<.55)return null;
  return {y:u*a[1]+v*b[1]+w*c[1],slope};
}
export function roadHeightsAtSpawns(meshes,spawns){
  const entries=Object.entries(spawns),out={};
  for(const [id,spawn] of entries){
    let best=null;
    for(const mesh of meshes){
      const data=mesh.vertices,m=mesh.model;
      if(!data||!m)continue;
      for(let k=0;k<data.length;k+=18){
        const a=transformPoint(m,data[k],data[k+1],data[k+2]);
        const b=transformPoint(m,data[k+6],data[k+7],data[k+8]);
        const c=transformPoint(m,data[k+12],data[k+13],data[k+14]);
        const p=heightAt(a,b,c,spawn.x,spawn.z);
        if(p&&(!best||p.y>best.y))best={...p,mesh:mesh.name||'unnamed'};
      }
    }
    out[id]=best;
  }
  return out;
}
export function requireSpawnCoverage(meshes,spawns){
 const heights=roadHeightsAtSpawns(meshes,spawns);
 const failures=Object.entries(heights).filter(([,hit])=>!hit).map(([id])=>`${id} (${spawns[id].x.toFixed(2)}, ${spawns[id].z.toFixed(2)})`);
 if(failures.length)throw new Error('No driveable upward/horizontal surface in collision.glb under '+failures.join(', ')+'. Verify RACE_COLLISION includes actual road, exported transforms, and spawn placement; not just walls or voxel preview.');
 return heights;
}
