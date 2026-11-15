import {readFileSync} from 'node:fs';
import {legacyFlightGates,validateAirGates,inspectFlightCourse} from '../src/vehicles/air-race.js';
import {validateTrack} from '../src/track/track.js';
const file=new URL('../assets/track.json',import.meta.url);
const track=validateTrack(JSON.parse(readFileSync(file,'utf8')));
const authored=Array.isArray(track.race?.airGates)&&track.race.airGates.length>0;
const gates=validateAirGates(authored?track.race.airGates:legacyFlightGates(track));
const report=inspectFlightCourse(gates,track.spawns);
console.log(`SPLAT RACERS FLIGHT PREFLIGHT • ${track.title||track.id}\nRoute: ${authored?'Blender AIR_OFFSET gates':'Legacy sample fallback'} • ${gates.length} oriented rings`);
for(const [index,g] of gates.entries()){
 const p=g.position.map(x=>x.toFixed(2)).join(', '),n=g.normal.map(x=>x.toFixed(2)).join(', ');
 console.log(` ${String(index+1).padStart(2,'0')} ${g.id.padEnd(15)} pos [${p}]   forward [${n}]  radius ${g.radius.toFixed(2)}m`);
}
if(report.warnings.length){
 console.log('\nREVIEW THESE DIRECTIONS BEFORE RACING:');
 for(const warning of report.warnings)console.warn(' ! '+warning);
 if(authored)console.log('\nBlender: refresh flight rings, edit AIR_OFFSET_XX (local position/orientation), then Export Asset Pack.');
 process.exitCode=1;
}else console.log('\nPASS: start grid lies behind gate 1, and route has no simple directional warnings.');
