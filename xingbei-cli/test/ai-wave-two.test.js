import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { getPolicy } from '../src/ai/versions.js';
import { moraleLoss } from '../src/ai/hero-wave-two/index.js';

const policy = getPolicy('v1.7.0-preview.1');
const old = getPolicy('v1.5');
const make = hero => new Game({ seed: 27, shuffleDeck: false, playerHeroId: hero });
const take = (g, id, predicate) => {
  const card = g.deck.find(typeof predicate === 'string' ? c => c.name === predicate : predicate);
  assert.ok(card, 'fixture card exists');
  g.moveCard(card.id, { zone: 'hand', playerId: id });
  return card;
};
const fill = (g, id, count) => { while (g.player(id).hand.length < count) take(g, id, () => true); };
const matching = (g, select, p = policy) => {
  const entry = p.rankAiActions(g, 0).find(({ action }) => select(action));
  assert.ok(entry, 'expected legal candidate');
  assert.ok(Number.isFinite(entry.score), 'finite candidate score');
  return entry.score;
};
const offer = (g, skillId, context) => policy.chooseAiRuleDecision({
  type: 'skillChoice', playerId: 0, skillId, context,
  choices: [{ value: true }, { value: false }], defaultValue: false,
}, g);

test('第二批留牌：圣女/元素师自身独有技高于同系普通刀，保留第一张圣光和暗灭', () => {
  for (const [hero, skill] of [['saint', 'healingLight'], ['elementalist', 'fireball']]) {
    const g = make(hero);
    const unique = take(g, 0, c => c.type === 'attack' && c.hasUniqueSkill(skill));
    const ordinary = take(g, 0, c => c.type === 'attack' && c.element === unique.element && !c.hasUniqueSkill(skill));
    const light = take(g, 0, 'holyLight'), dark = take(g, 0, 'darkStrike');
    assert.ok(policy.cardScore(g, 0, unique) > policy.cardScore(g, 0, ordinary));
    assert.ok(policy.cardScore(g, 0, light) > policy.cardScore(g, 0, unique));
    assert.ok(policy.cardScore(g, 0, dark) > policy.cardScore(g, 0, light));
    assert.deepEqual(policy.chooseAiDiscard(g, 0, 1), [g.player(0).hand.indexOf(ordinary)]);
    g.assertCardLocations();
  }
});

test('第二批留牌：圣女留水、圣枪留水/法术、瘟疫留地/法术，其他英雄标签不冒充自身专长', () => {
  for (const [hero, preferred] of [['saint', 'water'], ['holyLancer', 'water'], ['plagueMage', 'earth']]) {
    const g = make(hero);
    const special = take(g, 0, c => c.type === 'attack' && c.element === preferred && !c.hasUniqueSkill('healingLight'));
    const plain = take(g, 0, c => c.type === 'attack' && c.element === 'thunder');
    assert.ok(policy.cardScore(g, 0, special) > policy.cardScore(g, 0, plain), hero);
    if (hero !== 'saint') {
      const spell = take(g, 0, 'weakness');
      assert.ok(policy.cardScore(g, 0, spell) > policy.cardScore(g, 0, plain), `${hero} spell`);
    }
  }
});

test('圣枪天枪/地枪：看公开手数与增量士气；盾、治疗足以阻挡或空手时不浪费', () => {
  const g = make('holyLancer');
  g.player(0).healing = 4;
  fill(g, 1, 6);
  const context = { targetId: 1, amount: 2, isCounter: false };
  assert.equal(offer(g, 'heavenSpear', context), true);
  const shield = g.deck.find(c => c.name === 'holyShield');
  g.attachCard(shield.id, 1, { effectId: 'holyShield' });
  assert.equal(offer(g, 'heavenSpear', context), false);
  g.removeEffect(shield.id);
  g.player(1).healing = 2;
  assert.equal(offer(g, 'heavenSpear', context), false);
  g.player(1).healing = 0;
  const earth = () => policy.chooseAiRuleDecision({ type: 'numberChoice', playerId: 0,
    skillId: 'earthSpear', context, choices: [0, 1, 2, 3, 4].map(value => ({ value })), defaultValue: 0 }, g);
  assert.ok(earth() > 0);
  assert.ok(moraleLoss(g.player(1), 2 + earth()) > moraleLoss(g.player(1), 2));
  for (const c of [...g.player(1).hand]) g.moveCard(c.id, { zone: 'deck' });
  assert.equal(earth(), 0);
  assert.equal(offer(g, 'heavenSpear', context), false);
});

