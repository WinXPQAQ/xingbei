import { HolyArcher } from "../holy-archer/index.js";
import { choice, targets } from "../shared/actions.js";
export class TrickHolyArcher extends HolyArcher {
  constructor(enabled = true) {
    super(enabled);
    this.id = "trickHolyArcher";
    this.name = "trick圣弓";
    this.portrait = this.id;
    if (!enabled) return;
    this.skills = this.skills.map((s) =>
      s.id === "radiantReset"
        ? {
            ...s,
            resolve({ game, player }) {
              player.hero.state.form = null;
              game.changeHealing(player.id, 1);
            },
          }
        : s.id === "radiantCannon"
          ? {
              ...s,
              *resolveAction(args) {
                yield* s.resolveAction(args);
                if (!args.game.winner)
                  for (const p of args.game.players.filter(
                    (p) => p.team === args.player.team,
                  ))
                    args.game.changeHealing(p.id, 1);
              },
            }
          : s.id === "holyBurst"
            ? {
                ...s,
                *resolveAction(args) {
                  if ((args.action.mode ?? "support") !== "support") {
                    yield* s.resolveAction(args);
                    return;
                  }
                  const { game, player, targetIds, options } = args;
                  game.changeHealing(player.id, -1);
                  yield* game.drawSteps(player.id, 1, {
                    ...options,
                    cause: { type: "directDraw", skillId: "holyBurst" },
                  });
                  player.hero.gainFaith(game, player, 1, "holyBurst");
                  game.changeHealing(targetIds[0], 1);
                },
              }
            : s.id === "autoFill"
              ? {
                  ...s,
                  *resolve({ game, player }) {
                    const choices = [
                      {
                        value: "crystal",
                        label: "水晶：1信仰或治疗，并装填1辉光炮",
                      },
                    ];
                    if (game.canPayEnergy(player.id, "gem"))
                      choices.push({
                        value: "gem",
                        label: "宝石：2信仰或目标角色2治疗",
                      });
                    const kind = yield* choice(
                      player.id,
                      "trickFill",
                      "自动填充（必须发动）",
                      choices,
                    );
                    yield* game.paySkillEnergy(player.id, kind);
                    const n = kind === "gem" ? 2 : 1;
                    const reward = yield* choice(
                      player.id,
                      "autoFillReward",
                      "选择填充奖励",
                      [
                        { value: "faith", label: `${n}信仰` },
                        { value: "healing", label: `${n}治疗` },
                      ],
                    );
                    if (reward === "faith")
                      player.hero.gainFaith(game, player, n, "autoFill");
                    else {
                      const id =
                        kind === "gem"
                          ? yield* game.choosePlayer(
                              player.id,
                              targets(game),
                              "自动填充：目标+2治疗",
                              { skillId: "trickFillTarget" },
                            )
                          : player.id;
                      game.changeHealing(id, n);
                    }
                    if (kind === "crystal") {
                      player.hero.state.cannon++;
                      game.logSkill(
                        player.id,
                        "autoFill",
                        `圣煌辉光炮+1（${player.hero.state.cannon}）`,
                      );
                    }
                  },
                }
              : s,
    );
  }
  initialize(game, p) {
    if (this.skills.length) game.gainEnergy(p.id, "gem", 2);
  }
}
