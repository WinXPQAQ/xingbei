#!/usr/bin/env node
import { cardSets, targetCounts } from "./card-sets.js";
import { getAvailableHeroes } from "./hero.js";
import { cardText } from "./cards.js";
import { Game, RuleError } from "./engine.js";
import { chooseAiAction, chooseAiResponse, chooseAiRuleDecision } from "./ai.js";
import { askIndex, TerminalUI } from "./tui.js";

const tui = new TerminalUI();
const humanId = Number(process.argv[2] ?? 0);
if (!Number.isInteger(humanId) || humanId < 0 || humanId >= 6) { tui.close(); throw new RuleError("无效的玩家座位"); }
const heroes = getAvailableHeroes();
heroes.forEach((hero, index) => tui.console(`${index}: ${hero.name}`));
const heroIndex = await askIndex(tui, "开局选择角色> ", heroes.map((_, index) => index), { allowBlank: false });
const game = new Game({ seed: Date.now(), playerHeroId: heroes[heroIndex].id, playerSeat: humanId }).setup();
const overflowPolicy = player => player.id === humanId ? "defer" : "ai";

game.onDecision = async request => {
  if (request.type === "cardChoice") {
    if (request.playerId !== humanId) return chooseAiRuleDecision(request, game);
    if (request.validSets) {
      request.validSets.forEach((set,index)=>tui.console(`${index}: ${set.map(i=>cardText(game.player(humanId).hand[i])).join("、")}`));
      const chosen=await askIndex(tui,`${request.title}> `,request.validSets.map((_,i)=>i),{allowBlank:request.optional});
      return chosen==null?null:request.validSets[chosen];
    }
    const selected = [];
    while (selected.length < request.count) {
      showState(); const index = await askIndex(tui, `${request.title}> `, request.valid.filter(index => !selected.includes(index)));
      if (index == null && request.optional) return null;
      if (index != null) selected.push(index);
    }
    return selected;
  }
  if (!request.choices) return null;
  if (request.playerId !== humanId) return chooseAiRuleDecision(request, game);
  tui.console(request.title);
  request.choices.forEach((choice, index) => tui.console(`${index}: ${choice.label}`));
  const index = await askIndex(tui, "选择（回车不发动）> ", request.choices.map((_, index) => index));
  return index == null ? request.defaultValue : request.choices[index].value;
};

function showState() {
  const red = game.stoneCounts("red"), blue = game.stoneCounts("blue");
  const lines = [`红方 士气${game.teams.red.morale} 星杯${game.teams.red.cups} 星石${red.gem}宝/${red.crystal}晶 | 蓝方 士气${game.teams.blue.morale} 星杯${game.teams.blue.cups} 星石${blue.gem}宝/${blue.crystal}晶`];
  for (const p of game.players) {
    const effects = `盾:${p.getStatus("holyShield")[0] ? 1 : 0} 虚弱:${p.getStatus("weakness")[0] ? 1 : 0} 中毒:${p.getStatus("poison").length} ${p.statuses.filter(card => !["holyShield", "weakness", "poison"].includes(card.attachment.effectId)).map(card => game.effects.get(card.attachment.effectId)?.name ?? card.attachment.effectId).join("、")} 治疗:${p.healing}/${game.getHealingLimit(p.id)} 能量:${p.energy.gem}宝/${p.energy.crystal}晶`;
    if (p.id === humanId) {
      lines.push(`▶ ${p.id}:${p.name}[${p.team === "red" ? "红" : "蓝"}] 手牌(${p.hand.length}/${p.handLimit}) ${effects}`);
      p.hand.forEach((card, i) => lines.push(`  ${i}:${cardText(card)} #${card.id}`));
    } else lines.push(`  ${p.id}:${p.name}[${p.team === "red" ? "红" : "蓝"}] 手牌(${p.hand.length}/${p.handLimit}) ${effects}`);
  }
  tui.setState(lines);
}

function validGemCounts(team, total) {
  const stones = game.stoneCounts(team);
  return Array.from({ length: total + 1 }, (_, gem) => gem)
    .filter(gem => gem <= stones.gem && total - gem <= stones.crystal);
}

async function chooseSynthesis(player) {
  if (!game.canDrawSpecial(player.id)) throw new RuleError("合成只能在手牌为0至3张时执行");
  const stones = game.stoneCounts(player.team);
  if (stones.total < 3) throw new RuleError("合成需要3个星石");
  const selection = game.synthesisOptions(player.team);
  if (selection.automatic) return selection.gemCount;
  const choices = selection.choices;
  tui.console(`合成消耗3个星石，可选择的宝石数量：${choices.join("、")}（其余为水晶）`);
  return askIndex(tui, "合成使用几个宝石> ", choices, { allowBlank: false });
}

