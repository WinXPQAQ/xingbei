import { Marksman } from "../marksman/index.js";
export class MagicArcherEX extends Marksman {
  constructor(enabled = true) {
    super(enabled);
    this.id = "magicArcherEX";
    this.name = "魔弓EX";
    this.portrait = this.id;
    if (enabled)
      this.skills = this.skills.map((s) =>
        s.id === "lightningArrow"
          ? {
              ...s,
              id: "divineWindArrow",
              name: "神风矢",
              filter: ({ context }) =>
                context.attackTraits.elements.includes("wind"),
              resolve({ game, player, context }) {
                context.canCounter = false;
                game.logSkill(
                  player.id,
                  "divineWindArrow",
                  "风系攻击无法应战，仍可用圣光抵挡",
                );
              },
            }
          : s.id === "piercingShot"
            ? { ...s, name: "疾风追射" }
            : s,
      );
  }
}
