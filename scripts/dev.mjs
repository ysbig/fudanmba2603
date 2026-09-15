// Local-only preview, serving dist and the same read-only bridge as production.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBridge} from '../server/feishu.mjs';
const root=resolve(fileURLToPath(new URL('../dist',import.meta.url)));
const bridge=createBridge();
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.csv':'text/csv; charset=utf-8'};
const port=Number(process.env.PORT||4317);
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    if(url.pathname==='/api/class-content') {
      const response=await bridge(new Request(url,{method:req.method}),process.env);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(relative.split('/').some(p=>p.startsWith('.'))){res.writeHead(404);res.end();return;}
    const path=resolve(root,'.'+relative);
    if(!path.startsWith(root+sep)||!(await stat(path)).isFile()){res.writeHead(404);res.end();return;}
    const content=await readFile(path);
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Local: http://127.0.0.1:${port}\n`));
