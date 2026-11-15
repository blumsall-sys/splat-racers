import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.glb':'model/gltf-binary','.wasm':'application/wasm'};
const port=Number(process.env.PORT)||5173;
http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url||'/',`http://localhost:${port}`).pathname);
    if(/^\/(input-assets|blender_addon|\.git)(\/|$)/.test(pathname)||/\.(ply|blend|blend1)$/i.test(pathname))throw new Error('Private source');
    const file=path.resolve(root,'.'+pathname,(pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep)&&file!==root)throw new Error('Invalid path');
    const stat=await fs.stat(file);
    const target=stat.isDirectory()?path.join(file,'index.html'):file;
    const ext=path.extname(target);
    const bytes=await fs.readFile(target);
    res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(bytes);
  }catch(e){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(port,'0.0.0.0',()=>console.log(`SPLAT RACERS ready: http://localhost:${port}/`));
