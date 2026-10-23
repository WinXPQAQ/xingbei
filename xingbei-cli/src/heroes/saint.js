import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import {
  targets,
  choice,
  healTarget,
  uniqueAction,
  useUnique,
  extraAction,
} from "./actions.js";
export class Saint extends Hero {
  constructor(enabled = true) {
    super({ id: "saint", name: "圣女" });
    if (!enabled) return;
    this.skills = [
      {
        id: "frostPrayer",
        name: "冰霜祷言",
        ...this.onOwnTurn([Timing.CARD_EXPOSED]),
        filter: ({ context }) =>
          context.reason === "play" &&
          context.cards.some(
            (c, i) =>
              c.name === "holyLight" ||
              context.traits[i].elements.includes("water"),
          ),
        *resolve({ game, player }) {
          game.logSkill(player.id, "frostPrayer", "出牌触发治疗");
          yield* healTarget(game, player, 1, "frostPrayer");
        },
      },
      uniqueAction(
        "healingArt",
        "治疗术",
        function* ({ game, player, cards, targetIds, options }) {
          yield* useUnique(game, player, cards[0], options);
          game.changeHealing(targetIds[0], 2);
        },
      ),
      uniqueAction(
        "healingLight",
        "治愈之光",
        function* ({ game, player, cards, targetIds, options }) {
          yield* useUnique(game, player, cards[0], options);
          for (const id of targetIds) game.changeHealing(id, 1);
        },
        [1, 2, 3],
      ),
      {
        id: "compassion",
        name: "怜悯",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "gem"),
        modifyHandLimit: (limit) => (this.state.compassion ? 7 : limit),
        *resolve({ game, player }) {
          if (!(yield* game.offerSkill(player.id, "compassion", "怜悯")))
            return;
          yield* game.paySkillEnergy(player.id, "gem");
          player.hero.state.compassion = true;
          player.hero.state.form = "怜悯";
          game.gainEnergy(player.id, "crystal");
          game.logSkill(player.id, "compassion", "横置；手牌上限恒定为7");
        },
      },
      {
        id: "holyCure",
        name: "圣疗",
        action(game, player) {
          if (game.turn.state?.usedSkills.holyCure) return null;
          return {
            type: "spell",
            energy: "crystal",
            targets: targets(game),
            targetCounts: [1, 2, 3],
          };
        },
        *resolveAction({ game, player, targetIds }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          if (game.turn.state) game.turn.state.usedSkills.holyCure = true;
          let remaining = 3;
          for (let i = 0; i < targetIds.length; i++) {
            const last = i === targetIds.length - 1;
            const amount = last
              ? remaining
              : yield* choice(
                  player.id,
                  "holyCure",
                  "分配治疗",
                  Array.from(
                    { length: remaining - (targetIds.length - i - 1) },
                    (_, n) => ({
                      value: n + 1,
                      label: `${n + 1}治疗给${game.actorLabel(targetIds[i])}`,
                    }),
                  ),
                );
            game.changeHealing(targetIds[i], amount);
            remaining -= amount;
          }
          yield* extraAction(game, player, "holyCure");
        },
      },
    ];
  }
}
