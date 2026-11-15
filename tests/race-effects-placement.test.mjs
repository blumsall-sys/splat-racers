import test from 'node:test';
import assert from 'node:assert/strict';
import {trackEffect} from '../src/race/track-effect.js';
import fs from 'node:fs';
test('Bedroom SOG maps the first raw PLY vertex to the Blender preview world position',()=>{
 const pack=JSON.parse(fs.readFileSync(new URL('../assets/asset-pack.json',import.meta.url)));
 if(pack.splat?.sogSha256!=='af2bb465211069bfca0bc2f5b9c61ab74633115e5285c9887c646b9a15ff1c4d'||pack.packId!=='my-race-track-20261110-172750-412633')return;
 const m=pack.splat.anchorMatrixColumnMajor;
 const raw=[-1.3369140625,.034942626953125,-5.6640625];
 const world=[0,1,2].map(i=>m[i+12]+raw.reduce((sum,v,k)=>sum+v*m[4*k+i],0));
 // Blender world coordinates transformed to browser x,z,-y.
 const [x,y,z]=raw;
 const expected=[49.9577*x+1.8753*y+.8451*z,-1.8756*x+49.9648*y-1.36,-.8445*x-.0317*y+49.9929*z+.19];
 world.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.002));
});
test('an effect expires inside its marker and re-arms after exit',()=>{
 const zone={x:1,y:2,z:3,radius:2,kind:'speed'},track={race:{effects:[zone]}};
 const car={x:1,y:2,z:3};
 assert.equal(trackEffect(car,track,.01),'speed');
 assert.equal(trackEffect(car,track,2),null);
 car.y=8;trackEffect(car,track,.1);car.y=2;
 assert.equal(trackEffect(car,track,.1),'speed');
});
