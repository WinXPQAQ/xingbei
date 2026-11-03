import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { targets, hasElement, discardCost, choice } from "../shared/actions.js";
import { coveredCards, seatOrder, discardHand } from "../shared/covered.js";
export class CurseTalisman extends Hero {
  constructor(enabled = true) {
    super({ id: "curseTalisman", name: "咒符师" });
    if (!enabled) return;
    this.skills = [
      ...[
        ["fireTalisman", "咒符-火璃", "fire"],
        ["iceTalisman", "咒符-冻天", "water"],
      ].map(([id, name, element]) => ({
        id,
        name,
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => hasElement(game, player, c, element),
            targetCount: 0,
          };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* discardCost(game, player, cards, id, options);
          yield* player.hero.cast(game, player, id, 1, true, options);
        },
      })),
      { id: "curseChant", name: "念咒" },
      { id: "curseReshape", name: "咒力重塑" },
      {
        id: "ghostApparition",
        name: "魑魅魍魎",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ player, context }) =>
          this.isActiveAttack(context) &&
          coveredCards(player, "cursePower").length > 0,
        *resolve({ game, player, options }) {
          const card = yield* game.chooseCoveredCard(player.id, "cursePower", {
            optional: true,
            skillId: "ghostApparition",
            title: "魑魅魍魎：移除1妖力，免费发动咒符",
          });
          if (!card) return;
          const boost =
            hasElement(game, player, card, "earth") &&
            (yield* game.offerSkill(
              player.id,
              "earthCurse",
              "展示地系妖力：本次咒符伤害或弃牌+1",
            ));
          game.discardCovered(player.id, card, {
            reveal: boost,
            skillId: "ghostApparition",
          });
          const id = yield* choice(player.id, "ghostTalisman", "选择咒符", [
            { value: "fireTalisman", label: "咒符-火璃" },
            { value: "iceTalisman", label: "咒符-冻天" },
          ]);
          yield* player.hero.cast(
            game,
            player,
            id,
            boost ? 2 : 1,
            false,
            options,
          );
        },
      },
    ];
  }
  *cast(game, player, id, amount, chant, options) {
    if (chant && coveredCards(player, "cursePower").length < 2) {
      const cards = yield* game.chooseHandCards(player.id, 1, () => true, {
        skillId: "curseChant",
        title: "念咒：将1张手牌作为妖力",
        optional: true,
      });
      if (cards) {
        game.coverCards(player.id, cards, "cursePower");
        yield* game.flushCardMoves(options);
      }
    }
    let count = 1;
    if (
      game.canPayEnergy(player.id, "crystal") &&
      (yield* game.offerSkill(
        player.id,
        "curseReshape",
        "咒力重塑：1水晶，本次咒符目标改为两名",
      ))
    ) {
      yield* game.paySkillEnergy(player.id, "crystal");
      count = 2;
    }
    const ids = [];
    for (let n = 0; n < count; n++)
      ids.push(
        yield* game.choosePlayer(
          player.id,
          targets(game).filter((i) => !ids.includes(i)),
          id === "fireTalisman" ? "火璃：选择法伤目标" : "冻天：选择弃牌目标",
          { skillId: id, context: { amount } },
        ),
      );
    for (const target of seatOrder(game, player.id, ids))
      if (id === "fireTalisman")
        yield* game.damageSteps(target, amount, {
          ...options,
          sourceId: player.id,
          damageType: "spell",
          skillId: id,
        });
      else yield* discardHand(game, target, amount, id, options);
    if (id === "fireTalisman") {
      yield* game.drawSteps(player.id, 1, {
        ...options,
        cause: { type: "directDraw", sourceId: player.id, skillId: id },
      });
      yield* discardHand(game, player.id, 1, id, options);
    } else {
      const donors = [];
      for (let n = 0; n < count; n++)
        donors.push(
          yield* game.choosePlayer(
            player.id,
            targets(game).filter((i) => i !== player.id && !donors.includes(i)),
            "冻天：选择转移1治疗的角色",
            { skillId: "iceHealing" },
          ),
        );
      for (const target of seatOrder(game, player.id, donors))
        if (game.player(target).healing > 0) {
          game.changeHealing(target, -1);
          game.changeHealing(player.id, 1);
          yield* game.flushRuleEvents(options);
        }
    }
  }
}
