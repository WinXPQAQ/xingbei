import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { GuardianAngel } from "../guardian-angel/index.js";
import { targets, choice, discardCost } from "../shared/actions.js";
import { discardHand, seatOrder } from "../shared/covered.js";
import { chooseVisibleCard } from "../shared/compound.js";
export const trickyCards = (game) =>
  game.players.flatMap((p) => p.getStatus("tricky"));
export class MischiefGirl extends Hero {
  constructor(enabled = true) {
    super({ id: "mischiefGirl", name: "捣蛋萝莉" });
    this.state.surprise = false;
    if (!enabled) return;
    this.skills = [
      ...new GuardianAngel().skills
        .filter((s) => s.id === "angelWall")
        .map((s) => ({ ...s, name: "天使？" })),
      {
        id: "rebelliousWall",
        name: "叛逆之墙",
        action(game, p) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => c.name === "holyShield",
            targets: game.players
              .filter((p) => p.getBasicEffects().length)
              .map((p) => p.id),
          };
        },
        *resolveAction({ game, player, cards, targetIds, options }) {
          const target = game.player(targetIds[0]),
            effects = target.getStatus("holyShield").length
              ? target.getStatus("holyShield")
              : target.getBasicEffects();
          const id = yield* game.chooseBasicEffect(
            player.id,
            effects,
            "叛逆之墙：选择换取的基础效果",
            { skillId: "rebelliousEffect" },
          );
          yield* game.showCardsSteps(player.id, cards, { ...options });
          game.removeEffect(id, { zone: "hand", playerId: player.id });
          game.attachCard(cards[0].id, target.id, {
            effectId: "holyShield",
            sourcePlayerId: player.id,
            sourceSkillId: "rebelliousWall",
          });
          yield* game.flushRuleEvents(options);
          yield* game.drawSteps(player.id, 0, {
            ...options,
            cause: { type: "directDraw", skillId: "rebelliousWall" },
          });
          yield* discardHand(game, player.id, 1, "rebelliousWall", options);
        },
      },
      {
        id: "mysteriousForeshadow",
        name: "神秘伏笔",
        ...this.onOwnTurn([Timing.SPELL_ACTION_END]),
        filter: ({ game }) => this.openTargets(game).length > 0,
        *resolve({ game, player, options }) {
          const maximum = Math.min(2, player.hero.openTargets(game).length);
          const n = yield* choice(
            player.id,
            "foreshadowCount",
            "神秘伏笔：放置多少Tricky",
            Array.from({ length: maximum }, (_, i) => ({
              value: i + 1,
              label: `${i + 1}个`,
            })),
          );
          const ids = [];
          for (let i = 0; i < n; i++)
            ids.push(
              yield* game.choosePlayer(
                player.id,
                player.hero.openTargets(game).filter((id) => !ids.includes(id)),
                "神秘伏笔：选择Tricky目标",
                { skillId: "trickyTarget" },
              ),
            );
          for (const id of seatOrder(game, player.id, ids)) {
            const card = game.takeDeckCard();
            if (card)
              game.attachCard(card.id, id, {
                effectId: "tricky",
                sourcePlayerId: player.id,
                sourceSkillId: "mysteriousForeshadow",
                data: { hidden: true },
              });
          }
          yield* game.flushRuleEvents(options);
        },
      },
      {
        id: "trickyShot",
        name: "T-r-i-c-k-y!",
        ...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter: ({ game, context }) =>
          this.isActiveAttack(context) && trickyCards(game).length > 0,
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "trickyShot",
              "T-r-i-c-k-y!：查看1个Tricky，可移除并弃同系牌造成2法伤",
            ))
          )
            return;
          const id = yield* game.chooseBasicEffect(
            player.id,
            trickyCards(game),
            "选择查看的Tricky",
            { skillId: "trickyPeek" },
          );
          const card = game.cards.get(id),
            targetId = card.location.playerId;
          card.attachment.data.knownTo = [
            ...new Set([...(card.attachment.data.knownTo ?? []), player.id]),
          ];
          const proceed = yield* chooseVisibleCard(
            game,
            player.id,
            [card],
            "trickyReveal",
            "查看Tricky，继续则选择同系牌，或取消",
            true,
          );
          if (!proceed) return;
          const es = card.getTraits({ game, playerId: targetId }).elements;
          const cs = yield* game.chooseHandCards(
            player.id,
            1,
            (c) =>
              c
                .getTraits({ game, playerId: player.id })
                .elements.some((e) => es.includes(e)),
            {
              skillId: "trickyCost",
              optional: true,
              title: "明弃1张同系牌，移除Tricky并造成2法伤",
            },
          );
          if (!cs) return;
          card.attachment.data.hidden = false;
          game.removeEffect(id);
          yield* discardCost(game, player, cs, "trickyShot", options);
          yield* game.damageSteps(targetId, 2, {
            ...options,
            sourceId: player.id,
            damageType: "spell",
            skillId: "trickyShot",
          });
        },
      },
      {
        id: "trickOrTreat",
        name: "Trick or Treat",
        ...this.onOwnTurn([Timing.ACTION_PHASE_END]),
        filter: ({ game }) => trickyCards(game).length > 4,
        *resolve({ game, player, options }) {
          const cards = trickyCards(game);
          for (const c of cards) c.attachment.data.hidden = false;
          game.logSkill(
            player.id,
            "trickOrTreat",
            `展示所有Tricky：${game.describeCards(cards, player.id)}`,
          );
          let own = 0,
            enemy = 0;
          for (const id of seatOrder(
            game,
            player.id,
            cards.map((c) => c.location.playerId),
          )) {
            const card = cards.find((c) => c.location.playerId === id);
            if (!card?.attachment) continue;
            const es = card.getTraits({ game, playerId: id }).elements;
            const cost = yield* game.chooseHandCards(
              id,
              1,
              (c) =>
                c
                  .getTraits({ game, playerId: id })
                  .elements.some((e) => es.includes(e)),
              {
                skillId: "trickTreatCost",
                optional: true,
                title: "Trick or Treat：明弃同系牌，否则2法术伤害",
              },
            );
            if (cost) {
              yield* discardCost(
                game,
                game.player(id),
                cost,
                "trickOrTreat",
                options,
              );
              if (game.player(id).team === player.team) own++;
              else enemy++;
            } else
              yield* game.damageSteps(id, 2, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "trickOrTreat",
              });
          }
          for (const c of cards)
            if (c.location.zone === "status") game.removeEffect(c.id);
          game.logSkill(
            player.id,
            "trickOrTreat",
            `我方弃牌${own}，对方弃牌${enemy}`,
          );
          if (own > enemy) {
            const reward = yield* choice(
              player.id,
              "trickTreatReward",
              "选择Trick or Treat奖励",
              [
                { value: "crystal", label: "战绩区和个人各+1水晶" },
                { value: "turn", label: "弃1牌，额外一个回合" },
              ],
            );
            if (reward === "crystal") {
              game.addStones(player.team, "crystal");
              game.gainEnergy(player.id, "crystal");
            } else {
              yield* discardHand(game, player.id, 1, "trickOrTreat", options);
              game.turn.addExtraTurn(player.id);
            }
          } else if (own < enemy)
            game.addStones(player.team === "red" ? "blue" : "red", "gem");
        },
      },
      {
        id: "surprise",
        name: "Surprise!",
        modifyHandLimit: (n, p) => n + (p.hero.state.surprise ? 5 : 0),
        action: () => ({
          type: "spell",
          energy: "crystal",
          cardCount: 1,
          targetCount: 0,
        }),
        *resolveAction({ game, player, cards, options }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          yield* discardCost(
            game,
            player,
            cards,
            "surprise",
            options,
            "hidden",
          );
          player.hero.state.surprise = true;
          for (const c of trickyCards(game))
            game.removeEffect(c.id, { zone: "hand", playerId: player.id });
          yield* game.drawSteps(player.id, 0, {
            ...options,
            cause: { type: "directDraw", skillId: "surprise" },
          });
          while (
            player.hand.some((c) => c.category === "basic") &&
            player.hero.openTargets(game).length
          ) {
            const cs = yield* game.chooseHandCards(
              player.id,
              1,
              (c) => c.category === "basic",
              {
                skillId: "surpriseCard",
                title: "Surprise：可将一张基础牌盖为Tricky",
                optional: true,
              },
            );
            if (!cs) break;
            const id = yield* game.choosePlayer(
              player.id,
              player.hero.openTargets(game),
              "Surprise：选择Tricky目标",
              { skillId: "trickyTarget" },
            );
            game.attachCard(cs[0].id, id, {
              effectId: "tricky",
              sourcePlayerId: player.id,
              sourceSkillId: "surprise",
              data: { hidden: true, knownTo: [player.id] },
            });
            yield* game.flushRuleEvents(options);
          }
        },
      },
      {
        id: "surpriseEnd",
        name: "Surprise结束",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: () => this.state.surprise,
        *resolve({ game, player, options }) {
          player.hero.state.surprise = false;
          yield* game.drawSteps(player.id, 0, {
            ...options,
            cause: { type: "directDraw", skillId: "surpriseEnd" },
          });
        },
      },
    ];
  }
  initialize(game) {
    if (this.skills.length && !game.effects.has("tricky"))
      game.registerEffect("tricky", {
        name: "Tricky",
        category: "basic",
        stackable: false,
      });
  }
  openTargets(game) {
    return game.players
      .filter(
        (p) =>
          !p.getStatus("tricky").length &&
          p.hero.acceptsBasicEffect?.({
            game,
            player: p,
            effectId: "tricky",
          }) !== false,
      )
      .map((p) => p.id);
  }
}
