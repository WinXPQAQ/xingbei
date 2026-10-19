// Local-only browser entry smoke; optional Playwright installation stays external.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const port=process.env.SMOKE_PORT||'4198',base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:port},stdio:'ignore'});let browser;
 try{
  for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));const response=await page.goto(base);
  await page.getByRole('button',{name:'正常游玩',exact:true}).waitFor();
  await page.getByRole('button',{name:'正常游玩',exact:true}).click();
  await page.getByRole('heading',{name:'选择角色'}).waitFor();
  assert.equal(await page.locator('#modal-actions button').count(),6);
  const result=await page.evaluate(async()=>{
   const {Game}=await import('/src/engine.js'),{getPolicy}=await import('/src/ai/versions.js'),production=await import('/src/ai.js');
   if(production.AI_POLICY_VERSION!=='v1.3')throw Error('Wrong production default');
   const g=new Game({seed:73}).setup(),p=getPolicy('experimental/economy-4'),stable=getPolicy('v1.3');
   const trace=p.traceDecision(g,0);if(JSON.stringify(p.replayTrace(JSON.parse(JSON.stringify(trace))))!==JSON.stringify(trace.candidates))throw Error('Trace differs');
   const action=production.chooseAiAction(g,0);
   if(JSON.stringify(action)!==JSON.stringify(p.chooseAiAction(g,0))||JSON.stringify(action)!==JSON.stringify(stable.chooseAiAction(g,0)))throw Error('Default route differs');
   g.startTurn(0);production.runAiAction(g,0);g.assertCardLocations();
   return{default:production.AI_POLICY_VERSION,candidate:'experimental/economy-4',action,defaultEqualsCandidate:true,traceReplay:true,cardConservation:true};
  });
  assert.equal(response.status(),200);assert.deepEqual(errors,[]);
  const report={httpStatus:response.status(),pageErrors:errors,...result,modeAndSixHeroEntry:true,scope:'limited browser entry smoke, not visual acceptance'};
  const output=process.argv[2]||'/tmp/ai-v13-web.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(report);
 }finally{if(browser)await browser.close();server.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
