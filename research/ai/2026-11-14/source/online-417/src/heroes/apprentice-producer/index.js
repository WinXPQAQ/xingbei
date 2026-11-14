import { Elementalist } from "../elementalist/index.js";
import { Timing } from "../../timing.js";
import { discardCost } from "../shared/actions.js";
export class ApprenticeProducer extends Elementalist {
  constructor(enabled = true) {
    super(enabled);
    this.id = "apprenticeProducer";
    this.name = "见习制片";
    this.portrait = this.id;
    delete this.state.elements;
    this.state.atoms = 0;
    if (!enabled) return;
    this.skills = this.skills
      .filter((s) => !["elementAbsorption", "elementIgnition"].includes(s.id))
      .map((s) => (s.id === "moonlight" ? { ...s, name: "月陨" } : s));
    this.addSkills(
      {
        id: "atomAbsorption",
        name: "元子吸收",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor", ["spell"]),
        filter: ({ player }) => player.hero.state.atoms < 3,
        *resolve({ game, player }) {
          if (yield* game.offerSkill(player.id, "atomAbsorption", "元子吸收"))
            player.hero.gainAtom(game, player);
        },
      },
      {
        id: "atomRestructure",
        name: "元子重塑",
        action(game, player) {
          return player.hero.state.atoms < 2
            ? null
            : { type: "spell", cardCounts: [0, 1, 2, 3], targetCount: 0 };
        },
        *resolveAction({ game, player, cards, options }) {
          player.hero.state.atoms -= 2;
          yield* discardCost(
            game,
            player,
            cards,
            "atomRestructure",
            options,
            "hidden",
          );
          yield* game.drawSteps(player.id, cards.length, {
            ...options,
            cause: {
              type: "directDraw",
              sourceId: player.id,
              skillId: "atomRestructure",
            },
          });
          game.turn.addAction({
            type: "spell",
            sourceSkillId: "atomRestructure",
          });
        },
      },
      { id: "lightningMutation", name: "雷击变异" },
    );
  }
  gainAtom(game, player) {
    const before = this.state.atoms;
    this.state.atoms = Math.min(3, before + 1);
    game.logSkill(
      player.id,
      "atomAbsorption",
      `元子+${this.state.atoms - before}（${this.state.atoms}/3）`,
    );
  }
  lightningReward(game, player) {
    this.gainAtom(game, player);
  }
}
