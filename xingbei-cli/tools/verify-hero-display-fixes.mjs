import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'http://127.0.0.1:4188';
const output='artifacts/heroes/display-fixes';await mkdir(output,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox']});const checks=[],errors=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name)};
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  const page=await browser.newPage({viewport,hasTouch:viewport.width<500});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto(`${base}/web/dev.html?scene=hero-plagueMage`);
  await page.waitForFunction(()=>window.xingbeiDev?.exportState().phase==='action');
  check(`${viewport.width} 瘟疫初始5治疗槽`,await page.locator('.player[data-player="0"] .hp > span').count()===5);
  await page.evaluate(()=>{
   window.healingCounts=[];
   window.healingObserver=new MutationObserver(()=>window.healingCounts.push(document.querySelectorAll('.player[data-player="0"] .hp > span').length));
   window.healingObserver.observe(document.querySelector('#players'),{childList:true,subtree:true});
  });
  await page.getByRole('button',{name:'剧毒新星',exact:true}).click();
  await page.getByRole('button',{name:'不发动',exact:true}).click();
  await page.waitForFunction(()=>window.xingbeiDev.exportState().current===1);
  const counts=await page.evaluate(()=>{window.healingObserver.disconnect();return window.healingCounts});
  check(`${viewport.width} 多人伤害动画帧始终5槽`,counts.length>5&&counts.every(n=>n===5));
  await page.screenshot({path:`${output}/${viewport.width}-plague.png`});
  await page.goto(`${base}/web/dev.html?scene=hero-elementalist`);
  await page.waitForFunction(()=>window.xingbeiDev?.exportState().phase==='action');
  const lamp=page.locator('.player[data-player="0"] .element-mark');
  check(`${viewport.width} 3元素黄灯加载`,await lamp.locator('img').evaluate(img=>img.complete&&img.naturalWidth===400&&img.src.endsWith('/assets/markers/element.png')));
  check(`${viewport.width} 黄灯保留原比例`,await lamp.locator('img').evaluate(img=>getComputedStyle(img).objectFit==='contain'));
  check(`${viewport.width} 数量3与说明`,await lamp.locator('b').textContent()==='3'&&await lamp.getAttribute('aria-label')==='元素 3/3');
  await page.screenshot({path:`${output}/${viewport.width}-element.png`});
  await page.getByRole('button',{name:'元素点燃',exact:true}).click();await page.locator('.player.targetable[data-player="1"]').click();
  await page.waitForFunction(()=>window.xingbeiDev.exportState().phase==='action');
  check(`${viewport.width} 消耗后黄灯移除`,await page.locator('.player[data-player="0"] .element-mark').count()===0);
  const cap=await page.evaluate(async()=>{
   const {Game}=await import('/src/engine.js');const {presentationView}=await import('/web/animation.js');
   const game=new Game({heroIds:['holyLancer','plagueMage','priest','saint','valkyrie','elementalist']});game.enablePresentation();game.recordPresentation('checkpoint');
   const snapshot=game.presentationEvents[0].view;game.teams.blue.cups=1;
   const view=presentationView(snapshot,game);return [view.getHealingLimit(0),game.getHealingLimit(0),view.getHealingLimit(1),view.getHealingLimit(2)];
  });
  check(`${viewport.width} 快照上限隔离未来状态`,JSON.stringify(cap)==='[3,2,5,6]');
  await page.close();
 }
 check('控制台错误0',errors.length===0);
} finally {await writeFile(`${output}/results.json`,JSON.stringify({checks,errors},null,2));await browser.close()}
console.log(`${checks.length} checks passed`);
