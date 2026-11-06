const assert=require('node:assert/strict');
module.exports=async function(page,base){
 await page.goto(base+'/app/');await page.waitForSelector('#est-in');
 await page.fill('#est-in','Please please help me write a short test message.');await page.locator('#p-estimate button').filter({hasText:/^Estimate$/}).click();
 assert.ok((await page.textContent('#p-estimate .stats')).length>10);

 await page.getByRole('tab',{name:'Compress',exact:true}).click();
 for (const [input, expected] of [['하하하',''], ['코드를 고쳐줘 하하하','코드를 고쳐줘'], ['ㅋㅋㅋ',''], ['ㅎㅎㅎ',''], ['`하하하` 하하하','`하하하`']]) {
  await page.fill('#cmp-in',input);
  await page.locator('#p-compress button').first().click();
  assert.equal(await page.locator('#p-compress textarea[readonly]').inputValue(),expected,'Compression UI uses the corrected laughter rule');
 }
 const tabs=await page.getByRole('tab').count();
 const axe=require('node:fs').readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
 for(let i=0;i<tabs;i++){
  await page.getByRole('tab').nth(i).click();await page.evaluate(axe);
  const violations=await page.evaluate(async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[],'Every tab has accessible inputs');
 }
 await page.getByRole('tab',{name:'Settings',exact:true}).click();
 for(const lang of ['ko','ja','en']){
  await page.selectOption('#set-lang',lang);
  assert.equal(await page.locator('#p-settings input[type=file]').count(),1,'Import input survives translation');
 }
 const data={v:1,records:[{ts:Date.now(),input:123,output:45}],limits:{block:900,week:5000,metric:'io'},budget:500};
 await page.setInputFiles('#p-settings input[type=file]',{name:'usage.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 await page.waitForFunction(()=>JSON.parse(localStorage['quotanest.v1']).records.length===1);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage['quotanest.v1']).records[0].input),123);
};
