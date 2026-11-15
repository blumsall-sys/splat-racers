/** Windows-friendly Vite launcher with persistent crash diagnostics.
 * Does not modify game logic, the active Blender pack or any asset paths. */
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const logfile=path.join(root,'STARTUP_LAST_LOG.txt');
const out=createWriteStream(logfile,{flags:'w'});
const line=text=>{process.stdout.write(text);out.write(text);};
line(`[START] ${new Date().toISOString()} | Node ${process.version} | ${process.platform}\n`);
line(`Project: ${root}\n`);
line(`Diagnostic log: ${logfile}\n`);
const vite=path.join(root,'node_modules','vite','bin','vite.js');
if(!existsSync(vite)){
  line('ERROR: Local Vite is missing. Run npm.cmd install --include=dev in this folder.\n');
  out.end();process.exitCode=1;
}else{
  line('Starting Vite on http://localhost:5173/ (Ctrl+C to stop)\n');
  const child=spawn(process.execPath,[vite,'--host','0.0.0.0','--port','5173'],{
    cwd:root,env:{...process.env,FORCE_COLOR:'0'},stdio:['inherit','pipe','pipe'],windowsHide:false
  });
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>line(String(chunk)));
  child.on('error',e=>{line(`ERROR: Cannot launch Vite: ${e.stack||e}\n`);process.exitCode=1;});
  const close=new Promise(resolve=>child.once('close',(code,signal)=>{
    const status=`Vite exited: code ${code??'unknown'}, signal ${signal||'none'}\n`;
    line(status);
    if(code!==0&&signal!=='SIGINT'){
      line('Vite stopped unexpectedly. Check the error above and STARTUP_LAST_LOG.txt.\n');
      line('If port 5173 is occupied, inspect it with: netstat -ano | findstr :5173\n');
      process.exitCode=code||1;
    }
    out.end(resolve);
  }));
  for(const signal of ['SIGINT','SIGTERM']){
    process.on(signal,()=>{
      if(!child.killed)child.kill(signal);
    });
  }
  await close;
}
