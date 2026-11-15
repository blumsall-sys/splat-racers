import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve,sep,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const port=Number(process.env.LAB5_DRIVE_LAB_PORT||5174);
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const relative=decodeURIComponent(url.pathname)==='/'?'DRIVE_LAB.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const path=resolve(root,relative);
    if(path!==root&&!path.startsWith(root+sep))throw new Error('outside project');
    const info=await stat(path);if(!info.isFile())throw new Error('not a file');
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(path));
  }catch(e){res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`LAB5 Driving Lab: http://localhost:${port}/ (Ctrl+C to stop)`));
