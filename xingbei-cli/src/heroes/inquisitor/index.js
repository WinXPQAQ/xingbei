import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import {
  choice,
  targets,
  enemies,
  healTarget,
  discardCost,
} from "../shared/actions.js";
import { discardHand, seatOrder } from "../shared/covered.js";
import { selectPlayers } from "../shared/selection.js";
const holyHeroes = new Set([
  "priest",
  "guardianAngel",
  "saint",
  "holyLancer",
  "valkyrie",
  "moonGoddess",
  "holyArcher",
  "inquisitor",
  "templar",
]);
export class Inquisitor extends Hero {
  constructor(enabled = true) {
    super({ id: "inquisitor", name: "圣庭检察士" });
    this.state = {
      courtCardId: null,
      courtHealing: 0,
      rulings: 0,
      verdictUsed: false,
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      { id: "inquisitionCourt", name: "异端裁决所" },
      {
        id: "fanatic",
        name: "狂信徒",
        modifyHealingLimit: (n, { game, playerId }) =>
          n +
          Number(
            game.players.some(
              (p) =>
                p.id !== playerId &&
                p.team === game.player(playerId).team &&
                holyHeroes.has(p.hero.id),
            ),
          ),
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        *resolve({ game, player }) {
          yield* healTarget(game, player, 1, "fanatic");
        },
      },
      {
        id: "verdictReset",
        name: "裁决论定重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.verdictUsed = false;
        },
      },
      {
        id: "verdict",
        name: "裁决论定",
        ...this.bind("team", [Timing.HEALING_OVERFLOW], "self"),
        filter: () => !hero.state.verdictUsed,
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "verdict",
              "裁决论定：裁决所+1治疗，若成功则+1水晶",
            ))
          )
            return;
          hero.state.verdictUsed = true;
          if (hero.courtHeal(game, player, 1))
            game.gainEnergy(player.id, "crystal");
        },
      },
      {
        id: "graceBestowal",
        name: "恩典神授",
        action(game, p) {
          const total = game.players
            .filter((t) => t.team === p.team)
            .reduce((n, t) => n + t.healing, 0);
          if (
            (total < 2 && hero.state.courtHealing < 3) ||
            !game.stoneCounts(p.team).total
          )
            return null;
          return {
            type: "special",
            targets: game.players
              .filter(
                (t) =>
                  t.team === p.team &&
                  t.id !== p.id &&
                  t.energy.gem + t.energy.crystal < game.getEnergyLimit(t.id),
              )
              .map((t) => t.id),
          };
        },
        *resolveAction({ game, player, targetIds, options }) {
          const choices = [];
          if (
            game.players
              .filter((t) => t.team === player.team)
              .reduce((n, t) => n + t.healing, 0) >= 2
          )
            choices.push({ value: "team", label: "我方角色合计2治疗" });
          if (hero.state.courtHealing >= 3)
            choices.push({ value: "court", label: "裁决所3治疗" });
          const cost = yield* choice(
            player.id,
            "graceCost",
            "恩典神授费用",
            choices,
          );
          if (cost === "court") hero.courtHeal(game, player, -3);
          else
            for (let i = 0; i < 2; i++) {
              const id = yield* game.choosePlayer(
                player.id,
                game.players
                  .filter((p) => p.team === player.team && p.healing > 0)
                  .map((p) => p.id),
                "移除1治疗",
                { skillId: "graceHealing" },
              );
              game.changeHealing(id, -1);
            }
          const target = game.player(targetIds[0]),
            room = Math.min(
              2,
              game.getEnergyLimit(target.id) -
                target.energy.gem -
                target.energy.crystal,
            ),
            stones = game.stoneCounts(player.team),
            counts = [];
          for (let gem = 0; gem <= stones.gem; gem++)
            for (let crystal = 0; crystal <= stones.crystal; crystal++)
              if (gem + crystal > 0 && gem + crystal <= room)
                counts.push({
                  value: `${gem}:${crystal}`,
                  label: `${gem}宝石、${crystal}水晶`,
                });
          const selected = yield* choice(
            player.id,
            "graceStones",
            "选择提炼星石交给队友",
            counts,
          );
          const [gem, crystal] = selected.split(":").map(Number);
          game.removeStones(player.team, { gem, crystal });
          game.gainEnergy(target.id, "gem", gem);
          game.gainEnergy(target.id, "crystal", crystal);
          game.recordPublicAction({
            type: "refine",
            playerId: player.id,
            targetId: target.id,
            gem,
            crystal,
          });
          game.logSkill(
            player.id,
            "graceBestowal",
            `移除战绩区${gem}宝石、${crystal}水晶，交给${game.actorLabel(target.id)}`,
          );
          const cards = yield* discardHand(
            game,
            player.id,
            1,
            "graceBestowal",
            options,
          );
          if (
            cards[0]
              ?.getTraits({ game, playerId: player.id })
              .fates.includes("S") &&
            (yield* game.offerSkill(
              player.id,
              "graceReveal",
              "展示圣命格弃牌，对目标对手1法伤",
            ))
          ) {
            const c = cards[0];
            c.discardVisibility = "public";
            game.queueExposure(player.id, [c], { reason: "revealDiscard" });
            game.logSkill(
              player.id,
              "graceReveal",
              game.describeCards([c], player.id),
            );
            yield* game.flushRuleEvents(options);
            const id = yield* game.choosePlayer(
              player.id,
              enemies(game, player),
              "恩典神授：1法伤目标",
              { skillId: "graceTarget" },
            );
            yield* game.damageSteps(id, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "graceBestowal",
            });
          }
        },
      },
      {
        id: "purificationArt",
        name: "净化之术",
        ...this.onDamage([Timing.DAMAGE_AFTER], "target"),
        filter: ({ player, context }) =>
          context.actual > 0 && player.hand.some((c) => c.type === "spell"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "purificationArt",
              "净化之术：弃法术，+1治疗、摸1牌，裁决所−1治疗",
            ))
          )
            return;
          const cs = yield* game.chooseHandCards(
            player.id,
            1,
            (c) => c.type === "spell",
            { skillId: "purificationCost" },
          );
          yield* discardCost(game, player, cs, "purificationArt", options);
          game.changeHealing(player.id, 1);
          yield* game.drawSteps(player.id, 1, {
            ...options,
            cause: { type: "directDraw", skillId: "purificationArt" },
          });
          hero.courtHeal(game, player, -1);
        },
      },
      {
        id: "shelterDomain",
        name: "庇护领域",
        ...this.bind("target", [Timing.DAMAGE_BEFORE], "team"),
        priority: 10,
        filter: ({ context }) =>
          hero.state.courtHealing >= 3 && context.amount > 0,
        *resolve({ game, player, context }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "shelterDomain",
              "庇护领域：裁决所3治疗，伤害−1，裁决+1",
              context,
            ))
          )
            return;
          hero.courtHeal(game, player, -3);
          context.amount--;
          hero.state.rulings = Math.min(3, hero.state.rulings + 1);
        },
      },
      {
        id: "adjudicate",
        name: "裁决者",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "adjudicate",
              "裁决者：1水晶，裁决+1，裁决所治疗+2",
              { blockedReason: game.wouldLoseActionAfterEnergy(player.id, "crystal") ? "你将无法行动" : null },
            ))
          )
            return;
          yield* game.paySkillEnergy(player.id, "crystal");
          hero.state.rulings = Math.min(3, hero.state.rulings + 1);
          game.logSkill(
            player.id,
            "adjudicate",
            `裁决变为${hero.state.rulings}/3`,
          );
          hero.courtHeal(game, player, 2);
        },
      },
      {
        id: "divineSpur",
        name: "神圣鞭策",
        action(game, p, action = {}) {
          if (!hero.state.rulings) return null;
          return {
            type: "spell",
            energy: "crystal",
            modes: Array.from({ length: hero.state.rulings }, (_, i) => ({
              value: String(i + 1),
              label: `${i + 1}裁决，${i + 1}名角色摸牌`,
            })),
            targets: targets(game),
            targetCounts: action.mode
              ? [Number(action.mode)]
              : Array.from({ length: hero.state.rulings }, (_, i) => i + 1),
          };
        },
        *resolveAction({ game, player, action, targetIds, options }) {
          yield* game.paySkillEnergy(player.id, "crystal");
          const n = Number(action.mode);
          hero.state.rulings -= n;
          for (const id of seatOrder(game, player.id, targetIds))
            yield* game.drawSteps(id, 1, {
              ...options,
              cause: { type: "directDraw", skillId: "divineSpur" },
            });
          yield* discardHand(game, player.id, n, "divineSpur", options);
        },
      },
    ];
  }
  initialize(game, p) {
    if (!this.skills.length) return;
    this.state.courtCardId = `inquisitionCourt:${p.id}`;
    if (!game.effects.has("inquisitionCourt"))
      game.registerEffect("inquisitionCourt", {
        name: "异端裁决所",
        category: "exclusive",
      });
    game.registerCard(
      new ExclusiveCard({
        id: this.state.courtCardId,
        name: "inquisitionCourt",
      }),
      { zone: "outside" },
    );
    game.attachCard(this.state.courtCardId, p.id, {
      effectId: "inquisitionCourt",
      sourcePlayerId: p.id,
    });
  }
  courtHeal(game, p, n) {
    const before = this.state.courtHealing;
    this.state.courtHealing = Math.max(0, Math.min(4, before + n));
    const delta = this.state.courtHealing - before;
    game.logSkill(
      p.id,
      "inquisitionCourt",
      `异端裁决所治疗${delta >= 0 ? "+" : ""}${delta}（${this.state.courtHealing}/4）`,
    );
    return delta;
  }
}
