import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { sameElements } from "../../card-sets.js";
import { enemies, discardCost, choice } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
import { magicRelaySteps } from "../../resolution/magic.js";
export class SlothGirl extends Hero {
  constructor(enabled = true) {
    super({ id: "slothGirl", name: "怠惰少女" });
    if (!enabled) return;
    this.skills = [
      {
        id: "leaveMeAlone",
        name: "别烦我……",
        action(game, p) {
          return p.hand.length ? { type: "spell", targetCount: 0 } : null;
        },
        *resolveAction({ game, player, options }) {
          const ally = player.hero.rightAlly(game, player);
          const card =
            player.hand[Math.floor(game.random() * player.hand.length)];
          yield* discardCost(
            game,
            player,
            [card],
            "leaveMeAlone",
            options,
            "hidden",
          );
          const id = yield* game.choosePlayer(
            ally.id,
            enemies(game, player),
            "别烦我：替队友选择敌方摸牌目标",
            { skillId: "slothDrawTarget" },
          );
          yield* game.drawSteps(id, 1, {
            ...options,
            cause: {
              type: "directDraw",
              sourceId: player.id,
              skillId: "leaveMeAlone",
            },
          });
          const n = game.addStones(player.team, "crystal");
          game.logSkill(player.id, "leaveMeAlone", `战绩区+${n}水晶`);
          const cards = yield* game.chooseHandCards(
            id,
            1,
            (c) => c.type === "spell",
            {
              skillId: "slothResponse",
              optional: true,
              title: "明弃1张法术牌，否则再摸1牌",
            },
          );
          if (cards)
            yield* discardCost(
              game,
              game.player(id),
              cards,
              "leaveMeAlone",
              options,
            );
          else {
            yield* game.drawSteps(id, 1, {
              ...options,
              cause: {
                type: "directDraw",
                sourceId: player.id,
                skillId: "leaveMeAlone",
              },
            });
            game.changeHealing(ally.id, 1);
          }
        },
      },
      {
        id: "letMeRest",
        name: "让我躺平",
        ...this.onOwnTurn([Timing.TURN_START]),
        filter: ({ player }) => player.hand.length > 3,
        *resolve({ game, player, context }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "letMeRestOffer",
              "让我躺平：跳过本回合行动",
            ))
          )
            return;
          const id = yield* game.choosePlayer(
            player.id,
            game.players
              .filter((p) => p.team === player.team && p.id !== player.id)
              .map((p) => p.id),
            "让我躺平：队友+1治疗，跳过行动阶段",
            { skillId: "letMeRest" },
          );
          if (id != null) {
            game.changeHealing(id, 1);
            context.skipped = true;
          }
        },
      },
      {
        id: "wantMagicBullet",
        name: "想用魔弹",
        action(game, p) {
          return {
            type: "spell",
            cardCount: 2,
            cardsFilter: (cs) => sameElements(game, p.id, cs),
            targets: game.magicTargets(p.id),
          };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* discardCost(game, player, cards, "wantMagicBullet", options);
          yield* magicRelaySteps(game, player.id, options);
        },
      },
      {
        id: "noRefinement",
        name: "不想提炼",
        ...this.bind("player", [Timing.SPECIAL_ACTION_END], "team"),
        filter: ({ player, context }) =>
          context.playerId !== player.id && !!context.refinedStones,
        *resolve({ game, player }) {
          game.gainEnergy(player.id, "gem");
          const counts = game.stoneCounts(player.team);
          if (!counts.total) return;
          const kinds = ["gem", "crystal"].filter((k) => counts[k]);
          const kind = yield* choice(
            player.id,
            "slothStone",
            "不想提炼：移除战绩区1星石",
            kinds.map((value) => ({ value, label: value })),
          );
          game.removeStones(player.team, {
            gem: Number(kind === "gem"),
            crystal: Number(kind === "crystal"),
          });
        },
      },
      {
        id: "sleepAgain",
        name: "再睡一下",
        ...this.onOwnTurn([Timing.ACTION_PHASE_SKIPPED]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "gem"),
        *resolve({ game, player, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          yield* discardHand(game, player.id, 1, "sleepAgain", options);
          let overflow = false;
          for (const p of game.players.filter(
            (p) => p.team === player.team && p.id !== player.id,
          )) {
            const queued = game.pendingHealingEvents?.length ?? 0;
            game.changeHealing(p.id, 1);
            if ((game.pendingHealingEvents?.length ?? 0) > queued)
              overflow = true;
          }
          yield* game.flushRuleEvents(options);
          if (overflow)
            yield* game.changeMoraleSteps(player.team, 1, {
              ...options,
              sourceId: player.id,
              skillId: "sleepAgain",
            });
        },
      },
    ];
  }
  rightAlly(game, p) {
    for (let n = 1; n < game.players.length; n++) {
      const t = game.player((p.id + n) % game.players.length);
      if (t.team === p.team) return t;
    }
  }
  canRefine() {
    return !this.skills.length;
  }
  *magicResponse(game, p, context, options) {
    if (!this.skills.length) return false;
    const cards = yield* game.chooseCardSet(p.id, {
      counts: [2],
      cardsFilter: (cs) => sameElements(game, p.id, cs),
      optional: true,
      skillId: "slothMagicResponse",
      title: "想用魔弹：可选2张同系牌传递；取消后选择普通响应",
      context,
    });
    if (!cards) return false;
    yield* game.choosePlayer(
      p.id,
      [context.targetId],
      "想用魔弹：选择传递目标",
      { skillId: "slothMagicTarget" },
    );
    yield* discardCost(game, p, cards, "wantMagicBullet", options);
    return true;
  }
}
