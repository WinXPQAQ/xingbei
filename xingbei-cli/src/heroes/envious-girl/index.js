import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import {
  targets,
  hasElement,
  discardCost,
  useUnique,
} from "../shared/actions.js";
import { magicRelaySteps } from "../../resolution/magic.js";
export class EnviousGirl extends Hero {
  constructor(enabled = true) {
    super({ id: "enviousGirl", name: "嫉妒少女" });
    this.state.pursuitUsed = false;
    if (!enabled) return;
    this.skills = [
      {
        id: "envyReset",
        name: "嫉妒重置",
        ...this.onOwnTurn([Timing.TURN_START]),
        resolve: () => {
          this.state.pursuitUsed = false;
        },
      },
      {
        id: "jealousHeart",
        name: "醋意羞心",
        ...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter: ({ context }) => this.isActiveAttack(context),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "jealousHeartOffer",
              "醋意羞心",
            ))
          )
            return;
          const id = yield* game.choosePlayer(
            player.id,
            targets(game),
            "醋意羞心：选择目标",
            { skillId: "jealousHeart" },
          );
          if (id == null) return;
          const cards = yield* game.chooseHandCards(
            id,
            1,
            (c) => c.type === "spell",
            {
              skillId: "jealousResponse",
              title: "醋意羞心：可明弃1法术，否则承受2法伤",
              optional: true,
            },
          );
          if (cards)
            yield* discardCost(
              game,
              game.player(id),
              cards,
              "jealousHeart",
              options,
            );
          else {
            yield* game.damageSteps(id, 2, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "jealousHeart",
            });
            const n = game.addStones(player.team, "crystal");
            game.logSkill(player.id, "jealousHeart", `战绩区+${n}水晶`);
          }
        },
      },
      {
        id: "vanityMastery",
        name: "虚荣掌握",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => this.isActiveAttack(context),
        *resolve({ game, player }) {
          if (
            yield* game.offerSkill(
              player.id,
              "vanityMastery",
              "虚荣掌握：额外仅魔弹的法术行动，可逆传",
            )
          )
            game.turn.addAction({
              type: "spell",
              sourceSkillId: "vanityMastery",
            });
        },
      },
      {
        id: "lovesickness",
        name: "相思病",
        action(game, p) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => p.hero.canRelayMagic(game, p, c),
            targets: game.magicTargets(p.id),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          yield* useUnique(game, player, cards[0], options);
          yield* magicRelaySteps(game, player.id, {
            ...options,
            direction:
              targetIds[0] === game.nearestOpponent(player.id)?.id ? 1 : -1,
          });
        },
      },
      {
        id: "envyPursuit",
        name: "嫉妒追放",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        filter: ({ game, player }) =>
          !this.state.pursuitUsed && game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player }) {
          if (
            yield* game.offerSkill(
              player.id,
              "envyPursuit",
              "嫉妒追放：1水晶，额外攻击手牌比你多的对手",
            )
          ) {
            player.hero.state.pursuitUsed = true;
            yield* game.paySkillEnergy(player.id, "crystal");
            game.turn.addAttackAction({ sourceSkillId: "envyPursuit" });
          }
        },
      },
    ];
  }
  restricted(game, id) {
    return game.turn.state?.playerId === id && game.turn.state.completed
      ? game.turn.nextAction()?.sourceSkillId
      : game.turn.state?.actionSourceSkillId;
  }
  canRelayMagic(game, p, c) {
    return (
      !!this.skills.length &&
      ["earth", "wind"].some((e) => hasElement(game, p, c, e))
    );
  }
  canReverseMagic(game, p) {
    return this.restricted(game, p.id) === "vanityMastery";
  }
  allowsAction({ game, player, type, skillId }) {
    return (
      this.restricted(game, player.id) !== "vanityMastery" ||
      (type === "spell" && (!skillId || skillId === "lovesickness"))
    );
  }
  allowsCard({ game, player, card, purpose }) {
    return (
      purpose !== "action" ||
      this.restricted(game, player.id) !== "vanityMastery" ||
      card.name === "magicBullet"
    );
  }
  allowsAttackTarget({ game, actor, targetId, isCounter }) {
    return (
      isCounter ||
      this.restricted(game, actor.id) !== "envyPursuit" ||
      game.player(targetId).hand.length > actor.hand.length
    );
  }
}