async function chooseRefinement(player) {
  if (!game.canRefine(player.id)) throw new RuleError("当前不能提炼");
  const stones = game.stoneCounts(player.team);
  const capacity = game.getEnergyLimit(player.id) - player.energy.gem - player.energy.crystal;
  const totals = [1, 2].filter(total => total <= stones.total && total <= capacity);
  if (!totals.length) throw new RuleError("没有可提炼的星石，或个人能量已满");
  tui.console(`提炼不会改变手牌。请选择提炼数量：${totals.join("、")}`);
  const total = await askIndex(tui, "提炼几个星石> ", totals, { allowBlank: false });
  const choices = validGemCounts(player.team, total);
  tui.console(`请选择其中的宝石数量：${choices.join("、")}（其余为水晶）`);
  const gem = await askIndex(tui, "提炼几个宝石> ", choices, { allowBlank: false });
  return { gem, crystal: total - gem };
}

async function resolveHumanOverflow() {
  const player = game.player(humanId);
  while (player.hand.length > player.handLimit) {
    const excess = player.hand.length - player.handLimit;
    showState();
    tui.console(`【爆牌】你的手牌超过上限，必须弃置${excess}张。请输入不同的手牌编号，用空格分隔。`);
    const answer = (await tui.question(`爆牌弃置${excess}张> `)).trim();
    const indexes = answer.split(/\s+/).filter(Boolean).map(Number);
    const legal = indexes.length === excess && new Set(indexes).size === excess &&
      indexes.every(index => Number.isInteger(index) && index >= 0 && index < player.hand.length);
    if (!legal) {
      tui.console(`输入无效：请填写${excess}个不同的手牌编号（0-${player.hand.length - 1}）。`);
      continue;
    }
    await game.resolveOverflowWithDecisions(humanId, indexes, player.pendingOverflow ?? {});
  }
}

function flushLog() {
  if (game.log.length) tui.actions(game.log.splice(0).join("\n"));
}

function turnDivider(playerName, phase) {
  const label = ` ${playerName}回合${phase} `;
  const side = "━".repeat(12);
  tui.actions(`${side}${label}${side}`);
}

