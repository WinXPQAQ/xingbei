import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { choice, targets, discardCost } from "../shared/actions.js";
import { coveredCards, trimCovered, discardHand } from "../shared/covered.js";
import { selectCovered } from "../shared/selection.js";
export class ButterflyDancer extends Hero {
  constructor(enabled = true) {
    super({ id: "butterflyDancer", name: "蝶舞者" });
    this.state = { chrysalises: 0, witherProtection: false };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "lifeFlame",
        name: "生命之火",
        modifyHandLimit: (n) => Math.max(3, n - hero.state.chrysalises),
      },
      {
        id: "witherEnd",
        name: "凋零期限",
        ...this.onOwnTurn([Timing.TURN_BEFORE]),
        resolve() {
          hero.state.witherProtection = false;
        },
      },
      {
        id: "butterflyDance",
        name: "舞动",
        action: () => ({ type: "spell", cardCounts: [0, 1], targetCount: 0 }),
        *resolveAction({ game, player, cards, options }) {
          if (cards.length)
            yield* discardCost(
              game,
              player,
              cards,
              "butterflyDance",
              options,
              "hidden",
            );
          else
            yield* game.drawSteps(player.id, 1, {
              ...options,
              cause: { type: "directDraw", skillId: "butterflyDance" },
            });
          yield* hero.addCocoons(game, player, 1);
        },
      },
      {
        id: "poisonPowder",
        name: "毒粉",
        ...this.bind("target", [Timing.DAMAGE_ACTUAL_BEFORE], "all", ["spell"]),
        priority: 10,
        filter: ({ player, context }) =>
          context.actual === 1 && hero.cocoons(player).length > 0,
        *resolve({ game, player, context, options }) {
          const cs = yield* selectCovered(game, player, "cocoon", {
            skillId: "poisonPowder",
            optional: true,
          });
          if (!cs.length) return;
          yield* hero.removeCocoons(game, player, cs, options);
          context.actual++;
          game.logSkill(
            player.id,
            "poisonPowder",
            `${game.actorLabel(context.targetId)}实际法伤+1`,
          );
        },
      },
      {
        id: "pilgrimage",
        name: "朝圣",
        ...this.onDamage([Timing.DAMAGE_ACTUAL], "target"),
        priority: 0,
        filter: ({ player, context }) =>
          context.actual > 0 && hero.cocoons(player).length > 0,
        *resolve({ game, player, context, options }) {
          const cs = yield* selectCovered(game, player, "cocoon", {
            skillId: "pilgrimage",
            optional: true,
          });
          if (!cs.length) return;
          yield* hero.removeCocoons(game, player, cs, options);
          context.actual = Math.max(0, context.actual - 1);
          game.logSkill(player.id, "pilgrimage", "时点6抵御1点实际伤害");
        },
      },
      {
        id: "mirrorMoon",
        name: "镜花水月",
        ...this.bind("target", [Timing.DAMAGE_ACTUAL_BEFORE], "all", ["spell"]),
        priority: 0,
        filter: ({ game, player, context }) =>
          context.actual === 2 &&
          hero
            .cocoons(player)
            .some((c) =>
              hero
                .cocoons(player)
                .some((d) => d !== c && hero.same(game, player, c, d)),
            ),
        *resolve({ game, player, context, options }) {
          const cs = yield* selectCovered(game, player, "cocoon", {
            skillId: "mirrorMoon",
            min: 2,
            max: 2,
            optional: true,
            predicate: (c, chosen) =>
              chosen.length
                ? hero.same(game, player, c, chosen[0])
                : hero
                    .cocoons(player)
                    .some((d) => d !== c && hero.same(game, player, c, d)),
          });
          if (!cs.length) return;
          yield* hero.removeCocoons(game, player, cs, options, true);
          context.actual = 0;
          game.logSkill(
            player.id,
            "mirrorMoon",
            `抵御原伤害，向${game.actorLabel(context.targetId)}分别造成两次1法伤`,
          );
          for (let i = 0; i < 2; i++)
            yield* game.damageSteps(context.targetId, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "mirrorMoon",
            });
        },
      },
      { id: "withering", name: "凋零" },
      {
        id: "pupation",
        name: "蛹化",
        action: () => ({ type: "spell", energy: "gem", targetCount: 0 }),
        *resolveAction({ game, player, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          hero.state.chrysalises++;
          game.logSkill(
            player.id,
            "pupation",
            `蛹+1（${hero.state.chrysalises}），手限变为${player.handLimit}`,
          );
          yield* game.drawSteps(player.id, 0, {
            ...options,
            moraleLoss: false,
            cause: { type: "handLimit", skillId: "lifeFlame" },
          });
          yield* hero.addCocoons(game, player, 4);
        },
      },
      {
        id: "reverseButterfly",
        name: "倒逆之蝶",
        action(game, player, action = {}) {
          const modes = [{ value: "damage", label: "1点不能治疗抵挡的法伤" }];
          if (hero.state.chrysalises)
            modes.push({ value: "shed", label: "移除1蛹" });
          return {
            type: "spell",
            energy: "crystal",
            modes,
            targets: targets(game),
            targetCounts:
              action.mode === "shed" ? [0] : action.mode ? [1] : [0, 1],
          };
        },
        *resolveAction({ game, player, action, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          yield* discardHand(game, player.id, 2, "reverseButterfly", options);
          if (action.mode === "shed") {
            const cs =
              hero.cocoons(player).length >= 2
                ? yield* selectCovered(game, player, "cocoon", {
                    skillId: "reverseButterflyCost",
                    min: 2,
                    max: 2,
                    optional: true,
                  })
                : [];
            if (cs.length) yield* hero.removeCocoons(game, player, cs, options);
            else
              yield* game.damageSteps(player.id, 4, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "reverseButterfly",
              });
            hero.state.chrysalises--;
            game.logSkill(
              player.id,
              "reverseButterfly",
              `移除1蛹（剩余${hero.state.chrysalises}）`,
            );
          } else
            yield* game.damageSteps(targetIds[0], 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "reverseButterfly",
              useHealing: 0,
            });
        },
      },
    ];
  }
  cocoons(p) {
    return coveredCards(p, "cocoon");
  }
  same(g, p, a, b) {
    return a
      .getTraits({ game: g, playerId: p.id })
      .elements.some((e) =>
        b.getTraits({ game: g, playerId: p.id }).elements.includes(e),
      );
  }
  moraleFloor({ player, team }) {
    return this.state.witherProtection && team !== player.team ? 1 : -Infinity;
  }
  *addCocoons(game, player, n) {
    game.coverDeck(player.id, n, "cocoon");
    yield* trimCovered(game, player, "cocoon", 8, "cocoonOverflow");
  }
  *removeCocoons(game, player, cards, options, reveal = false) {
    for (const card of cards)
      game.discardCovered(player.id, card, {
        reveal,
        skillId: "cocoonRemoval",
      });
    for (const card of cards.filter((c) => c.type === "spell")) {
      if (
        !(yield* game.offerSkill(
          player.id,
          "withering",
          "凋零：展示法术茧，目标1法伤后自身2法伤，敌方士气下限1",
        ))
      )
        continue;
      this.state.witherProtection = true;
      game.recordPublicAction({
        type: "coveredReveal",
        playerId: player.id,
        card: card.name,
        elements: card.getTraits({ game, playerId: player.id }).elements,
      });
      if (card.location.zone === "discard") card.discardVisibility = "public";
      game.recordPresentation("discard", {
        playerId: player.id,
        cards: [card.toJSON()],
        visibility: "public",
        reason: "withering",
      });
      game.logSkill(
        player.id,
        "withering",
        `展示${game.describeCards([card], player.id)}，敌方士气下限1直到自己下回合开始前`,
      );
      const id = yield* game.choosePlayer(
        player.id,
        targets(game),
        "凋零：选择1法伤目标",
        { skillId: "witheringTarget" },
      );
      yield* game.damageSteps(id, 1, {
        ...options,
        sourceId: player.id,
        damageType: "spell",
        skillId: "withering",
      });
      yield* game.damageSteps(player.id, 2, {
        ...options,
        sourceId: player.id,
        damageType: "spell",
        skillId: "withering",
      });
    }
  }
}
