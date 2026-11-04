import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, discardCost, hasElement, enemies, targets } from '../shared/actions.js';

export class AzureFlameWitch extends Hero {
  constructor(enabled = true) {
    super({ id: 'azureFlameWitch', name: '苍炎魔女' });
    this.state = { rebirth: 0, form: null };
    if (!enabled) return;
    this.skills = [
      ...[['azureCodex', '苍炎法典', 1, 2], ['skyfireRift', '天火断空', 2, 3]].map(([id, name, count, amount]) => ({
        id, name,
        action(game, player) {
          if (id === 'skyfireRift' && !player.hero.state.form && !player.hero.state.rebirth) return null;
          return { type: 'spell', cardCount: count, cardFilter: c => hasElement(game, player, c, 'fire'), targets: targets(game) };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          if (id === 'skyfireRift' && !player.hero.state.form) player.hero.state.rebirth--;
          const bonus = id === 'skyfireRift' && game.teams[player.team].morale < game.teams[game.player(targetIds[0]).team].morale ? 1 : 0;
          yield* discardCost(game, player, cards, id, options);
          game.logSkill(player.id, id, `先对${game.actorLabel(targetIds[0])}、再对自身各造成${amount + bonus}法术伤害`);
          for (const targetId of [targetIds[0], player.id]) {
            if (game.winner) return;
            yield* game.damageSteps(targetId, amount + bonus, { ...options, sourceId: player.id, damageType: 'spell', skillId: id });
          }
        },
      })),
      { id: 'witchWrath', name: '魔女之怒', ...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true,
        filter: ({ player }) => !this.state.form && player.hand.length < 4,
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, 'witchWrath', '魔女之怒'))) return;
          player.hero.state.form = 'flame';
          game.logSkill(player.id, 'witchWrath', '进入烈焰形态，攻击属性及手牌上限改变');
          const count = yield* choice(player.id, 'witchWrath', '魔女之怒：摸0至2张牌', [0, 1, 2].map(value => ({ value, label: `摸${value}张` })), 0);
          yield* game.drawSteps(player.id, count, { ...options, cause: { type: 'directDraw', skillId: 'witchWrath' } });
        } },
      { id: 'flameTraits', name: '烈焰形态',
        modifyHandLimit: limit => this.state.form ? limit + this.state.rebirth - 2 : limit,
        modifyTraits: ({ player, playerId, card }, traits) => {
          if (!this.state.form || playerId !== player.id || card.type !== 'attack') return traits;
          return { ...traits, elements: [...new Set(traits.elements.map(e => ['water', 'dark'].includes(e) ? e : 'fire'))] };
        },
      },
      // Timing workbook: poison (3), fivefold binding (2), weakness (1), then reset.
      { id: 'flameReset', name: '烈焰形态结束', ...this.onOwnTurn([Timing.ACTION_PHASE_BEFORE]), priority: 0,
        filter: () => !!this.state.form,
        *resolve({ game, player, options }) {
          player.hero.state.form = null;
          game.logSkill(player.id, 'witchWrath', '行动阶段开始前重置，脱离烈焰形态');
          // Ending the form can lower the hand limit when rebirth exceeds two.
          yield* game.drawSteps(player.id, 0, { ...options, cause: { type: 'handLimit', skillId: 'flameReset' } });
        } },
      { id: 'substituteDoll', name: '替身玩偶', ...this.onDamage([Timing.DAMAGE_BEFORE], 'target', ['attack']),
        filter: ({ player }) => player.hand.some(c => c.type === 'spell'),
        *resolve({ game, player, options }) {
          const cards = yield* game.chooseHandCards(player.id, 1, c => c.type === 'spell', { skillId: 'substituteDoll', title: '替身玩偶：可明弃1张法术牌', optional: true });
          if (!cards) return;
          const targetId = yield* game.choosePlayer(player.id, game.players.filter(p => p.team === player.team && p.id !== player.id).map(p => p.id), '替身玩偶：选择摸1张牌的队友', { skillId: 'substituteDoll' });
          yield* discardCost(game, player, cards, 'substituteDoll', options);
          game.logSkill(player.id, 'substituteDoll', `${game.actorLabel(targetId)}强制摸1张牌，原攻击伤害数值不变`);
          yield* game.drawSteps(targetId, 1, { ...options, cause: { type: 'directDraw', sourceId: player.id, skillId: 'substituteDoll' } });
        } },
      { id: 'immortalClock', name: '永生银时计', ...this.onOwnTurn([Timing.MORALE_AFTER]),
        filter: ({ context }) => context.amount < 0 && context.cause?.type === 'damage' && context.cause.damageType === 'spell',
        resolve({ game, player }) {
          const before = player.hero.state.rebirth;
          player.hero.state.rebirth = Math.min(4, before + 1);
          game.logSkill(player.id, 'immortalClock', `承受法伤导致士气下降，重生+${player.hero.state.rebirth - before}（${player.hero.state.rebirth}/4）`);
        } },
      { id: 'painLink', name: '痛苦链接',
        action(game, player) { return { type: 'spell', energy: 'crystal', targets: enemies(game, player) }; },
        *resolveAction({ game, player, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, 'crystal');
          for (const targetId of [targetIds[0], player.id]) {
            if (game.winner) return;
            yield* game.damageSteps(targetId, 1, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'painLink' });
          }
          if (game.winner || player.hand.length <= 3) return;
          const cards = yield* game.chooseHandCards(player.id, player.hand.length - 3, () => true, { skillId: 'painLink', title: '痛苦链接：暗弃到3张牌' });
          yield* discardCost(game, player, cards, 'painLink', options, 'hidden');
        } },
      { id: 'manaInversion', name: '魔能反转', ...this.onDamage([Timing.DAMAGE_BEFORE], 'target', ['spell']),
        filter: ({ game, player }) => game.canPayEnergy(player.id, 'crystal') && player.hand.filter(c => c.type === 'spell').length >= 2,
        *resolve({ game, player, options }) {
          const max = player.hand.filter(c => c.type === 'spell').length;
          const cards = yield* game.chooseCardSet(player.id, { counts: Array.from({ length: max - 1 }, (_, i) => i + 2), cardsFilter: cs => cs.every(c => c.type === 'spell'),
            skillId: 'manaInversion', title: '魔能反转：可明弃至少2张法术牌', optional: true });
          if (!cards) return;
          const targetId = yield* game.choosePlayer(player.id, enemies(game, player), '魔能反转：选择法伤目标', { skillId: 'manaInversion' });
          yield* game.paySkillEnergy(player.id, 'crystal');
          yield* discardCost(game, player, cards, 'manaInversion', options);
          game.logSkill(player.id, 'manaInversion', `对${game.actorLabel(targetId)}造成${cards.length - 1}法伤，原伤害不变`);
          yield* game.damageSteps(targetId, cards.length - 1, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'manaInversion' });
        } },
    ];
  }
}