async function humanTurn() {
  const player = game.player(humanId);
  while (true) {
    showState();
    if (game.canRefreshUnableHand(humanId)) tui.console("当前阶段除提炼外无合法行动：refresh申请换全手（换后仍须行动），或refine提炼。");
    const line = (await tui.question("行动> ")).trim();
    const [command, indexText, targetText] = line.split(/\s+/);
    if (command === "quit") return false;
    if (command === "end" && game.turn.hasExtraActions()) { game.skipExtraActions(humanId); return true; }
    try {
      if (command === "refresh") await game.executeAction(humanId, { type: "refresh" }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
      else if (command === "skill") {
        const entries = game.legalSkillActions(humanId);
        entries.forEach((entry, i) => tui.console(`${i}: ${entry.name}`));
        const selected = await askIndex(tui, "技能> ", entries.map((_, i) => i));
        if (selected == null) continue;
        const entry = entries[selected], cardIds = [], targetIds = [];
        let mode;
        if (entry.spec.modes) {
          entry.spec.modes.forEach((choice, i) => tui.console(`${i}: ${choice.label}`));
          const index = await askIndex(tui, "效果> ", entry.spec.modes.map((_, i) => i)); if (index == null) continue;
          mode = entry.spec.modes[index].value; entry.spec = game.skillActionSpec(humanId, { skillId: entry.skillId, mode });
        }
        if ((entry.spec.cardCount ?? 0) > 0 || entry.spec.cardCounts) {
          const sets=cardSets(player.hand,entry.spec);
          sets.forEach((cards,index)=>tui.console(`${index}: ${cards.map(cardText).join("、")}`));
          const chosen=await askIndex(tui,"费用牌组（回车取消）> ",sets.map((_,i)=>i));
          if(chosen==null)continue;
          cardIds.push(...sets[chosen].map(c=>c.id));
        }
        const counts=targetCounts(entry.spec,cardIds.length);
        const targetCount=counts.length===1?counts[0]:await askIndex(tui,"目标人数> ",counts);
        if(targetCount==null)continue;
        entry.spec={...entry.spec,targetCount};
        while (targetIds.length < (entry.spec.targetCount ?? 1)) {
          const id = await askIndex(tui, "目标（回车取消）> ", entry.spec.targets.filter(id => !targetIds.includes(id))); if (id == null) break;
          targetIds.push(id);
        }
        if (targetIds.length !== (entry.spec.targetCount ?? 1)) continue;
        await game.executeAction(humanId, { type: "skill", skillId: entry.skillId, mode, cardIds, targetIds }, { chooseResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
      } else if (command === "buy") await game.executeAction(humanId, { type: "purchase" }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
      else if (command === "synth") await game.executeAction(humanId, { type: "synthesize", gemCount: await chooseSynthesis(player) }, { overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
      else if (command === "refine") await game.executeAction(humanId, { type: "refine", stones: await chooseRefinement(player) });
      else if (command === "play") {
        const index = Number(indexText), card = player.hand[index];
        if (!card) throw new RuleError("无效的手牌编号");
        const targets = game.legalTargets(humanId, card);
        if (!targets.length) throw new RuleError("这张牌目前不可使用");
        const target = card.name === "magicBullet" && targetText == null && targets.length === 1 ? targets[0] : Number(targetText);
        if (!targets.includes(target)) throw new RuleError(`合法目标：${targets.join("、")}`);
        await playCard(humanId, index, target);
      } else {
        tui.console("play 牌号 目标号；魔弹有多个方向时也需目标号；buy购买；synth合成；refine提炼；skill英雄技能；refresh申请无法行动换牌；end放弃额外行动；quit退出。Tab切换面板，PgUp/PgDn滚动。");
        continue;
      }
      await resolveHumanOverflow();
      flushLog(); return true;
    } catch (error) {
      tui.console(error instanceof RuleError ? `规则错误：${error.message}` : error.stack);
    }
  }
}

async function chooseResponse(context) {
  const { target, valid, actor } = context;
  if (target.id !== humanId) return chooseAiResponse(game, context);
  while (true) {
    showState();
    tui.console(`${actor.name}向你发动${context.attack ? "攻击" : "魔弹"}；可响应：${valid.map(item => `${item.index}:${cardText(item.card)}`).join("，")}`);
    const index = await askIndex(tui, "响应牌号（回车放弃）> ", valid.map(item => item.index));
    if (index == null) return null;
    const picked = valid.find(item => item.index === index);
    if (picked.card.name === "holyLight") {
      if ((await tui.question("使用圣光？输入yes确认，回车重新选牌> ")).trim() === "yes") return { index };
    } else {
      const targets = context.attack ? context.counterTargets.map(player => player.id) : [context.nextTarget.id];
      const targetId = await askIndex(tui, `目标(${targets.join("/")})，回车重新选牌> `, targets);
      if (targetId != null) return { index, targetId };
    }
  }
}
async function playCard(actorId, index, targetId) {
  const card = game.player(actorId).hand[index];
  const options = { chooseResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow };
  if (card.type === "attack") return game.attackWithDecisions(actorId, index, targetId, options);
  if (card.name === "magicBullet") return game.playMagicWithDecisions(actorId, index, { ...options, targetId });
  return game.playWithDecisions(actorId, index, targetId, options);
}
async function aiTurn(actorId, retried = false) {
  const action = chooseAiAction(game, actorId);
  try {
    if (["refresh", "purchase", "synthesize", "refine", "skill"].includes(action.type)) {
      return await game.executeAction(actorId, action, { chooseResponse, overflow: overflowPolicy, resolveOverflow: resolveHumanOverflow });
    }
    if (action.type === "pass") return game.skipExtraActions(actorId);
    return await playCard(actorId, action.index, action.targetId);
  } catch (error) {
    if (error.actionInvalidated && !retried && !game.winner) return aiTurn(actorId, true);
    throw error;
  }
}

tui.console(`星杯传说 CLI，你控制${game.player(humanId).name}。Tab切换滚动面板，PgUp/PgDn滚动。`);
showState();
let running = true;
while (running && !game.winner) {
  const player = game.player(game.current);
  turnDivider(player.name, "开始");
  const turn = await game.beginTurn(player.id, {
    chooseWeakness: async () => player.id === humanId
      ? ((await tui.question("虚弱：draw摸3张，否则跳过> ")).trim() === "draw" ? "draw" : "skip")
      : chooseAiRuleDecision({ type: "weakness", playerId: player.id }, game),
    resolveOverflow: resolveHumanOverflow,
  }, { overflow: overflowPolicy });
  await resolveHumanOverflow();
  flushLog();
  do {
  if (!turn.skipped && !game.winner) {
    if (player.id === humanId) running = await humanTurn();
    else { await aiTurn(player.id); await resolveHumanOverflow(); flushLog(); }
  }
  if (player.id !== humanId && game.turn.hasExtraActions() && !game.legalCards(player.id).length && !game.legalSkillActions(player.id).length) game.skipExtraActions(player.id);
  } while (running && game.turn.needsAction());
  if (game.winner) break;
  if (!running) break; // Quitting the client is not completing an ordinary action.
  turnDivider(player.name, "结束");
  showState();
  await game.endTurnWithDecisions({ resolveOverflow: resolveHumanOverflow });
}

if (game.winner) tui.console(`游戏结束：${game.winner === "red" ? "红方" : "蓝方"}获胜！`);
tui.close();
