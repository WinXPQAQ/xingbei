import { Ecclesiastic } from "../lawgiver/shared.js";
import { Timing } from "../../timing.js";
import { choice, healTarget } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
export class Cardinal extends Ecclesiastic {
  constructor(enabled = true) {
    super("cardinal", "红衣主教");
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "cardinalReset",
        name: "圣银颂恩重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.silverGraceUsed = false;
        },
      },
      {
        id: "silverCovenant",
        name: "圣约银契",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        resolve({ game, player }) {
          hero.gain(game, player, "silverBullets", 1, "silverCovenant");
        },
      },
      {
        id: "exorcismRite",
        name: "驱魔式",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: () => hero.state.silverBullets >= 2,
        *resolve({ game, player, context, options }) {
          if (context.usedSkills.terminalActivation) return;
          if (
            !(yield* game.offerSkill(
              player.id,
              "exorcismRite",
              "驱魔式：移除2银制子弹，让队友明弃1牌",
            ))
          )
            return;
          context.usedSkills.terminalActivation = true;
          hero.state.silverBullets -= 2;
          const id = yield* game.choosePlayer(
            player.id,
            game.players.filter((p) => p.team === player.team).map((p) => p.id),
            "驱魔式目标",
            { skillId: "exorcismTarget" },
          );
          const cs = yield* discardHand(
            game,
            id,
            1,
            "exorcismCost",
            options,
            "public",
          );
          if (cs[0]?.getTraits({ game, playerId: id }).fates.includes("S")) {
            game.changeHealing(player.id, 1);
            yield* game.drawSteps(player.id, 1, options);
          }
        },
      },
      {
        id: "prayerRite",
        name: "祷告式",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ context }) =>
          hero.isActiveAttack(context) && hero.state.silverBullets > 0,
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "prayerRite",
              "祷告式：移除1银制子弹，目标+1治疗",
            ))
          )
            return;
          hero.state.silverBullets--;
          yield* healTarget(game, player, 1, "prayerRiteTarget");
        },
      },
      {
        id: "authorityReversal",
        name: "权能逆位",
        action: (g, p) =>
          hero.state.silverBullets > 0 ||
          g.players
            .filter((t) => t.team === p.team)
            .reduce((n, t) => n + t.healing, 0) >= 2
            ? { type: "spell", targetCount: 0 }
            : null,
        *resolveAction({ game, player, options }) {
          const choices = [];
          if (hero.state.silverBullets)
            choices.push({ value: "silver", label: "移除1银制子弹" });
          if (
            game.players
              .filter((p) => p.team === player.team)
              .reduce((n, p) => n + p.healing, 0) >= 2
          )
            choices.push({ value: "healing", label: "移除我方合计2治疗" });
          const mode = yield* choice(
            player.id,
            "reversalCost",
            "权能逆位费用",
            choices,
          );
          if (mode === "silver") hero.state.silverBullets--;
          else yield* hero.removeHealing(game, player, true, "reversalHealing");
          hero.gain(game, player, "relics", 2, "authorityReversal");
          yield* hero.cleanse(game, player, options);
          yield* discardHand(
            game,
            player.id,
            Math.max(0, player.hand.length - 4),
            "reversalDiscard",
            options,
          );
          yield* hero.replace(game, player, "lawgiver", options);
        },
      },
      hero.prevention(true),
      {
        id: "holyScripture",
        name: "圣典",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) =>
          game.canPayEnergy(player.id, "crystal") &&
          game.players.some((p) => p.team === player.team && p.healing === 0),
        *resolve({ game, player, context }) {
          if (context.usedSkills.terminalActivation) return;
          if (
            !(yield* game.offerSkill(
              player.id,
              "holyScripture",
              "圣典：水晶，我方无治疗角色各+1治疗",
            ))
          )
            return;
          context.usedSkills.terminalActivation = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          for (const p of game.players.filter(
            (p) => p.team === player.team && p.healing === 0,
          ))
            game.changeHealing(p.id, 1);
        },
      },
    ];
  }
}
