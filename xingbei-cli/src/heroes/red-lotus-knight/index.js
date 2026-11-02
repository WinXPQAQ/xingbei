import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, discardCost, extraAction, targets } from '../shared/actions.js';
export class RedLotusKnight extends Hero {
  constructor(enabled = true) {
    super({ id: 'redLotusKnight', name: '红莲骑士' });
    this.state = { bloodSeals: 0, form: null };
    if (!enabled) return;
    this.skills = [
      { id: 'scarletFaith', name: '猩红信仰', ...this.onDamage([Timing.HEALING_BEFORE], 'target'),
        modifyHealingLimit: limit => limit + 2,
        resolve({ player, context }) { if (context.sourceId !== player.id) context.healingLimit = 0; } },
      { id: 'scarletCovenant', name: '腥红圣约', ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ game, context }) => this.isActiveAttack(context) && !game.turn.state?.usedSkills.scarletCovenant,
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, 'scarletCovenant', '腥红圣约'))) return;
          if (game.turn.state) game.turn.state.usedSkills.scarletCovenant = true;
          game.changeHealing(player.id, 1); game.logSkill(player.id, 'scarletCovenant', '获得1治疗');
        } },
      { id: 'bloodPrayer', name: '血腥祷言', ...this.onOwnTurn([Timing.ACTIVATION]),
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, 'bloodPrayer', '血腥祷言'))) return;
          const count = yield* choice(player.id, 'bloodPrayer', '移除X治疗并承受X法伤',
            Array.from({ length: player.healing + 1 }, (_, value) => ({ value, label: `${value}治疗` })), 0);
          game.changeHealing(player.id, -count);
          yield* game.damageSteps(player.id, count, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'bloodPrayer' });
          if (game.winner) return;
          const allies = game.players.filter(p => p.team === player.team && p.id !== player.id).map(p => p.id);
          for (let i = 0; i < count && !game.winner; i++) {
            const targetId = yield* game.choosePlayer(player.id, allies, '血腥祷言：分配1治疗给队友', { skillId: 'bloodPrayer' });
            game.changeHealing(targetId, 1);
          }
          player.hero.state.bloodSeals = Math.min(2, player.hero.state.bloodSeals + 1);
          game.logSkill(player.id, 'bloodPrayer', `移除${count}治疗并承受${count}法伤，分配${count}治疗，血印+1`);
        } },
      { id: 'slaughterFeast', name: '杀戮盛宴', ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => this.isActiveAttack(context) && this.state.bloodSeals > 0,
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, 'slaughterFeast', '杀戮盛宴', context))) return;
          player.hero.state.bloodSeals--;
          yield* game.damageSteps(player.id, 4, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'slaughterFeast' });
          if (game.winner) return;
          context.amount += 2; game.logSkill(player.id, 'slaughterFeast', '移除1血印，承受4法伤，本次攻击+2');
        } },
      { id: 'boilingBlood', name: '热血沸腾', ...this.onOwnTurn([Timing.MORALE_BEFORE, Timing.TURN_END]),
        filter: ({ timing, context }) => timing === Timing.TURN_END ? !!this.state.form : context.amount < 0 && context.cause?.type === 'damage',
        resolve({ game, player, timing, context }) {
          if (timing === Timing.TURN_END) {
            player.hero.state.form = null; game.changeHealing(player.id, 2);
            game.logSkill(player.id, 'boilingBlood', '回合结束重置，获得2治疗');
          } else if (player.hero.state.form) {
            context.amount = 0; game.logSkill(player.id, 'boilingBlood', '本次伤害爆牌不降低士气');
          } else {
            player.hero.state.form = 'boilingBlood';
            game.logSkill(player.id, 'boilingBlood', `本次士气下降${-context.amount}，横置；后续承伤不降士气`);
          }
        } },
      { id: 'temperance', name: '戒骄戒躁', ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        filter: ({ game, player }) => !!this.state.form && game.canPayEnergy(player.id, 'crystal'),
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, 'temperance', '戒骄戒躁'))) return;
          yield* game.paySkillEnergy(player.id, 'crystal'); player.hero.state.form = null;
          game.logSkill(player.id, 'temperance', '重置，脱离热血沸腾');
          yield* extraAction(game, player, 'temperance');
        } },
      { id: 'scarletCross', name: '猩红十字',
        action(game, player) { return player.hero.state.bloodSeals > 0 ? { type: 'spell', energy: 'crystal', cardCount: 2,
          cardFilter: c => c.type === 'spell', targets: targets(game) } : null; },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, 'crystal'); player.hero.state.bloodSeals--;
          yield* discardCost(game, player, cards, 'scarletCross', options);
          yield* game.damageSteps(player.id, 4, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'scarletCross' });
          if (!game.winner) yield* game.damageSteps(targetIds[0], 3, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'scarletCross' });
        } },
    ];
  }
}
