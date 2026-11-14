import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { discardHand } from "../shared/covered.js";
import { gainCard } from "../shared/compound.js";
export class SwordWitch extends Hero {
  constructor(enabled = true) {
    super({ id: "swordWitch", name: "剑之魔女" });
    this.state = {
      attacksCompleted: 0,
      imaginaryUsed: false,
      severanceUsed: false,
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "swordWitchReset",
        name: "剑意重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve({ player, context }) {
          hero.state.imaginaryUsed = false;
          hero.state.severanceUsed = false;
          if (player.id === context.playerId) hero.state.attacksCompleted = 0;
        },
      },
      {
        id: "dreamSword",
        name: "梦想剑",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        priority: 50,
        filter: ({ context }) => hero.isActiveAttack(context),
        resolve({ context }) {
          if (hero.state.attacksCompleted >= 1) context.shieldable = false;
          if (hero.state.attacksCompleted >= 2) context.canCounter = false;
          if (hero.state.attacksCompleted >= 4)
            context.forceHitRequested = true;
        },
      },
      {
        id: "swordActionCount",
        name: "梦想剑计数",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        priority: 100,
        resolve() {
          hero.state.attacksCompleted++;
        },
      },
      {
        id: "techniqueIntent",
        name: "技之剑意",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        *resolve({ game, player }) {
          if (
            yield* game.offerSkill(
              player.id,
              "techniqueIntent",
              "技之剑意：额外技命格攻击行动",
            )
          )
            game.turn.addAttackAction({
              fate: "J",
              sourceSkillId: "techniqueIntent",
            });
        },
      },
      {
        id: "imaginarySword",
        name: "臆想剑",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) =>
          hero.isActiveAttack(context) && !hero.state.imaginaryUsed,
        *resolve({ game, player, context, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "imaginarySword",
              "臆想剑：目标明弃1牌，按牌种获得追加收益",
              context,
            ))
          )
            return;
          hero.state.imaginaryUsed = true;
          const [card] = yield* discardHand(
            game,
            context.targetId,
            1,
            "imaginarySwordCost",
            options,
            "public",
          );
          if (!card) return;
          if (card.type === "attack") {
            if (
              card.location.zone === "discard" &&
              (yield* game.offerSkill(
                player.id,
                "imaginaryGain",
                "获得目标弃置的攻击牌",
              ))
            )
              yield* gainCard(game, player.id, card, "imaginarySword", options);
            game.turn.addAttackAction({ sourceSkillId: "imaginarySword" });
          } else if (card.type === "spell") {
            context.amount += 2;
            game.logSkill(
              player.id,
              "imaginarySword",
              "弃牌为法术，本次攻击伤害+2",
            );
          }
        },
      },
      {
        id: "swordSeverance",
        name: "剑影·断念",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        filter: ({ game, player }) =>
          !hero.state.severanceUsed && game.canPayEnergy(player.id, "gem"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "swordSeverance",
              "剑影·断念：宝石，弃2摸1，额外攻击",
            ))
          )
            return;
          hero.state.severanceUsed = true;
          yield* game.paySkillEnergy(player.id, "gem");
          yield* discardHand(game, player.id, 2, "swordSeveranceCost", options);
          yield* game.drawSteps(player.id, 1, {
            ...options,
            cause: { type: "directDraw", skillId: "swordSeverance" },
          });
          game.turn.addAttackAction({ sourceSkillId: "swordSeverance" });
        },
      },
    ];
  }
}
