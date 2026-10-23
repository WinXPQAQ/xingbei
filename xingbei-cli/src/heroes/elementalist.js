import { Hero } from "../hero-base.js";
import { Timing } from "../timing.js";
import {
  targets,
  hasElement,
  discardCost,
  useUnique,
  uniqueAction,
  healTarget,
} from "./actions.js";
export class Elementalist extends Hero {
  constructor(enabled = true) {
    super({ id: "elementalist", name: "元素师" });
    this.state.elements = 0;
    if (!enabled) return;
    this.skills = [
      {
        id: "elementAbsorption",
        name: "元素吸收",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor", ["spell"]),
        filter: ({ context }) => context.skillId !== "elementIgnition",
        *resolve({ game, player }) {
          if (
            player.hero.state.elements >= 3 ||
            !(yield* game.offerSkill(
              player.id,
              "elementAbsorption",
              "元素吸收",
            ))
          )
            return;
          player.hero.state.elements++;
          game.logSkill(
            player.id,
            "elementAbsorption",
            `元素+1（${player.hero.state.elements}/3）`,
          );
        },
      },
      {
        id: "elementIgnition",
        name: "元素点燃",
        action(game, player) {
          return player.hero.state.elements >= 3
            ? { type: "spell", targets: targets(game) }
            : null;
        },
        *resolveAction({ game, player, targetIds, options }) {
          player.hero.state.elements -= 3;
          game.logSkill(player.id, "elementIgnition", "消耗3元素");
          yield* game.damageSteps(targetIds[0], 2, {
            ...options,
            sourceId: player.id,
            damageType: "spell",
            skillId: "elementIgnition",
          });
          game.turn.addAction({
            type: "spell",
            sourceSkillId: "elementIgnition",
          });
        },
      },
      ...[
        ["meteor", "陨石", "earth", 1, "spell"],
        ["freeze", "冰冻", "water", 1, null],
        ["fireball", "火球", "fire", 2, null],
        ["windBlade", "风刃", "wind", 1, "attack"],
        ["lightning", "雷击", "thunder", 1, null],
      ].map(([id, name, element, base, extra]) =>
        uniqueAction(
          id,
          name,
          function* ({ game, player, cards, targetIds, options }) {
            yield* useUnique(game, player, cards[0], options);
            const extraCard = player.hand.some((c) =>
              hasElement(game, player, c, element),
            )
              ? yield* game.chooseHandCards(
                  player.id,
                  1,
                  (c) => hasElement(game, player, c, element),
                  {
                    title: `${name}：可明弃1张同系牌，伤害+1`,
                    skillId: id,
                    optional: true,
                  },
                )
              : null;
            if (extraCard)
              yield* discardCost(game, player, extraCard, id, options);
            yield* game.damageSteps(targetIds[0], base + Number(!!extraCard), {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: id,
            });
            if (id === "freeze") yield* healTarget(game, player, 1, id);
            if (id === "lightning") {
              const n = game.addStones(player.team, "gem");
              game.logSkill(player.id, id, `战绩区获得${n}宝石`);
            }
            if (extra) game.turn.addAction({ type: extra, sourceSkillId: id });
          },
        ),
      ),
      {
        id: "moonlight",
        name: "月光",
        action(game) {
          return { type: "spell", energy: "gem", targets: targets(game) };
        },
        *resolveAction({ game, player, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          yield* game.damageSteps(
            targetIds[0],
            1 + player.energy.gem + player.energy.crystal,
            {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "moonlight",
            },
          );
        },
      },
    ];
  }
}
