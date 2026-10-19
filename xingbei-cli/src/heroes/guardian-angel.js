import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
const allTargets = game => game.players.map(player => player.id);
const basicTargets = game => game.players.filter(player => player.getBasicEffects().length).map(player => player.id);
const elementCost = element => (game, player) => ({ type: "spell", cardCount: 1, cardFilter: card => card.getTraits({ game, playerId: player.id }).elements.includes(element), targets: element === "wind" ? basicTargets(game) : allTargets(game) });
function createSkills(hero) {
  return [
    { id: "windCleansing", name: "风之洁净", action: elementCost("wind"),
      *resolveAction({ game, player, cards, targetIds, options }) {
        const id = yield* game.chooseBasicEffect(player.id, game.player(targetIds[0]).getBasicEffects(), "风之洁净：选择基础效果");
        game.discardCards(player.id, cards, { reason: "windCleansing" });
        yield* game.flushRuleEvents(options);
        if (game.cards.get(id).location.zone === "status") yield* game.removeBasicEffectSteps(id, player.id, options);
        else game.logSkill(player.id, "windCleansing", "所选基础效果已离场，无需移除");
      } },
    { id: "angelBlessing", name: "天使祝福", action(game, player) { return { ...elementCost("water")(game, player), targetCounts: [1, 2] }; },
      *resolveAction({ game, player, cards, targetIds, options }) {
        game.discardCards(player.id, cards, { reason: "angelBlessing" }); yield* game.flushRuleEvents(options);
        for (const id of targetIds) {
          const target = game.player(id), count = Math.min(target.hand.length, targetIds.length === 1 ? 2 : 1);
          if (!count) { game.logSkill(player.id, "angelBlessing", `${game.actorLabel(id)}没有手牌，未交牌`); continue; }
          const given = yield* game.chooseHandCards(id, count, () => true, { title: `天使祝福：交给${player.name}${count}张牌`, purpose: "give", recipientId: player.id });
          game.giveCards(id, player.id, given);
        }
        game.draw(player.id, 0, { overflow: options.overflow });
      } },
    { id: "angelBond", name: "天使羁绊", ...hero.bind("actor", [Timing.BASIC_EFFECT_REMOVED, Timing.SHIELD_USED]),
      *resolve({ game, player }) {
        const id = yield* game.choosePlayer(player.id, allTargets(game), "天使羁绊：目标角色+1治疗", { skillId: "angelBond" }); game.logSkill(player.id, "angelBond", `给予${game.actorLabel(id)}1治疗`); game.changeHealing(id, 1);
      } },
    { id: "angelWall", name: "天使之墙", action(game, player) {
        const card = player.hand.find(card => card.hasUniqueSkill("angelWall"));
        return { type: "spell", cardCount: 1, cardFilter: card => card.hasUniqueSkill("angelWall"), targets: card ? game.players.filter(target => game.canAttach(card, target.id, "holyShield")).map(target => target.id) : [] };
      },
      *resolveAction({ game, player, cards, targetIds, options }) {
        game.playCard(player, player.hand.indexOf(cards[0]), options);
        game.attachCard(cards[0].id, targetIds[0], { effectId: "holyShield", sourcePlayerId: player.id, sourceSkillId: "angelWall" });
        yield* game.trigger(Timing.SHIELD_USED, { actorId: player.id, targetId: targetIds[0], card: cards[0] }, options);
      } },
    { id: "angelSong", name: "天使之歌", ...hero.onOwnTurn([Timing.TURN_BEFORE]),
      filter: ({ game, player, context }) => game.canPayEnergy(player.id, "crystal") && basicTargets(game).length > 0,
      *resolve({ game, player, options }) {
        if (!(yield* game.offerSkill(player.id, "angelSong", "天使之歌"))) return;
        const id = yield* game.chooseBasicEffect(player.id, game.players.flatMap(player => player.getBasicEffects()), "天使之歌：选择基础效果");
        yield* game.paySkillEnergy(player.id, "crystal"); yield* game.removeBasicEffectSteps(id, player.id, options);
      } },
    { id: "divineShelter", name: "神之庇护", ...hero.bind("team", [Timing.MORALE_BEFORE], "team"), priority: -1,
      filter: ({ game, player, context }) => context.team === player.team && context.amount < 0 && context.cause?.type === "damage" && context.cause.damageType === "spell" && game.canPayEnergy(player.id, "crystal"),
      *resolve({ game, player, context }) {
        const count = Math.min(-context.amount, player.energy.gem + player.energy.crystal);
        const value = yield { type: "numberChoice", skillId: "divineShelter", playerId: player.id, title: "神之庇护：消耗能量抵御士气下降", choices: Array.from({ length: count + 1 }, (_, value) => ({ value, label: value ? `抵御${value}点` : "不发动" })), defaultValue: 0 };
        if (!Number.isInteger(value) || value < 0 || value > count) throw new Error("无效的庇护数量");
        if (value) { yield* game.paySkillEnergy(player.id, "crystal", value); context.amount += value; game.logSkill(player.id, "divineShelter", `抵御${value}点${player.team === "red" ? "红" : "蓝"}方士气损失；本次仍损失${-context.amount}点士气`); }
      } },
  ];
}

export class GuardianAngel extends Hero {
  constructor(enabled = true) {
    super({ id: "guardianAngel", name: "守护天使" });
    if (enabled) this.skills = createSkills(this);
  }
}
