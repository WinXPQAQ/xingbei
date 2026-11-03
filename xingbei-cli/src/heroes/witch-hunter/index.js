import { Hero } from "../../hero-base.js";
import { AttackCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { attackSteps } from "../../resolution/attack.js";
import { targets, enemies } from "../shared/actions.js";
import { coveredCards, discardHand, seatOrder } from "../shared/covered.js";
import { selectCovered, selectPlayers } from "../shared/selection.js";
export class WitchHunter extends Hero {
  constructor(enabled = true) {
    super({ id: "witchHunter", name: "猎巫人" });
    this.state = { ambushUsed: false };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "hunterReset",
        name: "偷袭重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.ambushUsed = false;
        },
      },
      {
        id: "spellConversion",
        name: "转换",
        action: (game, p) => ({
          type: "attack",
          cardCount: 1,
          cardFilter: (c) => c.type === "spell" && c.name !== "holyLight",
          targets: enemies(game, p).filter((id) =>
            game.canAttackTarget(p.id, id),
          ),
        }),
        *resolveAction({ game, player, cards, targetIds, options }) {
          const virtual = hero.responseAttack(game, player, cards[0]);
          game.playCard(player, player.hand.indexOf(cards[0]), {
            ...options,
            targetId: targetIds[0],
          });
          yield* attackSteps(game, player.id, -1, targetIds[0], {
            ...options,
            virtualAttack: virtual,
            actionSourceSkillId: "spellConversion",
          });
        },
      },
      {
        id: "witchSting",
        name: "狩魔刺",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        priority: 0,
        filter: ({ game, player, context }) =>
          hero.isActiveAttack(context) &&
          hero.bottles(player).length < 4 &&
          game.player(context.targetId).hand.length > 0 &&
          game.player(context.targetId).hand.length < 4,
        *resolve({ game, player, context, options }) {
          if (
            yield* game.offerSkill(
              player.id,
              "witchSting",
              "狩魔刺：攻击目标弃1牌作为魔力瓶",
              context,
            )
          )
            yield* hero.capture(
              game,
              player,
              context.targetId,
              "witchSting",
              options,
            );
        },
      },
      {
        id: "spellStrip",
        name: "法术剥离",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ game, player, context }) =>
          hero.isActiveAttack(context) &&
          hero.bottles(player).length < 4 &&
          game.players.some((p) => p.hand.length > 0),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "spellStrip",
              "法术剥离：目标角色弃1牌作为魔力瓶",
            ))
          )
            return;
          const id = yield* game.choosePlayer(
            player.id,
            game.players.filter((p) => p.hand.length > 0).map((p) => p.id),
            "法术剥离：选择目标",
            { skillId: "spellStripTarget" },
          );
          yield* hero.capture(game, player, id, "spellStrip", options);
        },
      },
      {
        id: "silverVenom",
        name: "灌银毒刃",
        ...this.onDamage([Timing.DAMAGE_ACTUAL], "actor"),
        priority: -20,
        filter: ({ player, context }) =>
          context.actual > 0 && hero.bottles(player).length > 0,
        *resolve({ game, player, context }) {
          const card = yield* game.chooseCoveredCard(player.id, "manaBottle", {
            skillId: "silverVenom",
            optional: true,
          });
          if (!card) return;
          game.discardCovered(player.id, card, { skillId: "silverVenom" });
          context.actual--;
          context.venomBottleId = card.id;
          game.logSkill(
            player.id,
            "silverVenom",
            `实际摸牌数−1，随后将魔力瓶交给${game.actorLabel(context.targetId)}`,
          );
        },
      },
      {
        id: "silverVenomGain",
        name: "灌银毒刃交牌",
        ...this.onDamage([Timing.DAMAGE_AFTER], "actor"),
        priority: 100,
        filter: ({ context }) => !!context.venomBottleId,
        *resolve({ game, player, context, options }) {
          const c = game.cards.get(context.venomBottleId);
          if (c.location.zone !== "discard") return;
          game.logSkill(
            player.id,
            "silverVenom",
            `将1张魔力瓶${game.describeCards([c], player.id, { hidden: true })}交给${game.actorLabel(context.targetId)}`,
          );
          game.moveCard(
            c.id,
            { zone: "hand", playerId: context.targetId },
            { animate: false },
          );
          yield* game.drawSteps(context.targetId, 0, {
            ...options,
            cause: { type: "directDraw", skillId: "silverVenom" },
          });
          game.changeHealing(player.id, 1);
        },
      },
      {
        id: "ambush",
        name: "偷袭",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        filter: ({ game, player }) =>
          !hero.state.ambushUsed &&
          hero.bottles(player).length >= 2 &&
          game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, options }) {
          const cs = yield* selectCovered(game, player, "manaBottle", {
            skillId: "ambush",
            min: 2,
            max: 2,
            optional: true,
          });
          if (!cs.length) return;
          hero.state.ambushUsed = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          const traits = cs.map((c) =>
            c.getTraits({ game, playerId: player.id }),
          );
          for (const c of cs)
            game.discardCovered(player.id, c, {
              reveal: true,
              skillId: "ambush",
            });
          const n = cs.filter((c) => c.type === "spell").length;
          if (n) {
            const ids = yield* selectPlayers(
              game,
              player,
              enemies(game, player),
              n,
              "ambushTargets",
              "偷袭：选择不同对手",
            );
            for (const id of seatOrder(game, player.id, ids))
              yield* game.damageSteps(id, 1, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "ambush",
              });
          } else game.turn.addAttackAction({ sourceSkillId: "ambush" });
          if (traits[0].elements.some((e) => traits[1].elements.includes(e))) {
            const id = yield* game.choosePlayer(
              player.id,
              targets(game),
              "同系魔力瓶：额外1法伤目标",
              { skillId: "ambushSame" },
            );
            yield* game.damageSteps(id, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "ambush",
            });
          }
        },
      },
    ];
  }
  bottles(p) {
    return coveredCards(p, "manaBottle");
  }
  responseAttack(game, player, card) {
    if (
      !this.skills.length ||
      card.type !== "spell" ||
      card.name === "holyLight"
    )
      return null;
    const traits = card.getTraits({ game, playerId: player.id });
    return {
      id: null,
      sourceCardId: card.id,
      name: `${traits.elements[0]}Strike`,
      type: "attack",
      uniqueSkills: [],
      getTraits: () => traits,
      hasUniqueSkill: () => false,
      canRespond: AttackCard.prototype.canRespond,
    };
  }
  *capture(game, p, id, skillId, options) {
    const cs = yield* discardHand(game, id, 1, `${skillId}Cost`, options);
    if (cs.length)
      game.coverCards(p.id, cs, "manaBottle", { sources: ["discard"] });
  }
}
