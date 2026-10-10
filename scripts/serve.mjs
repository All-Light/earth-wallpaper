import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const activated = Number(process.env.LISTEN_PID) === process.pid && Number(process.env.LISTEN_FDS) === 1;
let idleTimer;
function idleDeadline() {
  if (!activated) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(()=>server.close(()=>process.exit(0)),30000);
}
const server = createServer(async(req,res)=>{
  idleDeadline();
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let path = join(root,normalize(pathname).replace(/^[/\\]+/,''));
    let info = await stat(path);
    if (info.isDirectory()) { path = join(path,'index.html'); info = await stat(path); }
    const etag = `"${info.size}-${Math.round(info.mtimeMs)}"`;
    const headers = {'Content-Type':mime[extname(path)]||'application/octet-stream','ETag':etag,
      'Cache-Control':extname(path)==='.html'?'no-cache':'public, max-age=3600'};
    if (req.headers['if-none-match'] === etag) { res.writeHead(304,headers);res.end();return; }
    res.writeHead(200,{...headers,'Content-Length':info.size});
    if (req.method==='HEAD') res.end();
    else createReadStream(path).on('error',()=>res.destroy()).pipe(res);
  } catch { res.writeHead(404);res.end('Not found'); }
});
server.keepAliveTimeout = 2000;
server.listen(activated?{fd:3}:{port:Number(process.env.PORT||4173),host:'127.0.0.1'},()=>{
  console.log(`Earth wallpaper serving on port ${server.address().port}${activated?' (socket activated; exits after 30 idle seconds)':''}`);
  idleDeadline();
});
