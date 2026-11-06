// Exercise the large-file prompt without allocating or importing the file.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),app="quotanest";
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'import-test-')),file=path.join(dir,'big.json'),fd=fs.openSync(file,'w');fs.ftruncateSync(fd,20*1024*1024+1);fs.closeSync(fd);
 const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/api/license'){res.setHeader('content-type','application/json');return res.end('{"configured":false}');}let f=path.resolve(dist,'.'+p);if(f!==dist&&!f.startsWith(dist+path.sep)){res.writeHead(404);return res.end();}if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('content-type',types[path.extname(f)]||'text/plain');fs.createReadStream(f).pipe(res)});
 let b;
 try {
  await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+srv.address().port;
  b=await chromium.launch({...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
  const ctx=await b.newContext({locale:'en-US',serviceWorkers:'block'});
  await ctx.addInitScript(app=>{if(app==='stampbook')localStorage.setItem('stampbook.v1',JSON.stringify({v:1,teacher:'',pro:true,lang:'en',packs:[]}));if(app==='lendnest')localStorage.setItem('lendnest.licence',JSON.stringify({key:'LOCAL-TEST-0000',checked:Date.now()}));},app);
  const pg=await ctx.newPage(),errors=[];pg.on('pageerror',e=>errors.push(e.message));await pg.goto(url+'/app/');
  if(app==='lendnest')await pg.click('[data-tab=set]');
  const input=pg.locator(app==='lendnest'?'#s-file':app==='stampbook'?'.settings input[type=file]':'#p-estimate input[type=file]');
  await input.waitFor({state:'attached'});
  let asks=0;pg.on('dialog',async d=>{assert.match(d.message(),/20 MiB/);asks++;await d.dismiss();});
  for(let i=0;i<2;i++){await input.setInputFiles(file);}
  assert.equal(asks,2,'same file can be selected again after cancellation');assert.deepEqual(errors,[]);
  console.log(app+': oversized imports ask and cancellation keeps the page usable');await ctx.close();
 } finally {if(b)await b.close();await new Promise(resolve=>srv.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