test('瘟疫法术权重：可获得不朽治疗时高于治疗已满；圣渎攻击治疗不计入防御', () => {
  const g = make('plagueMage');
  take(g, 0, 'poison');
  const spell = a => a.type === 'play' && a.index === 0 && a.targetId === 1;
  const lowBonus = matching(g, spell) - matching(g, spell, old);
  g.player(0).healing = g.getHealingLimit(0);
  const fullBonus = matching(g, spell) - matching(g, spell, old);
  assert.ok(lowBonus > fullBonus, 'spell action gets actual heal opportunity value');
  assert.equal(offer(g, 'immortality', {}), true);
  fill(g, 0, 6);
  assert.equal(moraleLoss(g.player(0), 2, 'attack'), 2);
  assert.equal(moraleLoss(g.player(0), 2, 'spell'), 0);
});

test('元素师提炼：单宝石例外、最多保留一水晶，并提高无能量时提炼权重', () => {
  const g = make('elementalist');
  g.addStones('red', 'gem', 1);
  const gem = a => a.type === 'refine' && a.stones.gem === 1 && a.stones.crystal === 0;
  assert.ok(matching(g, gem) > matching(g, gem, old));
  g.addStones('red', 'crystal', 1);
  const both = a => a.type === 'refine' && a.stones.gem === 1 && a.stones.crystal === 1;
  assert.ok(matching(g, both) > -1000);
  g.player(0).energy.crystal = 1;
  assert.ok(matching(g, gem) > matching(g, both), 'prefer one gem over a second personal crystal');
  assert.ok(matching(g, both) < -1000, 'second personal crystal disfavored');
  const h = make('elementalist'); h.addStones('red', 'crystal', 1);
  assert.ok(matching(h, a => a.type === 'refine') < -1000, 'single crystal is not the exception');
});

test('魔法少女：双石提炼增权、魔爆冲击优先选择有爆牌风险的对手，融合响应保留合法目标', () => {
  const g = make('magicalGirl');
  take(g, 0, 'poison'); take(g, 0, 'waterStrike');
  fill(g, 1, 6); fill(g, 2, 6);
  const burst = a => a.type === 'skill' && a.skillId === 'magicBurst' && a.targetIds.join() === '1,2';
  assert.ok(matching(g, burst) > matching(g, a => a.type === 'skill' && a.skillId === 'magicBurst' && a.targetIds.join() === '1,5'));
  g.addStones('red', 'gem', 1); g.addStones('red', 'crystal', 1);
  const refine = a => a.type === 'refine' && a.stones.gem === 1 && a.stones.crystal === 1;
  assert.ok(matching(g, refine) > matching(g, refine, old));
  const fire = take(g, 0, c => c.type === 'attack' && c.element === 'fire');
  const index = g.player(0).hand.indexOf(fire);
  const response = policy.chooseAiResponse(g, { target: g.player(0), actor: g.player(5), damage: 4,
    nextTarget: g.player(1), valid: [{ index, card: fire }] });
  assert.ok(response === null || response.index === index && response.targetId === 1);
});

test('第二批策略观测隔离：改变敌方隐藏手牌身份及未来牌序，不改变排序与技能选择', () => {
  for (const hero of ['saint', 'holyLancer', 'plagueMage', 'elementalist', 'magicalGirl']) {
    const g = make(hero);
    take(g, 0, 'waterStrike'); take(g, 0, 'poison'); take(g, 0, 'fireStrike');
    fill(g, 1, 4);
    const before = policy.rankAiActions(g, 0);
    const original = [...g.player(1).hand];
    for (const c of original) g.moveCard(c.id, { zone: 'outside' });
    for (let i = 0; i < original.length; i++) take(g, 1, c => c.name === 'holyLight');
    assert.deepEqual(policy.rankAiActions(g, 0), before, hero);
    g.assertCardLocations();
  }
});
