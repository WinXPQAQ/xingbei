import { Hero } from '../../hero-base.js';
import { Timing } from '../../timing.js';
import { hasElement, targets, discardCost } from '../shared/actions.js';
import { coveredCards, seatOrder, discardHand } from '../shared/covered.js';

export class TalismanMaster extends Hero {
  constructor(enabled = true) {
    super({ id: 'talismanMaster', name: '灵符师' });
    if (!enabled) return;
    this.skills = [
      ...[['thunderTalisman', '灵符-雷鸣', 'thunder'], ['windTalisman', '灵符-风行', 'wind']].map(([id, name, element]) => ({
        id, name,
        action: (game, player) => ({ type: 'spell', cardCount: 1, cardFilter: c => hasElement(game, player, c, element), targets: targets(game), targetCount: 2 }),
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* discardCost(game, player, cards, id, options);
          const amount = id === 'thunderTalisman' ? yield* player.hero.boost(game, player, options) : 0;
          for (const targetId of seatOrder(game, player.id, targetIds)) {
            if (id === 'thunderTalisman') yield* game.damageSteps(targetId, amount, { ...options, sourceId: player.id, damageType: 'spell', skillId: id });
            else yield* discardHand(game, targetId, 1, id, options);
          }
          yield* player.hero.chant(game, player);
        },
      })),
      { id: 'chant', name: '念咒' },
      { id: 'spiritCollapse', name: '灵力崩解' },
      { id: 'hundredGhosts', name: '百鬼夜行', ...this.onOwnAttack([Timing.ATTACK_HIT]), priority: -10,
        filter: ({ player, context }) => this.isActiveAttack(context) && coveredCards(player, 'spiritPower').length > 0,
        *resolve({ game, player, options }) {
          const card = yield* game.chooseCoveredCard(player.id, 'spiritPower', { skillId: 'hundredGhosts', title: '百鬼夜行：可移除1张妖力', optional: true });
          if (!card) return;
          const fire = hasElement(game, player, card, 'fire') && (yield* game.offerSkill(player.id, 'ghostFlames', '展示火系妖力，改为对排除2人以外的角色造成伤害'));
          game.discardCovered(player.id, card, { reveal: fire, skillId: 'hundredGhosts' });
          let ids;
          if (fire) {
            const first = yield* game.choosePlayer(player.id, targets(game), '百鬼夜行：选择第一位不受伤害的角色', { skillId: 'ghostExclude' });
            const second = yield* game.choosePlayer(player.id, targets(game).filter(id => id !== first), '百鬼夜行：选择第二位不受伤害的角色', { skillId: 'ghostExclude' });
            ids = targets(game).filter(id => id !== first && id !== second);
          } else ids = [yield* game.choosePlayer(player.id, targets(game), '百鬼夜行：选择法伤目标', { skillId: 'hundredGhosts' })];
          const amount = yield* player.hero.boost(game, player, options);
          for (const id of seatOrder(game, player.id, ids)) yield* game.damageSteps(id, amount, { ...options, sourceId: player.id, damageType: 'spell', skillId: 'hundredGhosts' });
        } },
    ];
  }
  *boost(game, player) {
    if (game.canPayEnergy(player.id, 'crystal') && (yield* game.offerSkill(player.id, 'spiritCollapse', '灵力崩解：消耗1水晶，本组法术伤害各+1'))) {
      yield* game.paySkillEnergy(player.id, 'crystal'); return 2;
    }
    return 1;
  }
  *chant(game, player) {
    if (coveredCards(player, 'spiritPower').length >= 2 || !player.hand.length) return;
    const cards = yield* game.chooseHandCards(player.id, 1, () => true, { skillId: 'chant', title: '念咒：可将1张手牌作为妖力', optional: true });
    if (cards) { game.logSkill(player.id, 'chant', '将手牌盖放为妖力'); game.coverCards(player.id, cards, 'spiritPower'); }
  }
}
