import { ELEMENT_NAMES } from "../../cards.js";
import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { targets, hasElement, discardCost } from "../shared/actions.js";
const elements = ["dark", "water", "fire", "wind", "thunder", "earth", "light"];
export class PlagueMage extends Hero {
  constructor(enabled = true) {
    super({ id: "plagueMage", name: "瘟疫法师" });
    if (!enabled) return;
    this.skills = [
      {
        id: "immortality",
        name: "不朽",
        ...this.onOwnTurn([Timing.SPELL_ACTION_END]),
        filter: ({ context }) => context.skillId !== "deathTouch",
        *resolve({ game, player }) {
          if (yield* game.offerSkill(player.id, "immortality", "不朽"))
            game.changeHealing(player.id, 1);
        },
      },
      {
        id: "virulence",
        name: "圣渎",
        ...this.onDamage([Timing.HEALING_BEFORE], "target", ["attack"]),
        modifyHealingLimit: (limit) => limit + 3,
        resolve({ game, player, context }) {
          context.healingLimit = 0;
          game.logSkill(player.id, "virulence", "治疗不能抵御攻击伤害");
        },
      },
      {
        id: "plague",
        name: "瘟疫",
        action(game, player) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => hasElement(game, player, c, "earth"),
            targets: [],
            targetCount: 0,
          };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* discardCost(game, player, cards, "plague", options);
          const before = Object.values(game.teams).reduce(
            (n, t) => n + t.morale,
            0,
          );
          for (const p of game.players.filter((p) => p.id !== player.id))
            yield* game.damageSteps(p.id, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "plague",
            });
          if (
            Object.values(game.teams).reduce((n, t) => n + t.morale, 0) < before
          )
            player.hero.state.plagueHealing = true;
        },
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: () => this.state.plagueHealing,
        resolve({ game, player }) {
          player.hero.state.plagueHealing = false;
          game.changeHealing(player.id, 1);
        },
      },
      {
        id: "deathTouch",
        name: "死亡之触",
        action(game, player, command = {}) {
          if (player.healing < 2) return null;
          const modes = [];
          for (const element of elements) {
            const n = player.hand.filter((c) =>
              hasElement(game, player, c, element),
            ).length;
            for (let count = 2; count <= n; count++)
              for (let healing = 2; healing <= player.healing; healing++)
                modes.push({
                  value: `${element}:${count}:${healing}`,
                  label: `${ELEMENT_NAMES[element]}系${count}张，${healing}治疗`,
                });
          }
          const mode = modes.find(
            (m) => m.value === (command.mode ?? modes[0]?.value),
          );
          if (!mode) return null;
          const [element, count, healing] = mode.value.split(":");
          return {
            type: "spell",
            modes,
            cardCount: Number(count),
            healingCost: Number(healing),
            cardFilter: (c) => hasElement(game, player, c, element),
            targets: targets(game),
          };
        },
        *resolveAction({ game, player, cards, targetIds, action, options }) {
          const spec = game.skillActionSpec(player.id, action);
          game.changeHealing(player.id, -spec.healingCost);
          yield* discardCost(game, player, cards, "deathTouch", options);
          yield* game.damageSteps(
            targetIds[0],
            spec.healingCost + cards.length - 3,
            {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "deathTouch",
            },
          );
        },
      },
      {
        id: "toxicNova",
        name: "剧毒新星",
        action() {
          return { type: "spell", energy: "gem", targets: [], targetCount: 0 };
        },
        *resolveAction({ game, player, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          for (const p of game.players.filter((p) => p.id !== player.id))
            yield* game.damageSteps(p.id, 2, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "toxicNova",
            });
          game.changeHealing(player.id, 1);
        },
      },
    ];
  }
}
