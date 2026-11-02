import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { enemies, discardCost } from '../shared/actions.js';

export class Fighter extends Hero {
  constructor(enabled = true) {
    super({ id: 'fighter', name: '格斗家' });
    this.state = { spirit: 0, form: null, lockedTarget: null };
    if (!enabled) return;
    const reset = (game, player) => {
      this.state.form = null; this.state.lockedTarget = null;
      game.logSkill(player.id, 'hundredDragonFist', '重置，结束百式幻龙拳');
    };
    this.skills = [
      { id: 'spiritField', name: '念气立场', ...this.onDamage([Timing.DAMAGE_BEFORE], 'target'), priority: -100,
        filter: ({ context }) => context.amount > 4,
        resolve({ game, player, context }) { context.amount = 4; game.logSkill(player.id, 'spiritField', '本次伤害上限为4'); } },
      { id: 'hundredDragonFist', name: '百式幻龙拳', ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: () => this.state.spirit >= 3,
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, 'hundredDragonFist', '百式幻龙拳：移除3斗气'))) return;
          player.hero.state.spirit -= 3;
          if (!player.hero.state.form) player.hero.state.lockedTarget = null;
          player.hero.state.form = 'dragonFist';
          game.logSkill(player.id, 'hundredDragonFist', '移除3斗气，横置；同一目标主动攻击+2，应战+1');
        } },
      { id: 'dragonFistRoute', name: '百式幻龙拳持续', ...this.onOwnTurn([Timing.SPELL_ACTION_START, Timing.SPECIAL_ACTION_START]),
        filter: () => !!this.state.form, resolve: ({ game, player }) => reset(game, player) },
      { id: 'dragonFistAttack', name: '百式幻龙拳攻击', ...this.onOwnAttack([Timing.ATTACK_DECLARED]), priority: 10,
        filter: () => !!this.state.form,
        resolve: ({ game, player, context }) => {
          if (!context.isCounter) {
            if (this.state.lockedTarget != null && this.state.lockedTarget !== context.targetId) { reset(game, player); return; }
            this.state.lockedTarget = context.targetId;
          }
          context.amount += context.isCounter ? 1 : 2;
          game.logSkill(player.id, 'hundredDragonFist', `本次攻击伤害+${context.isCounter ? 1 : 2}`);
        } },
      { id: 'chargedStrike', name: '蓄力一击', ...this.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_MISS]),
        filter: ({ timing, context }) => timing === Timing.ATTACK_MISS ? !!context.chargedStrike :
          this.isActiveAttack(context) && !this.state.form && this.state.spirit < 6 && !context.stunningBlow,
        *resolve({ game, player, timing, context, options }) {
          if (timing === Timing.ATTACK_MISS) {
            yield* game.damageSteps(player.id, player.hero.state.spirit, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'chargedStrike' }); return;
          }
          if (!(yield* game.offerSkill(player.id, 'chargedStrike', '蓄力一击', context))) return;
          player.hero.state.spirit++; context.chargedStrike = true; context.amount++;
          game.logSkill(player.id, 'chargedStrike', `斗气+1（${player.hero.state.spirit}/6），攻击+1；未命中则承受斗气数量的法伤`);
        } },
      { id: 'stunningBlow', name: '气绝崩击', ...this.onOwnAttack([Timing.ATTACK_DECLARED]), priority: -1,
        filter: ({ context }) => this.isActiveAttack(context) && this.state.spirit > 0 && !context.chargedStrike,
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, 'stunningBlow', '气绝崩击', context))) return;
          player.hero.state.spirit--; context.stunningBlow = true; context.canCounter = false;
          game.logSkill(player.id, 'stunningBlow', `移除1斗气，攻击无法应战；立即承受${player.hero.state.spirit}法术伤害`);
          yield* game.damageSteps(player.id, player.hero.state.spirit, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'stunningBlow' });
        } },
      { id: 'spiritBullet', name: '念弹', ...this.onOwnTurn([Timing.SPELL_ACTION_END]),
        filter: () => this.state.spirit < 6,
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, 'spiritBullet', '念弹'))) return;
          player.hero.state.spirit++;
          const targetId = yield* game.choosePlayer(player.id, enemies(game, player), '念弹：选择对手', { skillId: 'spiritBullet' });
          const recoil = game.player(targetId).healing === 0;
          game.logSkill(player.id, 'spiritBullet', `斗气+1，对${game.actorLabel(targetId)}造成1法伤${recoil ? '，随后自身承受斗气数量的法伤' : ''}`);
          yield* game.damageSteps(targetId, 1, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'spiritBullet' });
          if (!game.winner && recoil) yield* game.damageSteps(player.id, player.hero.state.spirit, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'spiritBullet' });
        } },
      { id: 'warGodBody', name: '斗神天驱', ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, 'crystal'),
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, 'warGodBody', '斗神天驱'))) return;
          yield* game.paySkillEnergy(player.id, 'crystal');
          if (player.hand.length > 3) {
            const cards = yield* game.chooseHandCards(player.id, player.hand.length - 3, () => true, { skillId: 'warGodBody', title: '斗神天驱：暗弃到3张牌' });
            yield* discardCost(game, player, cards, 'warGodBody', options, 'hidden');
          }
          game.changeHealing(player.id, 2);
          game.logSkill(player.id, 'warGodBody', '弃到3张牌，获得2治疗');
        } },
    ];
  }
}
