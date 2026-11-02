import { Hero } from '../../hero-base.js';
import { ExclusiveCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { sameElements } from '../../card-sets.js';
import { choice, discardCost, targets, enemies } from '../shared/actions.js';

function* discardUpTo(game, player, count, skillId, options) {
  count = Math.min(count, player.hand.length);
  if (!count) return;
  const cards = yield* game.chooseHandCards(player.id, count, () => true, { skillId, title: `${skillId === 'passionateRhapsody' ? '激昂狂想曲' : '不谐和弦'}：暗弃${count}张牌` });
  yield* discardCost(game, player, cards, skillId, options, 'hidden');
}
function* forbiddenPoem(game, bard, card, options) {
  if (game.winner) return;
  if (bard.hero.state.inspiration < 3) {
    bard.hero.state.inspiration++;
    game.moveCard(card.id, { zone: 'outside' });
    game.logSkill(bard.id, 'forbiddenPoem', '灵感+1，移除永恒乐章');
  } else {
    yield* game.damageSteps(bard.id, 3, { ...options, sourceId: bard.id, damageType: 'spell', skillId: 'forbiddenPoem' });
    if (game.winner) return;
    bard.hero.state.form = 'eternalPrisoner';
    game.logSkill(bard.id, 'forbiddenPoem', '承受3法伤，进入永恒囚徒形态');
  }
}
const songSkills = [
  { id: 'passionateRhapsody', name: '激昂狂想曲', timings: [Timing.TURN_START], bindings: [{ role: 'player', players: 'self' }],
    *resolve({ game, player, sourceCard, options }) {
      if (!(yield* game.offerSkill(player.id, 'passionateRhapsody', '激昂狂想曲'))) return;
      const bard = game.player(sourceCard.attachment.sourcePlayerId);
      const mode = yield* choice(player.id, 'passionateRhapsody', '激昂狂想曲：选择效果', [
        { value: 'damage', label: '吟游诗人对两名对手各造成1法伤' }, { value: 'discard', label: '你暗弃2张牌' },
      ], 'damage');
      if (mode === 'discard') yield* discardUpTo(game, player, 2, 'passionateRhapsody', options);
      else {
        const choices = enemies(game, bard), selected = [];
        for (let i = 0; i < 2; i++) selected.push(yield* game.choosePlayer(bard.id, choices.filter(id => !selected.includes(id)), '激昂狂想曲：选择两名不同对手', { skillId: 'passionateRhapsody' }));
        selected.sort((a, b) => (a - player.id + 6) % 6 - (b - player.id + 6) % 6);
        for (const id of selected) if (!game.winner) yield* game.damageSteps(id, 1, { ...options, sourceId: bard.id, damageType: 'spell', skillId: 'passionateRhapsody' });
      }
      yield* forbiddenPoem(game, bard, sourceCard, options);
    } },
  { id: 'victorySymphony', name: '胜利交响诗', timings: [Timing.TURN_END], bindings: [{ role: 'player', players: 'self' }],
    *resolve({ game, player, sourceCard, options }) {
      if (!(yield* game.offerSkill(player.id, 'victorySymphony', '胜利交响诗'))) return;
      const bard = game.player(sourceCard.attachment.sourcePlayerId), counts = game.stoneCounts(player.team);
      const room = player.energy.gem + player.energy.crystal < game.getEnergyLimit(player.id);
      const mode = yield* choice(player.id, 'victorySymphony', '胜利交响诗：选择效果', [
        { value: 'gain', label: '战绩区+1宝石，你+1治疗' },
        ...(['gem', 'crystal'].filter(kind => room && counts[kind]).map(value => ({ value, label: `移除战绩区1${value === 'gem' ? '宝石' : '水晶'}，你获得1宝石` }))),
      ], 'gain');
      if (mode === 'gain') { game.addStones(player.team, 'gem'); game.changeHealing(player.id, 1); }
      else { game.removeStones(player.team, { gem: Number(mode === 'gem'), crystal: Number(mode === 'crystal') }); game.gainEnergy(player.id, 'gem'); }
      game.logSkill(player.id, 'victorySymphony', mode === 'gain' ? '战绩区+1宝石，自身+1治疗' : '移除1战绩星石，自身获得1宝石');
      if (bard.hero.state.form && bard.id !== player.id) {
        game.changeHealing(bard.id, 1); game.logSkill(bard.id, 'eternalPrisoner', '队友发动胜利交响诗，获得1治疗');
      }
      yield* forbiddenPoem(game, bard, sourceCard, options);
    } },
];
export class Bard extends Hero {
  constructor(enabled = true) {
    super({ id: 'bard', name: '吟游诗人' });
    this.state = { movementCardId: null, inspiration: 0, form: null, damagedEnemies: [], concertoUsed: false };
    if (!enabled) return;
    this.skills = [
      { id: 'concertoReset', name: '沉沦协奏曲计数', ...this.bind('player', [Timing.TURN_BEFORE], 'all'),
        resolve: () => { this.state.damagedEnemies = []; this.state.concertoUsed = false; } },
      { id: 'sinkingConcerto', name: '沉沦协奏曲', ...this.bind('actor', [Timing.DAMAGE_BEFORE], 'team', ['spell']), priority: 1,
        filter: ({ game, context }) => context.sourceId != null && game.player(context.targetId).team !== game.player(context.sourceId).team,
        *resolve({ game, player, context, options }) {
          const state = player.hero.state;
          if (!state.damagedEnemies.includes(context.targetId)) state.damagedEnemies.push(context.targetId);
          if (state.form || state.concertoUsed || state.damagedEnemies.length < 2) return;
          const cards = yield* game.chooseCardSet(player.id, { counts: [2], cardsFilter: cards => sameElements(game, player.id, cards),
            skillId: 'sinkingConcerto', title: '沉沦协奏曲：可明弃两张同系牌', optional: true });
          if (!cards) return;
          state.concertoUsed = true;
          const spell = cards.some(c => c.type === 'spell');
          yield* discardCost(game, player, cards, 'sinkingConcerto', options);
          state.inspiration = Math.min(3, state.inspiration + 1);
          game.logSkill(player.id, 'sinkingConcerto', '时点3明弃两张同系牌，灵感+1');
          if (spell && !game.winner) {
            const id = yield* game.choosePlayer(player.id, enemies(game, player), '沉沦协奏曲：选择1法伤目标', { skillId: 'sinkingConcerto' });
            yield* game.damageSteps(id, 1, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'sinkingConcerto' });
          }
        } },
      { id: 'eternalPrisoner', name: '永恒囚徒形态', ...this.onDamage([Timing.DAMAGE_BEFORE], 'target', ['spell']), priority: -1,
        filter: () => !!this.state.form,
        resolve({ game, player, context }) { context.amount = Math.max(0, context.amount - 1); game.logSkill(player.id, 'eternalPrisoner', '承受的法术伤害−1'); } },
      { id: 'forbiddenPoem', name: '禁忌诗篇' },
      { id: 'dissonance', name: '不谐和弦',
        action(game, player, action = {}) {
          const modes = [2, 3].filter(n => n <= player.hero.state.inspiration).flatMap(n => ['draw', 'discard'].map(kind => ({ value: `${kind}:${n}`, label: `移除${n}灵感，双方${kind === 'draw' ? '摸' : '弃'}${n - 1}牌` })));
          return !modes.length || (action.mode && !modes.some(m => m.value === action.mode)) ? null : { type: 'spell', targets: targets(game), modes };
        },
        *resolveAction({ game, player, targetIds, action, options }) {
          const [kind, count] = (action.mode ?? 'draw:2').split(':'), n = Number(count);
          player.hero.state.inspiration -= n; player.hero.state.form = null;
          game.logSkill(player.id, 'dissonance', `移除${n}灵感并重置，双方${kind === 'draw' ? '摸' : '弃'}${n - 1}牌`);
          for (const id of [player.id, targetIds[0]]) {
            if (game.winner) return;
            if (kind === 'draw') yield* game.drawSteps(id, n - 1, { ...options, cause: { type: 'directDraw', skillId: 'dissonance' } });
            else yield* discardUpTo(game, game.player(id), n - 1, 'dissonance', options);
          }
        } },
      { id: 'hopeFugue', name: '希望赋格曲', ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, 'crystal'),
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, 'hopeFugue', '希望赋格曲'))) return;
          yield* game.paySkillEnergy(player.id, 'crystal');
          const draw = yield* choice(player.id, 'hopeFugue', '是否摸1张牌', [{ value: 0, label: '不摸' }, { value: 1, label: '摸1张' }], 0);
          if (draw) yield* game.drawSteps(player.id, 1, { ...options, cause: { type: 'directDraw', skillId: 'hopeFugue' } });
          if (game.winner) return;
          const card = game.cards.get(`eternalMovement-${player.id}`), moving = card.location.zone === 'status';
          const previous = moving ? card.location.playerId : player.id;
          const id = yield* game.choosePlayer(player.id, game.players.filter(p => p.team === player.team && p.id !== previous).map(p => p.id), '希望赋格曲：放置或转移永恒乐章', { skillId: 'hopeFugue' });
          game.attachCard(card.id, id, { effectId: 'eternalMovement', sourcePlayerId: player.id, sourceSkillId: 'hopeFugue' });
          if (!moving) return;
          yield* discardUpTo(game, player, 1, 'hopeFugue', options);
          const reward = yield* choice(player.id, 'hopeFugue', '选择转移奖励', [{ value: 'healing', label: '+1治疗' }, { value: 'inspiration', label: '+1灵感' }], 'inspiration');
          if (reward === 'healing') game.changeHealing(player.id, 1);
          else player.hero.state.inspiration = Math.min(3, player.hero.state.inspiration + 1);
          game.logSkill(player.id, 'hopeFugue', `转移乐章、弃1牌，${reward === 'healing' ? '治疗' : '灵感'}+1`);
        } },
    ];
  }
  initialize(game, player) {
    if (!this.skills.length) return;
    this.state.movementCardId = `eternalMovement-${player.id}`;
    if (!game.effects.has('eternalMovement')) game.registerEffect('eternalMovement', { id: 'eternalMovement', name: '永恒乐章', category: 'exclusive' });
    game.registerCard(new ExclusiveCard({ id: `eternalMovement-${player.id}`, name: 'eternalMovement', heroId: this.id, skills: songSkills }), { zone: 'outside' });
  }
}
