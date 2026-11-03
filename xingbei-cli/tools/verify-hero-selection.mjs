// Four-mode roster and manual-seat integration; common combat details remain in verify-responses.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAvailableHeroes, DEFAULT_HERO_IDS } from "../src/hero.js";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CURRENT_URL || "http://127.0.0.1:4173";
const output = resolve(process.argv[2] || "xingbei-cli/artifacts/modes/manual-seats");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ["--no-sandbox"] });
const checks = [], issues = [], heroes = getAvailableHeroes();
const check = (label, value) => { assert.ok(value, label); checks.push(label); };
try {
  for (const viewport of [{ width:1440,height:900 },{ width:390,height:844 }]) {
    const page = await browser.newPage({viewport,hasTouch:viewport.width<500});
    const tag = `${viewport.width}x${viewport.height}`;
    page.on("pageerror", error => issues.push(error.message));
    page.on("console", message => { if(message.type()==="error") issues.push(message.text()); });
    page.on("response", response => { if(response.status()>=400) issues.push(response.url()); });
    await page.addInitScript(()=>{Date.now=()=>13;});
    // Inspection/prepared combat fixture only in this test; no production game handle.
    await page.route('**/src/engine.js', async route => {
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text())+'\nconst fixtureSetup=Game.prototype.setup; Game.prototype.setup=function(...args){window.fixtureGame=this;return fixtureSetup.apply(this,args)};'});
    });
    async function roster(mode,ids=DEFAULT_HERO_IDS) {
      await page.getByRole('button',{name:mode,exact:true}).click();
      await page.locator('.roster-picker').waitFor();
      check(`${tag}/${mode} 六个席位且未选完不能开始`,await page.locator('.roster-picker select').count()===6&&await page.getByRole('button',{name:'开始对局',exact:true}).isDisabled());
      for(let i=0;i<6;i++)await page.locator(`.roster-picker select[data-seat="${i}"]`).selectOption(ids[i]);
      check(`${tag}/${mode} 其他席位禁选重复角色`,await page.locator(`select[data-seat="1"] option[value="${ids[0]}"]`).evaluate(option=>option.disabled));
      check(`${tag}/${mode} 开始前未发牌`,await page.locator('#hand .card').count()===0);
      await page.getByRole('button',{name:'开始对局',exact:true}).click();
      await page.waitForFunction(()=>window.fixtureGame?.player(0).hand.length>0);
      check(`${tag}/${mode} 精确阵容与红蓝蓝红红蓝`,await page.evaluate(ids=>window.fixtureGame.players.map(p=>p.hero.id).join()===ids.join()&&window.fixtureGame.players.map(p=>p.team).join()==='red,blue,blue,red,red,blue',ids));
    }
    async function idle(){await page.waitForFunction(()=>!document.querySelector('[data-command="draw"]').disabled);}
    const next=()=>page.locator('[data-command="next-turn"]');
    const controlled=()=>page.locator('.controlled-seat').textContent();
    await page.goto(`${base}/?motion=off`);
    await page.getByRole('button',{name:'正常游玩',exact:true}).click();
    await page.locator('.roster-picker').waitFor();
    check(`${tag} 全部英雄可选`,await page.locator('select[data-seat="0"] option').count()===heroes.length+1);
    await page.locator('select[data-seat="0"]').selectOption('godEater');
    await page.screenshot({path:resolve(output,`roster-${tag}.png`)});
    await page.getByRole('button',{name:'重新开始',exact:true}).click();
    await roster('正常游玩',['marksman','berserker','sealer','guardianAngel','priest','windSwordmaster']);
    await page.waitForFunction(()=>document.querySelector('#hint').textContent.includes('[攻击行动]'));
    check(`${tag} 正常无测试面板且不公开手牌`,await page.locator('.play-mode-controls').isHidden()&&await page.locator('.revealed-hand').count()===0);
    const normalCount=await page.locator('#hand .card').count();
    await page.locator('[data-command="next-turn"]').evaluate(b=>b.click());
    await page.locator('[data-command="draw"]').evaluate(b=>b.click());
    check(`${tag} 普通模式即使直接触发按钮也无效`,await page.locator('#hand .card').count()===normalCount&&await page.evaluate(()=>window.fixtureGame.current)===0);
    await page.getByRole('button',{name:'重新开始',exact:true}).click();
    await roster('测试游玩');await idle();
    check(`${tag} 测试展示手牌但隐藏开发跳过`,await page.locator('.revealed-hand').count()===6&&await next().isHidden());
    await page.getByRole('button',{name:'摸1张牌',exact:true}).click();await idle();
    check(`${tag} 测试摸牌`,await page.locator('#hand .card').count()===5);
    await page.getByRole('button',{name:'弃一张牌',exact:true}).click();await page.locator('#hand .card').first().click({position:{x:8,y:15}});
    await page.getByRole('button',{name:'取消',exact:true}).click();await idle();
    check(`${tag} 弃牌取消保留手牌`,await page.locator('#hand .card').count()===5);
    await page.getByRole('button',{name:'弃一张牌',exact:true}).click();await page.locator('#hand .card').first().click({position:{x:8,y:15}});await page.getByRole('button',{name:'确定',exact:true}).click();await idle();
    check(`${tag} 测试暗弃一张`,await page.locator('#hand .card').count()===4&&await page.evaluate(()=>window.fixtureGame.discard.at(-1).discardVisibility)==='hidden');
    await page.getByRole('button',{name:'重新开始',exact:true}).click();
    await roster('观战游玩');await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.waitForTimeout(150);const snapshot=await page.locator('#players').innerHTML();await page.waitForTimeout(250);
    check(`${tag} 观战暂停稳定且无手动控制`,snapshot===await page.locator('#players').innerHTML()&&await page.locator('#control').isHidden());
    await page.getByRole('button',{name:'继续',exact:true}).click();await page.waitForFunction(old=>document.querySelector('#players').innerHTML!==old,snapshot);
    await page.getByRole('button',{name:'重新开始',exact:true}).click();
    await roster('开发者模式');await idle();
    for(let seat=0;seat<6;seat++){
      check(`${tag} 手动控制${seat+1}号位`,(await controlled()).includes(`${seat+1}号位`)&&await page.evaluate(()=>window.fixtureGame.current)===seat);
      const before=await page.locator('#hand .card').count();
      await page.getByRole('button',{name:'摸1张牌',exact:true}).click();await idle();
      check(`${tag} ${seat+1}号摸牌`,await page.locator('#hand .card').count()===before+1);
      await page.getByRole('button',{name:'弃一张牌',exact:true}).click();await page.locator('#hand .card').first().click({position:{x:8,y:15}});await page.getByRole('button',{name:'确定',exact:true}).click();await idle();
      check(`${tag} ${seat+1}号弃牌`,await page.locator('#hand .card').count()===before);
      await next().click();await page.waitForFunction(id=>window.fixtureGame.current===id,(seat+1)%6);await idle();
    }
    check(`${tag} 六人均未自动执行行动`,await page.evaluate(()=>window.fixtureGame.timeline.filter(e=>e.timing==='attackDeclared').length===0));
    // Prepared hands: real active attack -> another seat's light -> nested healing/overflow.
    await page.evaluate(()=>{
      const g=window.fixtureGame;
      for(const id of [0,1])for(const c of [...g.player(id).hand])g.moveCard(c.id,{zone:'deck'},{animate:false});
      const pick=(id,p)=>{const c=g.deck.find(p);g.moveCard(c.id,{zone:'hand',playerId:id},{animate:false});return c.id;};
      window.attackId=pick(0,c=>c.type==='attack'&&c.element==='water'&&!c.hasUniqueSkill('bloodBlade')&&!c.hasUniqueSkill('bloodyRoar'));
      window.lightId=pick(1,c=>c.name==='holyLight');
      g.player(1).healing=1;g.player(1).handLimit=1;
    });
    // Sort causes a regular render without playing a card.
    await page.getByRole('button',{name:'整理手牌',exact:true}).click();
    await page.locator('#hand .card').click({position:{x:8,y:15}});await page.locator('.player.targetable[data-player="1"]').click();
    await page.getByRole('button',{name:'不响应',exact:true}).waitFor();
    check(`${tag} 响应切到被攻击座位`,(await controlled()).includes('2号位')&&await page.locator('#hand .card').getAttribute('data-card-id')===await page.evaluate(()=>window.lightId));
    check(`${tag} 处理中禁止开发命令`,await next().isDisabled());
    await page.locator('#hand .card').click({position:{x:8,y:15}});
    check(`${tag} 圣光先选后确认且可撤回`,await page.getByRole('button',{name:'确认',exact:true}).isVisible()&&await page.getByRole('button',{name:'不响应',exact:true}).count()===0&&await page.evaluate(()=>window.fixtureGame.cards.get(window.lightId).location.zone)==='hand');
    await page.locator('#hand .card').click({position:{x:8,y:15}});await page.getByRole('button',{name:'不响应',exact:true}).click();
    await page.getByRole('button',{name:'使用1治疗',exact:true}).waitFor();
    check(`${tag} 治疗仍由目标手动选择`,(await controlled()).includes('2号位'));
    await page.getByRole('button',{name:'使用1治疗',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#hint').textContent.includes('爆牌'));
    check(`${tag} 对手爆牌由人手动处理`,(await controlled()).includes('2号位')&&await page.locator('#hand .card').count()===3);
    await page.locator('#hand .card').nth(0).click({position:{x:8,y:15}});await page.locator('#hand .card').nth(1).click({position:{x:8,y:15}});await page.getByRole('button',{name:'确认弃置',exact:true}).click();await idle();
    check(`${tag} 响应链结束才推进对手回合`,await page.evaluate(()=>window.fixtureGame.current)===1);
    await page.screenshot({path:resolve(output,`developer-${tag}.png`)});
    // Reopen while a manual selection is pending: no stale callbacks or controls.
    await page.getByRole('button',{name:'弃一张牌',exact:true}).click();
    await page.getByRole('button',{name:'重新开始',exact:true}).click();
    await roster('正常游玩');await page.waitForFunction(()=>document.querySelector('#hint').textContent.includes('[攻击行动]'));
    check(`${tag} 重开恢复普通模式隐私与0号视角`,await page.locator('.play-mode-controls').isHidden()&&await page.locator('.revealed-hand').count()===0&&await page.locator('.player[data-position="0"]').getAttribute('data-player')==='0');
    await page.close();
  }
  check('控制台与素材错误0',issues.length===0);
} finally {await writeFile(resolve(output,'results.json'),JSON.stringify({checks,issues},null,2));await browser.close();}
console.log(`四模式与六席控制：${checks.length}项检查通过`);
