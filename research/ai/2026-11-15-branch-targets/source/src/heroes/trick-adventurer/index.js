import { Adventurer } from "../adventurer/index.js";
import { choice } from "../shared/actions.js";
export class TrickAdventurer extends Adventurer {
  constructor(enabled = true) {
    super(enabled);
    this.id = "trickAdventurer";
    this.name = "trick冒险家";
    this.portrait = this.id;
    if (!enabled) return;
    this.skills = this.skills.map((s) =>
      s.id === "deception"
        ? {
            ...s,
            action(game, p, a = {}) {
              if (a.mode === "dark") return null;
              const spec = s.action(game, p, a);
              return {
                ...spec,
                modes: spec.modes.filter((m) => m.value !== "dark"),
              };
            },
          }
        : s.id === "adventurerParadise"
          ? {
              ...s,
              action(game, p, a = {}) {
                if (!p.energy.gem && !p.energy.crystal) return null;
                const spec = s.action(game, p, a);
                if (!spec) return null;
                return { ...spec, targetCount: 0, targets: [] };
              },
              *resolveAction({ game, player, action }) {
                const spec = player.hero.skills
                  .find((s) => s.id === "adventurerParadise")
                  .action(game, player, action);
                const [gem, crystal] = (action.mode ?? spec.modes[0].value)
                  .split(":")
                  .map(Number);
                const costs = [];
                for (let g = 0; g <= player.energy.gem; g++)
                  for (let c = 0; c <= player.energy.crystal; c++)
                    if (g + c)
                      costs.push({
                        value: `${g}:${c}`,
                        label: `移除${g}宝石、${c}水晶`,
                      });
                const paid = yield* choice(
                  player.id,
                  "trickParadiseCost",
                  "冒险者天堂：先支付至少1自身能量",
                  costs,
                );
                const [g, c] = paid.split(":").map(Number);
                player.energy.gem -= g;
                player.energy.crystal -= c;
                game.removeStones(player.team, { gem, crystal });
                const extra = Math.min(
                  g + c,
                  game.stoneCounts(player.team).crystal,
                );
                if (extra)
                  game.removeStones(player.team, { gem: 0, crystal: extra });
                const recipients = game.players
                  .filter((p) => p.team === player.team && p.id !== player.id)
                  .map((p) => p.id);
                for (const kind of [
                  ...Array(gem).fill("gem"),
                  ...Array(crystal + extra).fill("crystal"),
                ]) {
                  const id = yield* game.choosePlayer(
                    player.id,
                    recipients,
                    `冒险者天堂：将1${kind === "gem" ? "宝石" : "水晶"}交给队友`,
                    { skillId: "trickParadiseTarget" },
                  );
                  game.gainEnergy(id, kind);
                }
                game.logSkill(
                  player.id,
                  "adventurerParadise",
                  `消耗${g}宝石、${c}水晶，提炼${gem}宝石、${crystal + extra}水晶并分配给队友`,
                );
              },
            }
          : s,
    );
  }
}
