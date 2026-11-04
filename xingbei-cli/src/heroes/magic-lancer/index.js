import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { choice, discardCost, hasElement, targets } from '../shared/actions.js';

const eligible = (game, player, card) => card.type === 'spell' || hasElement(game, player, card, 'thunder');
export class MagicLancer extends Hero {
  constructor(enabled = true) {
    super({ id: 'magicLancer', name: '魔枪' });
    this.state = { form: null, attackBonus: 0, released: false };
    if (!enabled) return;
    this.skills = [
      { id: 'darkBinding', name: '黑暗束缚' },
      { id: 'darkRelease', name: '暗之解放', ...this.onOwnTurn([Timing.ACTIVATION]),
        modifyHandLimit: limit => this.state.form ? 5 : limit,
        filter: ({ context }) => !this.state.form && !context.usedSkills.magicLancerActivation,
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, 'darkRelease', '暗之解放'))) return;
          context.usedSkills.magicLancerActivation = true;
          Object.assign(player.hero.state, { form: 'phantom', attackBonus: 1, released: true });
          game.logSkill(player.id, 'darkRelease', '进入幻影形态，手限恒定5；本回合下次主动攻击+1，禁用漆黑之枪和充盈');
          yield* game.drawSteps(player.id, 0, { ...options, cause: { type: 'handLimit', skillId: 'darkRelease' } });
        } },
      { id: 'phantomStars', name: '幻影星辰', ...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: () => true, priority: 1,
        filter: ({ context }) => !!this.state.form && !context.usedSkills.magicLancerActivation,
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, 'phantomStars', '幻影星辰'))) return;
          context.usedSkills.magicLancerActivation = true;
          const morale = game.teams[player.team].morale;
          yield* game.damageSteps(player.id, 2, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'phantomStars' });
          if (game.winner) return;
          player.hero.state.form = null;
          game.logSkill(player.id, 'phantomStars', '重置，脱离幻影形态');
          if (game.teams[player.team].morale < morale) return;
          const targetId = yield* game.choosePlayer(player.id, targets(game), '幻影星辰：选择2法伤目标', { skillId: 'phantomStars' });
          yield* game.damageSteps(targetId, 2, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'phantomStars' });
        } },
      { id: 'darkBarrier', name: '暗之障壁', ...this.onDamage([Timing.DAMAGE_BEFORE], 'target'),
        filter: ({ game, player }) => player.hand.some(c => eligible(game, player, c)),
        *resolve({ game, player, context, options }) {
          const mode = yield* choice(player.id, 'darkBarrier', '暗之障壁：选择整组弃牌类别', [
            { value: 'skip', label: '不发动' },
            ...(['spell', 'thunder'].filter(type => player.hand.some(c => type === 'spell' ? c.type === 'spell' : hasElement(game, player, c, 'thunder')))
              .map(value => ({ value, label: value === 'spell' ? '法术牌' : '雷系牌' }))),
          ], 'skip', { amount: context.amount });
          if (mode === 'skip') return;
          const predicate = c => mode === 'spell' ? c.type === 'spell' : hasElement(game, player, c, 'thunder');
          const count = yield* choice(player.id, 'darkBarrier', '暗之障壁：明弃数量',
            Array.from({ length: player.hand.filter(predicate).length }, (_, i) => ({ value: i + 1, label: `${i + 1}张` })), 1, { amount: context.amount, mode });
          const cards = yield* game.chooseHandCards(player.id, count, predicate, { skillId: 'darkBarrier', title: '暗之障壁：选择明弃牌', context: { amount: context.amount } });
          yield* discardCost(game, player, cards, 'darkBarrier', options);
          game.logSkill(player.id, 'darkBarrier', `明弃${cards.length}张${mode === 'spell' ? '法术' : '雷系'}牌；伤害数值不变`);
        } },
      { id: 'abundance', name: '充盈',
        action(game, player) {
          return player.hero.state.released ? null : { type: 'spell', cardCount: 1,
            cardFilter: c => eligible(game, player, c), targetCount: 0, targets: [] };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* discardCost(game, player, cards, 'abundance', options);
          let bonus = 0;
          for (let offset = 0; offset < game.players.length && !game.winner; offset++) {
            const target = game.player((player.id + offset) % game.players.length);
            if (!target.hand.length) continue;
            const payment = yield* game.chooseHandCards(target.id, 1, () => true, { skillId: 'abundance', title: '充盈：明弃1张牌', optional: target.team === player.team, context: { sourceId: player.id } });
            if (!payment) continue;
            if (target.id !== player.id && eligible(game, target, payment[0])) bonus++;
            yield* discardCost(game, target, payment, 'abundance', options);
          }
          if (game.winner) return;
          player.hero.state.attackBonus += bonus;
          game.logSkill(player.id, 'abundance', `本回合下次主动攻击+${bonus}，获得额外攻击行动`);
          game.turn.addAttackAction({ sourceSkillId: 'abundance' });
        } },
      { id: 'phantomAttack', name: '幻影加伤', ...this.onOwnAttack([Timing.ATTACK_DECLARED]), priority: 10,
        filter: ({ context }) => this.isActiveAttack(context) && this.state.attackBonus > 0,
        resolve({ game, player, context }) {
          context.amount += player.hero.state.attackBonus;
          game.logSkill(player.id, 'phantomAttack', `本次主动攻击+${player.hero.state.attackBonus}`);
          player.hero.state.attackBonus = 0;
        } },
      { id: 'pitchBlackLance', name: '漆黑之枪', ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ game, player, context }) => this.isActiveAttack(context) && this.state.form && !this.state.released &&
          [1, 2].includes(context.targetHandCount) && game.canPayEnergy(player.id, 'crystal'),
        *resolve({ game, player, context }) {
          const count = yield* choice(player.id, 'pitchBlackLance', '漆黑之枪：消耗X水晶（宝石可代替）',
            Array.from({ length: player.energy.gem + player.energy.crystal + 1 }, (_, value) => ({ value, label: value ? `消耗${value}，伤害+${value + 2}` : '不发动' })), 0, context);
          if (!count) return;
          for (let i = 0; i < count; i++) yield* game.paySkillEnergy(player.id, 'crystal');
          context.amount += count + 2;
          game.logSkill(player.id, 'pitchBlackLance', `消耗${count}能量，本次攻击+${count + 2}`);
        } },
      { id: 'phantomTurnEnd', name: '魔枪回合清理', ...this.onOwnTurn([Timing.TURN_END]),
        resolve: () => { this.state.attackBonus = 0; this.state.released = false; } },
    ];
  }
  allowsCard({ card }) { return !this.skills.length || card.type !== 'spell'; }
}
