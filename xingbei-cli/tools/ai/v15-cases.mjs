import fs from 'node:fs';import assert from 'node:assert/strict';import {playEconomyMatch} from './economy-evaluate.mjs';import {getPolicy} from '../../src/ai/versions.js';import {CARD_NAMES} from '../../src/card-labels.js';import {UNIQUE_SKILL_NAMES} from '../../src/unique-skills.js';
const source=JSON.parse(fs.readFileSync('artifacts/ai/targeted-fixes-1/negative-cases.json')),results=[];
for(const old of source.cases){const history=[];let found;
 await playEconomyMatch(old.config,{candidate:'v1.4',opponent:'v1.3',turnLimit:300,decisionVersions:['v1.4'],onPublicAction:e=>history.push(e),onOrdinaryDecision:e=>{if(e.turn===old.turn&&e.actorId===old.actorId){assert.deepEqual(JSON.parse(JSON.stringify(e.ranked)),old.ranked);found={old,observation:e.observation,history:[...history]};}}});
 assert(found);found.current=getPolicy('experimental/plans-2').replayTrace({version:'experimental/plans-2',observation:found.observation}).filter(r=>r.action.type!=='pass');results.push(found);
}
fs.writeFileSync('artifacts/ai/v1.5/five-comparison.json',JSON.stringify(results,null,2));
const name=x=>CARD_NAMES[x]??UNIQUE_SKILL_NAMES[x]??({spellExcitation:'法术激荡',waterPower:'水之神力',hit:'命中',light:'圣光抵消',counter:'应战',refine:'提炼'}[x]??x);
const label=(a,o)=>a.type==='play'?`${name(o.cards.find(c=>c.id===o.players[o.observerId].handIds[a.index]).name)}→${a.targetId}号`:a.type==='skill'?`${name(a.skillId)}→${a.targetIds.join('/')}号`:a.type==='refine'?`提炼${a.stones.gem}宝石+${a.stones.crystal}水晶`:a.type;
let report='# v1.5 开发案例对照\n\n未发布候选。原五例由真实引擎使用v1.4/v1.3重新行至原回合，69个旧排名精确一致；原始公共动作链及新排名见 [five-comparison.json](../artifacts/ai/v1.5/five-comparison.json)。旧例的实际后续胜负不参与单步判断。概率仍是公开模型估计，不能称最优行动或真实胜率。\n\n风险口径：已确认终局±100000；未知响应条件分支终局±150；未来一轮首个败局/反杀风险净值限制在±150。第五杯窗口也是有界准备价值，只有实际确认的合杯胜利才用十万。双方、所有行动和应战均沿用同一状态估值。\n';
for(const [i,c]of results.entries()){
 report+=`\n## 例${i+1}：${c.old.hero}\n\n旧选择：${label(c.old.action,c.observation)}（${c.old.ranked[0].score.toFixed(2)}）。新排序前列：\n\n|合法行动|完整计划分|首动作分|追加分|\n|---|---:|---:|---:|\n`;
 for(const r of c.current.slice(0,6)){const primary=r.explanation.primaryParts?Object.values(r.explanation.primaryParts).reduce((a,b)=>a+b,0):r.score;report+=`|${label(r.action,c.observation)}|${r.score.toFixed(2)}|${primary.toFixed(2)}|${(r.score-primary).toFixed(2)}|\n`;}
 report+='\n最佳计划分支（推测，不是实际已发生）：\n\n';for(const b of c.current[0].explanation.branches)report+=`- ${(b.probability*100).toFixed(2)}%：${b.steps.map(s=>`${s.actorId}号${name(s.card??s.skillId??s.type)}${s.targetId!=null?'→'+s.targetId+'号':''}；${s.result}${s.gifts?.length?'；交牌'+s.gifts.map(g=>`${name(g.card)}→${g.targetId}号`).join('、'):''}`).join('；随后')}\n`;
 report+='\n最近公开完整事件（此前全部事件保留在JSON；暗牌不展示）：\n\n';for(const e of c.history.slice(-16))report+=`- ${JSON.stringify({...e,...(e.card?{card:name(e.card)}:{}),...(e.skillId?{skillId:name(e.skillId)}:{}),...(e.effectId?{effectId:name(e.effectId)}:{})})}\n`;
}
report+='\n## 边界\n\n例1不要求特定排序。例2比较等待与进攻，不能把蓝方低士气解释成红方风险。例3保留准备剑影的提炼价值，不强迫立即三刀。例4比较贴盾与追加的净值，没有破盾固定奖励。例5赠魔弹的角色用途与满手负担都计入，协同有收益不意味着必须压过所有进攻。封印师/风剑搜索最多64次扩展；未来一轮是公开危险度近似，未模拟全部技能或私人响应。\n';
fs.writeFileSync('docs/ai-v1.5-cases.md',report);console.log(results.map(c=>({hero:c.old.hero,old:c.old.ranked[0].score,current:c.current[0].score,events:c.history.length})));
