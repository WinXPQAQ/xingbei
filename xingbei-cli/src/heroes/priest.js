import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
const allies = (game, player) => game.players.filter(target => target.id !== player.id && target.team === player.team).map(target => target.id);
function createSkills(hero) {
  return [
    { id: "revelation", name: "神圣启示", ...hero.onOwnTurn([Timing.SPECIAL_ACTION_END]),
      *resolve({ game, player }) { if (yield* game.offerSkill(player.id, "revelation", "神圣启示")) game.changeHealing(player.id, 1); } },
    { id: "prayer", name: "神圣祈福", action() { return { type: "spell", cardCount: 2, cardFilter: card => card.type === "spell", targets: [], targetCount: 0 }; },
      *resolveAction({ game, player, cards, options }) { game.discardCards(player.id, cards, { reason: "prayer" }); yield* game.flushRuleEvents(options); game.changeHealing(player.id, 2); } },
    { id: "waterPower", name: "水之神力", action(game, player) { return { type: "spell", cardCount: 1, cardFilter: card => card.getTraits({ game, playerId: player.id }).elements.includes("water"), targets: allies(game, player) }; },
      *resolveAction({ game, player, cards, targetIds, options }) {
        game.discardCards(player.id, cards, { reason: "waterPower" }); yield* game.flushRuleEvents(options);
        if (player.hand.length) {
          const given = yield* game.chooseHandCards(player.id, 1, () => true, { title: "水之神力：交给队友1张牌" });
          game.moveCard(given[0].id, { zone: "hand", playerId: targetIds[0] });
        }
        game.changeHealing(player.id, 1); game.changeHealing(targetIds[0], 1);
        const target = game.player(targetIds[0]); game.draw(target.id, 0, { overflow: options.overflow });
        if (target.pendingOverflow) yield { type: "overflow", player: target };
      } },
    { id: "holyGuardian", name: "圣使守护", ...hero.onDamage([Timing.HEALING_BEFORE], "target"),
      resolve({ context }) { context.healingLimit = Math.min(1, context.healingLimit); },
      modifyHealingLimit(limit) { return limit + 4; } },
    { id: "holyContract", name: "神圣契约", ...hero.onOwnTurn([Timing.ACTIVATION]),
      filter: ({ game, player, context }) => player.healing > 0 && game.canPayEnergy(player.id, "crystal"),
      *resolve({ game, player }) {
        if (!(yield* game.offerSkill(player.id, "holyContract", "神圣契约"))) return;
        const targetId = yield* game.choosePlayer(player.id, allies(game, player), "神圣契约：选择队友");
        const count = yield { type: "numberChoice", playerId: player.id, title: "神圣契约：转移治疗数量（队友最高4）", choices: Array.from({ length: player.healing }, (_, index) => ({ value: index + 1, label: `${index + 1}点` })), defaultValue: Math.min(player.healing, Math.max(1, 4 - game.player(targetId).healing)) };
        if (!Number.isInteger(count) || count < 1 || count > player.healing) throw new Error("无效的治疗转移数量");
        yield* game.paySkillEnergy(player.id, "crystal"); game.changeHealing(player.id, -count); game.changeHealing(targetId, count, { limit: 4 });
      } },
    { id: "sacredDomain", name: "神圣领域", action(game, player, command = {}) {
        const modes = [{ value: "heal", label: "自己+2治疗，队友+1治疗" }, ...(player.healing > 0 ? [{ value: "damage", label: "移除1治疗，造成2点法术伤害" }] : [])];
        const mode = command.mode ?? "heal";
        if (!modes.some(choice => choice.value === mode)) return null;
        return { type: "spell", energy: "crystal", cardCount: 2, modes, targets: mode === "damage" ? game.players.map(target => target.id) : allies(game, player) };
      },
      *resolveAction({ game, player, cards, targetIds, action, options }) {
        yield* game.paySkillEnergy(player.id, "crystal"); game.discardCards(player.id, cards, { visibility: "hidden", reason: "sacredDomain" });
        if (action.mode === "damage") { game.changeHealing(player.id, -1); yield* game.damageSteps(targetIds[0], 2, { ...options, sourceId: player.id, damageType: "spell" }); }
        else { game.changeHealing(player.id, 2); game.changeHealing(targetIds[0], 1); }
      } },
  ];
}

export class Priest extends Hero {
  constructor(enabled = true) {
    super({ id: "priest", name: "神官" });
    if (enabled) this.skills = createSkills(this);
  }
}
