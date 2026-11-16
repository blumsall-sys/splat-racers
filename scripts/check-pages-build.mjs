import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const repository=(process.env.GITHUB_REPOSITORY||'').split('/')[1];
const base=process.env.SPLAT_BASE||(repository?'/'+repository+'/':'/');
const dist=path.resolve('dist');
const read=relative=>fs.readFileSync(path.join(dist,relative),'utf8');
const main=read('index.html'),lan=read('LAN.html');
assert.match(main,/LAN\.html\?online/,'Main menu online racing link must survive build');
for(const [name,html] of [['index.html',main],['LAN.html',lan]]){
 assert(html.includes(base+'assets/'),name+' must use deployed Vite assets base path '+base);
 assert(!html.includes('src="/src/'),name+' must not link to development /src paths');
}
const pack=JSON.parse(read('assets/asset-pack.json'));
const track=JSON.parse(read('assets/track.json'));
assert(track?.race?.waypoints?.length>=8,'Race track must be deployed');
assert(fs.existsSync(path.join(dist,'assets',pack.visualGlb)),'Visual GLB must be deployed');
if(pack.splat?.sog)assert.equal(fs.statSync(path.join(dist,'assets',pack.splat.sog)).size,pack.splat.sogBytes,'SOG must be copied fully');
assert(fs.existsSync(path.join(dist,'.nojekyll')),'Pages should not use Jekyll');
console.log('Pages build smoke test passed for '+base+' (local, online, track, GLB, SOG)');
