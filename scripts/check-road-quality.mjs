/** Inspect actual Blender-exported road triangle topology, not just file count.
 * This is an OFFLINE static check, not a substitute for a running Ammo test.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeGlb} from '../src/assets/glb-loader.js';
import {isRoadMeshName} from '../src/v14/collision-policy.js';
export function inspectRoadTriangles(meshes,{maxLongitudinalEdge=1.25}={}){
 const summary={meshes:0,triangles:0,upward:0,degenerate:0,coarse:0,steep:0,maxShortestEdge:0,largestArea:0};
 for(const model of meshes){
  if(!isRoadMeshName(model.name))continue;
  summary.meshes++;
  const v=model.vertices,m=model.model;
  const world=o=>{
   const x=v[o],y=v[o+1],z=v[o+2];
   return [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
  };
  for(let i=0;i+17<v.length;i+=18){
   const a=world(i),b=world(i+6),c=world(i+12), ab=b.map((u,k)=>u-a[k]),ac=c.map((u,k)=>u-a[k]);
   const n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
   const nsize=Math.hypot(...n),area=nsize*.5;
   summary.triangles++;summary.largestArea=Math.max(summary.largestArea,area);
   if(nsize<1e-7){summary.degenerate++;continue;}
   if(n[1]/nsize>.3)summary.upward++;
   if(Math.abs(n[1]/nsize)<.5)summary.steep++;
   const edges=[Math.hypot(...ab),Math.hypot(...ac),Math.hypot(...b.map((u,k)=>u-c[k]))];
   const shortest=Math.min(...edges);
   summary.maxShortestEdge=Math.max(summary.maxShortestEdge,shortest);
   if(shortest>maxLongitudinalEdge)summary.coarse++;
  }
 }
 return summary;
}
export function roadQualityWarnings(s){
 const result=[];
 if(!s.meshes)result.push('No road-named mesh primitives');
 if(s.degenerate)result.push(`${s.degenerate} zero-area/degenerated road triangles`);
 if(s.coarse)result.push(`${s.coarse} triangles with a shortest edge exceeding 1.25 m; re-sample the Blender centreline`);
 if(s.triangles&&!s.upward)result.push('No upward-facing road triangles; check normals/winding');
 if(s.steep)result.push(`${s.steep} steep or vertical road faces (could be edges or underside on legacy packs)`);
 return result;
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(invoked){
 const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
 const pack=JSON.parse(fs.readFileSync(path.join(root,'assets/asset-pack.json'),'utf8'));
 if(!pack.staticCollisionGlb){
  console.log('ROAD QUALITY: proxy-only collision pack (no GLB). Use ?colliders=1 to verify physical ground in browser.');
 }else{
  const mesh=decodeGlb(fs.readFileSync(path.join(root,'assets',pack.staticCollisionGlb)));
  const report=inspectRoadTriangles(mesh);const warnings=roadQualityWarnings(report);
  console.log(`ROAD QUALITY ${JSON.stringify(report)}`);
  for(const warning of warnings)console.warn('WARN',warning);
  if(!report.meshes||!report.upward)process.exitCode=1;
 }
}
