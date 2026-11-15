import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('../',import.meta.url));
const files=['assets/track.json','src/race/ai-driver.js','src/race/laps.js','src/race/air-npc.js','src/vehicles/kart-stability.js','src/track/track.js','index.html','src/v14/main.js','src/site.css','src/v14/drive-math.js','src/v14/pack-contract.js','src/v14/pc-scene.js','src/input/controls.js','src/vehicles/library.js','src/vehicles/air-race.js','src/vehicles/flight-controls.js','scripts/import-existing-pack.mjs'];
for(const f of files)await fs.access(path.join(base,f));
const page=await fs.readFile(path.join(base,'index.html'),'utf8');
for(const id of ['solo-btn','local-btn','resume-btn','viewport','p1-speed','p2-speed','status','game-hud','ai-difficulty','win-screen','play-again-btn','winner-name','p1-laps','p2-laps','p1-vehicle','p2-vehicle','gravity-scale','hop-speed','explore-btn'])if(!page.includes(`id="${id}"`))throw new Error(`Missing UI ID: ${id}`);
if(page.includes('http://')||page.includes('https://'))throw new Error('Unexpected external CDN in app');
console.log('PASS: v2.3 flight NPC physics and route guidance, directional gate preflight, kart and LAN contracts (browser npm dependencies required)');

const {validateTrack}=await import('../src/track/track.js');validateTrack(JSON.parse(await fs.readFile(path.join(base,'assets/track.json'),'utf8')));
console.log('PASS: Blender track sidecar validates');

await import('./check-assets-v14.mjs');
