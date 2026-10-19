const {chromium}=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const server=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'4217',HOST:'127.0.0.1'},stdio:'ignore'});let browser;
 try{
 for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:4217');break}catch{await new Promise(r=>setTimeout(r,100));}}
 browser=await chromium.launch({executablePath:'/tmp/refresh-browsers/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 // Test-only closure access; never written to product source or HTTP server.
 await page.route('**/web/app.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.__refreshTest={game:()=>game,render,ready:()=>acceptingAction&&!busy};'});});
 await page.goto('http://127.0.0.1:4217/?motion=off');
 await page.getByRole('button',{name:'正常游玩',exact:true}).click();await page.getByRole('button',{name:'风之剑圣',exact:true}).click();
 await page.waitForFunction(()=>window.__refreshTest?.ready());
 const versionSmoke=await page.evaluate(async()=>{const ai=await import('/src/ai.js'),{getPolicy}=await import('/src/ai/versions.js'),g=window.__refreshTest.game();return{version:ai.AI_POLICY_VERSION,actionEqual:JSON.stringify(ai.chooseAiAction(g,0))===JSON.stringify(getPolicy('experimental/targeted-fixes-1').chooseAiAction(g,0)),oldAliases:[['v1.1','read-1'],['v1.2','fusion-1'],['v1.3','experimental/economy-4']].every(([a,b])=>getPolicy(a).rankAiActions===getPolicy(b).rankAiActions)}});assert.equal(versionSmoke.version,'v1.4');assert(versionSmoke.actionEqual&&versionSmoke.oldAliases);
 await page.evaluate(()=>{const t=window.__refreshTest,g=t.game();for(const c of [...g.player(0).hand])g.moveCard(c.id,{zone:'deck'});for(let i=0;i<4;i++)g.moveCard(g.deck.find(c=>c.name==='holyLight').id,{zone:'hand',playerId:0});g.addStones('red','gem',2);for(const c of g.deck.filter(c=>c.name==='holyLight').slice(0,4)){g.deck.splice(g.deck.indexOf(c),1);g.deck.push(c);}window.__beforeRefresh=g.player(0).hand.map(c=>c.id);t.render();});
 await page.locator('#refresh-unable').click();await page.waitForFunction(()=>window.__refreshTest.ready()&&window.__refreshTest.game().player(0).hand.every(c=>!window.__beforeRefresh.includes(c.id)));
 assert.equal(await page.evaluate(()=>window.__refreshTest.game().turn.state.completed),false);assert.equal(await page.locator('#refresh-unable').isVisible(),true);
 await page.evaluate(()=>{const g=window.__refreshTest.game();for(const c of g.deck.filter(c=>c.type==='attack').slice(0,4)){g.deck.splice(g.deck.indexOf(c),1);g.deck.push(c);}});
 await page.locator('#refresh-unable').click();await page.waitForFunction(()=>window.__refreshTest.ready()&&!window.__refreshTest.game().canRefreshUnableHand(0));
 const state=await page.evaluate(()=>{const g=window.__refreshTest.game();let rejected=false;try{g.endTurn()}catch{rejected=true}return{current:g.current,completed:g.turn.state.completed,endRejected:rejected,legalCards:g.legalCards(0).length,hand:g.player(0).hand.length};});
 assert.equal(state.current,0);assert.equal(state.completed,false);assert.equal(state.endRejected,true);assert.equal(state.legalCards,4);assert.deepEqual(errors,[]);
 fs.writeFileSync('artifacts/ai/targeted-fixes-1/release/independent-web-smoke.json',JSON.stringify({versionSmoke,state,errors,scope:'Actual human Web refresh button twice in an injected reachable-shape fixture; first remains unable, second regains attacks; ordinary end rejected. Not natural match or visual acceptance.'},null,2));
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
