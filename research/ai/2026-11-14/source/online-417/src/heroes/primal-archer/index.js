import { HolyArcher } from "../holy-archer/index.js";
import { ExclusiveCard, AttackCard } from "../../card.js";
import { attackSteps } from "../../resolution/attack.js";
import {
  choice,
  discardCost,
  enemies,
  extraAction,
} from "../shared/actions.js";
import { seatOrder, discardHand } from "../shared/covered.js";
export class PrimalArcher extends HolyArcher {
  constructor(enabled = true) {
    super(enabled);
    this.id = "primalArcher";
    this.name = "原初之弓";
    this.portrait = this.id;
    this.state.cannon = 2;
    this.state.cannonCardId = null;
    if (!enabled) return;
    this.skills = this.skills.map((s) =>
      s.id === "holyHurricane"
        ? {
            ...s,
            action(game, p) {
              return { ...s.action(game, p), cardFilter: () => true };
            },
            *resolveAction({ game, player, cards, targetIds, options }) {
              let element = cards[0]
                .getTraits({ game, playerId: player.id })
                .elements.find((e) =>
                  cards[1]
                    .getTraits({ game, playerId: player.id })
                    .elements.includes(e),
                );
              if (element === "light") element = "dark";
              yield* discardCost(game, player, cards, "holyHurricane", options);
              const virtual = {
                id: null,
                name: `${element}Strike`,
                type: "attack",
                uniqueSkills: [],
                getTraits: () => ({ elements: [element], fates: ["S"] }),
                hasUniqueSkill: () => false,
                canRespond: AttackCard.prototype.canRespond,
              };
              yield* attackSteps(game, player.id, -1, targetIds[0], {
                ...options,
                virtualAttack: virtual,
                actionSourceSkillId: "holyHurricane",
              });
            },
          }
        : s.id === "radiantReset"
          ? {
              ...s,
              resolve({ game, player }) {
                player.hero.state.form = null;
                game.changeHealing(player.id, 1);
              },
            }
          : s.id === "holyBurst"
            ? {
                ...s,
                action(game, p, action = {}) {
                  const spec = s.action(game, p, action);
                  if (!spec || p.healing < 1) return null;
                  spec.modes = spec.modes.map((m) =>
                    m.value === "support"
                      ? {
                          value: "support",
                          label:
                            "1治疗：摸1，对手牌比你少的对手2攻击伤害，+1信仰",
                        }
                      : m,
                  );
                  if ((action.mode ?? "support") === "support") {
                    spec.targetCount = 0;
                    delete spec.targetCounts;
                    spec.targets = [];
                    spec.healingCost = 1;
                  }
                  return spec;
                },
                *resolveAction(args) {
                  const { game, player, action, options } = args;
                  if ((action.mode ?? "support") !== "support") {
                    yield* s.resolveAction(args);
                    player.hero.gainFaith(
                      game,
                      player,
                      Number(action.mode.split(":")[1]),
                      "holyBurst",
                    );
                    return;
                  }
                  game.changeHealing(player.id, -1);
                  yield* game.drawSteps(player.id, 1, {
                    ...options,
                    cause: { type: "directDraw", skillId: "holyBurst" },
                  });
                  const ids = enemies(game, player).filter(
                    (id) => game.player(id).hand.length < player.hand.length,
                  );
                  if (ids.length) {
                    const id = yield* game.choosePlayer(
                      player.id,
                      ids,
                      "圣光爆裂：2攻击伤害",
                      { skillId: "primalBurstTarget" },
                    );
                    yield* game.damageSteps(id, 2, {
                      ...options,
                      sourceId: player.id,
                      damageType: "attack",
                      skillId: "holyBurst",
                    });
                  }
                  player.hero.gainFaith(game, player, 1, "holyBurst");
                },
              }
            : s.id === "radiantCannon"
              ? {
                  ...s,
                  *resolveAction({ game, player, options }) {
                    const first = player.hero.state.cannon === 2;
                    player.hero.state.faith -= player.hero.cannonCost(
                      game,
                      player,
                    );
                    for (const id of seatOrder(game, player.id))
                      yield* game.adjustHandSteps(id, 4, {
                        ...options,
                        skillId: "radiantCannon",
                      });
                    game.teams[player.team].cups++;
                    game.logSkill(
                      player.id,
                      "radiantCannon",
                      "全员手牌调整至4，我方星杯+1",
                    );
                    game.recordPresentation("cups", {
                      team: player.team,
                      amount: 1,
                    });
                    game.checkWinner();
                    yield* game.present();
                    if (game.winner) return;
                    const team = yield* choice(
                      player.id,
                      "radiantCannonMorale",
                      "选择调整士气的一方",
                      [
                        { value: "red", label: "红方调整为蓝方" },
                        { value: "blue", label: "蓝方调整为红方" },
                      ],
                      player.team,
                    );
                    yield* game.changeMoraleSteps(
                      team,
                      game.teams[team === "red" ? "blue" : "red"].morale -
                        game.teams[team].morale,
                      { ...options, skillId: "radiantCannon" },
                    );
                    if (game.winner) return;
                    const card = game.cards.get(player.hero.state.cannonCardId);
                    player.hero.state.cannon--;
                    if (first) {
                      for (const p of game.players.filter(
                        (p) => p.team === player.team,
                      ))
                        game.changeHealing(p.id, 1);
                      yield* extraAction(game, player, "primalCannonExtra");
                      card.attachment.data.face = "afterglow";
                      game.logSkill(
                        player.id,
                        "radiantCannon",
                        "圣煌辉光炮翻为圣煌余辉",
                      );
                    } else game.removeEffect(card.id, { zone: "outside" });
                  },
                }
              : s,
    );
  }
  initialize(game, p) {
    if (!this.skills.length) return;
    this.state.cannonCardId = `primalCannon:${p.id}`;
    if (!game.effects.has("primalCannon"))
      game.registerEffect("primalCannon", {
        name: "圣煌辉光炮／余辉",
        category: "exclusive",
      });
    game.registerCard(
      new ExclusiveCard({ id: this.state.cannonCardId, name: "primalCannon" }),
      { zone: "outside" },
    );
    game.attachCard(this.state.cannonCardId, p.id, {
      effectId: "primalCannon",
      sourcePlayerId: p.id,
      data: { face: "cannon" },
    });
  }
}
