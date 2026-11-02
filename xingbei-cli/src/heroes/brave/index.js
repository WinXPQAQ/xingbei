import { Hero } from '../../hero-base.js';
import { ExclusiveCard } from '../../card.js';
import { Timing } from '../../timing.js';
import { choice, discardCost, enemies, hasElement } from '../shared/actions.js';

export const provocationEffect = {
  id: 'provocation', name: '挑衅', category: 'exclusive', stackable: false,
  timings: [Timing.ACTION_PHASE_START, Timing.ACTIVATION, Timing.ACTION_PHASE_END, Timing.ACTION_PHASE_SKIPPED],
  bindings: [{ role: 'player', players: 'self' }], priority: -100,
  allowsAction: ({ type }) => type === 'attack',
  allowsAttackTarget: ({ targetId, isCounter, card }) => isCounter || targetId === card.attachment.sourcePlayerId,
  *resolve({ game, player, card, timing, context }) {
    if ([Timing.ACTION_PHASE_END, Timing.ACTION_PHASE_SKIPPED].includes(timing)) { game.moveCard(card.id, { zone: 'outside' }); return; }
    const source = card.attachment.sourcePlayerId;
    const available = player.hand.some(c => c.type === 'attack' && game.allowsCard(player.id, c) && game.canAttackTarget(player.id, source)) ||
      game.legalSkillActions(player.id).some(a => a.spec.type === 'attack');
    const skip = yield* choice(player.id, 'provocation', '挑衅：只能主动攻击勇者，否则跳过行动阶段', [
      { value: 'skip', label: '跳过行动阶段' }, ...(available ? [{ value: 'attack', label: '继续攻击勇者' }] : []),
    ], 'skip', { targetId: source });
    if (skip === 'skip') {
      context.skipped = true; game.moveCard(card.id, { zone: 'outside' });
      game.logSkill(player.id, 'provocation', '跳过行动阶段，移除挑衅');
    }
  },
};
export class Brave extends Hero {
  constructor(enabled = true) {
    super({ id: 'brave', name: '勇者' }); this.state = { provocationCardId: null, rage: 0, intellect: 0, form: null };
    if (!enabled) return;
    this.skills = [
      { id: 'braveHeart', name: '勇者之心' },
      { id: 'roar', name: '怒吼', ...this.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_MISS]),
        filter: ({ timing, context }) => timing === Timing.ATTACK_MISS ? !!context.braveRoar : this.isActiveAttack(context) && this.state.rage > 0,
        *resolve({ game, player, timing, context, options }) {
          if (timing === Timing.ATTACK_MISS) { player.hero.state.intellect = Math.min(4, player.hero.state.intellect + 1); game.logSkill(player.id, 'roar', '未命中，知性+1'); return; }
          if (!(yield* game.offerSkill(player.id, 'roar', '怒吼', context))) return;
          player.hero.state.rage--; context.amount += 2; context.braveRoar = true;
          const count = yield* choice(player.id, 'roar', '怒吼：是否摸1张牌', [{ value: 0, label: '不摸' }, { value: 1, label: '摸1张' }], 0);
          game.logSkill(player.id, 'roar', `移除1怒气，攻击+2，摸${count}张牌`);
          if (count) yield* game.drawSteps(player.id, 1, { ...options, cause: { type: 'directDraw', skillId: 'roar' } });
        } },
      { id: 'stillMind', name: '明镜止水', ...this.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_RESOLVED]),
        filter: ({ timing, context }) => timing === Timing.ATTACK_RESOLVED ? !!context.stillMind : this.isActiveAttack(context) && this.state.intellect >= 4,
        *resolve({ game, player, timing, context }) {
          if (timing === Timing.ATTACK_RESOLVED) { game.gainEnergy(player.id, 'crystal'); game.logSkill(player.id, 'stillMind', '本次攻击结束，获得1水晶'); return; }
          if (!(yield* game.offerSkill(player.id, 'stillMind', '明镜止水', context))) return;
          player.hero.state.intellect -= 4; context.stillMind = true; context.canCounter = false;
          game.logSkill(player.id, 'stillMind', '移除4知性，本次攻击不能应战');
        } },
      { id: 'forbiddenPower', name: '禁断之力', ...this.onOwnAttack([Timing.ATTACK_HIT, Timing.ATTACK_MISS]), priority: -2,
        filter: ({ game, player, context }) => this.isActiveAttack(context) && game.canPayEnergy(player.id, 'crystal'),
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, 'forbiddenPower', '禁断之力', context))) return;
          yield* game.paySkillEnergy(player.id, 'crystal');
          const cards = [...player.hand], rage = cards.filter(c => c.type === 'spell').length;
          const count = cards.filter(c => hasElement(game, player, c, context.hit ? 'fire' : 'water')).length;
          yield* discardCost(game, player, cards, 'forbiddenPower', options);
          player.hero.state.rage = Math.min(4, player.hero.state.rage + rage);
          if (context.hit) {
            context.amount += count;
            yield* game.damageSteps(player.id, count, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'forbiddenPower' });
          } else player.hero.state.intellect = Math.min(4, player.hero.state.intellect + count);
          if (game.winner) return;
          player.hero.state.form = 'exhausted';
          game.logSkill(player.id, 'forbiddenPower', `明弃全部${cards.length}牌，怒气+${rage}，${context.hit ? '攻击加伤及自伤' : '知性增加'}${count}；进入精疲力竭，手限恒定4`);
          game.turn.addAttackAction({ sourceSkillId: 'forbiddenPower' });
          yield* game.drawSteps(player.id, 0, { ...options, cause: { type: 'handLimit', skillId: 'forbiddenPower' } });
        } },
      { id: 'exhaustion', name: '精疲力竭', ...this.onOwnTurn([Timing.ACTION_PHASE_START]), priority: 100,
        modifyHandLimit: limit => this.state.form ? 4 : limit, filter: () => !!this.state.form,
        *resolve({ game, player, options }) {
          player.hero.state.form = null; game.logSkill(player.id, 'exhaustion', '重置，恢复手限并承受3法伤');
          yield* game.damageSteps(player.id, 3, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'exhaustion' });
        } },
      { id: 'deathMatch', name: '死斗', ...this.onDamage([Timing.DAMAGE_ACTUAL], 'target', ['spell']), priority: -10,
        filter: ({ game, player }) => game.canPayEnergy(player.id, 'gem'),
        *resolve({ game, player, context }) {
          if (!(yield* game.offerSkill(player.id, 'deathMatch', '死斗', context))) return;
          yield* game.paySkillEnergy(player.id, 'gem'); player.hero.state.rage = Math.min(4, player.hero.state.rage + 3);
          context.moraleLimit = 1; game.logSkill(player.id, 'deathMatch', '怒气+3，本次伤害若降士气则最多降低1');
        } },
      { id: 'provocation', name: '挑衅',
        action(game, player) {
          const card = game.cards.get(`provocation-${player.id}`);
          return player.hero.state.rage > 0 && card.location.zone === 'outside' ? { type: 'spell', targets: enemies(game, player) } : null;
        },
        *resolveAction({ game, player, targetIds }) {
          player.hero.state.rage--; player.hero.state.intellect = Math.min(4, player.hero.state.intellect + 1);
          game.attachCard(`provocation-${player.id}`, targetIds[0], { effectId: 'provocation', sourcePlayerId: player.id, sourceSkillId: 'provocation' });
          game.logSkill(player.id, 'provocation', `移除1怒气，知性+1，挑衅${game.actorLabel(targetIds[0])}`);
        } },
    ];
  }
  initialize(game, player) {
    if (!this.skills.length) return;
    this.state.provocationCardId = `provocation-${player.id}`;
    game.gainEnergy(player.id, 'crystal', 2);
    if (!game.effects.has('provocation')) game.registerEffect('provocation', provocationEffect);
    game.registerCard(new ExclusiveCard({ id: `provocation-${player.id}`, name: 'provocation', heroId: this.id }), { zone: 'outside' });
  }
}
