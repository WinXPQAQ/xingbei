import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { choice, targets } from "../shared/actions.js";

export class Ecclesiastic extends Hero {
  constructor(id, name) {
    super({ id, name });
    this.state = {
      relics: 0,
      silverBullets: 0,
      silverGraceUsed: false,
      orbCardId: null,
    };
  }
  initialize(g, p) {
    if (!this.skills.length) return;
    this.state.orbCardId ??= `royalOrb:${p.id}`;
    if (!g.effects.has("royalOrb"))
      g.registerEffect("royalOrb", { name: "王权宝珠", category: "exclusive" });
    if (!g.cards.has(this.state.orbCardId))
      g.registerCard(
        new ExclusiveCard({ id: this.state.orbCardId, name: "royalOrb" }),
        { zone: "outside" },
      );
  }
  gain(g, p, key, n, skill) {
    const old = this.state[key];
    this.state[key] = Math.min(3, old + n);
    g.logSkill(
      p.id,
      skill,
      `${key === "relics" ? "圣遗物" : "银制子弹"}+${this.state[key] - old}（${this.state[key]}/3）`,
    );
  }
  *removeHealing(g, p, alliesOnly, skill) {
    for (let n = 0; n < 2; n++) {
      const ids = g.players
        .filter((t) => t.healing > 0 && (!alliesOnly || t.team === p.team))
        .map((t) => t.id);
      const id = yield* g.choosePlayer(p.id, ids, "选择移除1治疗的角色", {
        skillId: skill,
      });
      g.changeHealing(id, -1);
    }
    yield* g.flushRuleEvents();
  }
  *cleanse(g, p, options) {
    for (const c of [...p.getBasicEffects()])
      yield* g.removeBasicEffectSteps(c.id, p.id, options);
    g.changeHealing(p.id, -p.healing);
    yield* g.flushRuleEvents(options);
  }
  *replace(g, p, id, options) {
    g.replaceHero(p.id, id, this.state);
    yield* this.settleLimits(g, options);
  }
  *settleLimits(g, options) {
    for (const p of g.players)
      if (p.hand.length > p.handLimit) yield* g.drawSteps(p.id, 0, options);
  }
  prevention(single = false) {
    const hero = this;
    return {
      id: single ? "divineDeclaration" : "sinAbsolution",
      name: single ? "神宣祷言" : "罪断豁免",
      ...this.bind("team", [Timing.MORALE_BEFORE], "self"),
      filter: ({ context }) =>
        context.amount < 0 &&
        context.cause?.type !== "damage" &&
        hero.state.relics > 0,
      *resolve({ game, player, context }) {
        const max = Math.min(single ? 1 : hero.state.relics, -context.amount);
        const n = yield* choice(
          player.id,
          single ? "divineDeclaration" : "sinAbsolution",
          "移除圣遗物抵御非伤害士气下降",
          Array.from({ length: max + 1 }, (_, value) => ({
            value,
            label: value ? `抵御${value}点` : "不发动",
          })),
          0,
          context,
        );
        if (!n) return;
        hero.state.relics -= n;
        game.logSkill(
          player.id,
          single ? "divineDeclaration" : "sinAbsolution",
          `移除${n}圣遗物，抵御${n}点非伤害士气下降`,
        );
        context.amount += n;
        hero.gain(
          game,
          player,
          "silverBullets",
          n,
          single ? "divineDeclaration" : "sinAbsolution",
        );
      },
    };
  }
}
