import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { sameElements } from "../../card-sets.js";
import { choice, enemies, discardCost } from "../shared/actions.js";
import { seatOrder } from "../shared/covered.js";
import { selectPlayers } from "../shared/selection.js";
export class BattleMage extends Hero {
  constructor(enabled = true) {
    super({ id: "battleMage", name: "战斗法师" });
    this.state = {
      actionCount: 0,
      runeExchangeUsed: false,
      enchantedStrikeUsed: false,
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "battleMageReset",
        name: "战斗法师回合重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve({ player, context }) {
          hero.state.runeExchangeUsed = false;
          hero.state.enchantedStrikeUsed = false;
          if (context.playerId === player.id) hero.state.actionCount = 0;
        },
      },
      {
        id: "runeExchange",
        name: "符文置换",
        action: (g, p) =>
          !hero.state.runeExchangeUsed
            ? {
                type: "spell",
                cardCount: 2,
                cardsFilter: (cs) => sameElements(g, p.id, cs),
                targetCount: 0,
              }
            : null,
        *resolveAction({ game, player, cards, options }) {
          hero.state.runeExchangeUsed = true;
          const extra = cards.some(
            (c) =>
              c.type === "spell" ||
              c.getTraits({ game, playerId: player.id }).fates.includes("Y"),
          );
          yield* discardCost(game, player, cards, "runeExchange", options);
          yield* game.drawSteps(player.id, 1, {
            ...options,
            cause: { type: "directDraw", skillId: "runeExchange" },
          });
          if (extra)
            game.turn.addAttackAction({ sourceSkillId: "runeExchange" });
        },
      },
      {
        id: "enchantedStrike",
        name: "附魔打击",
        ...this.onOwnAttack([Timing.ATTACK_HIT, Timing.ATTACK_MISS]),
        filter: ({ timing, context }) =>
          !hero.state.enchantedStrikeUsed &&
          hero.isActiveAttack(context) &&
          (timing === Timing.ATTACK_HIT ||
            context.attackTraits.fates.includes("Y")),
        *resolve({ game, player }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "enchantedStrike",
              "附魔打击：额外法术行动",
            ))
          )
            return;
          hero.state.enchantedStrikeUsed = true;
          game.turn.addAction({
            type: "spell",
            sourceSkillId: "enchantedStrike",
          });
        },
      },
      {
        id: "battleActionCount",
        name: "熵变计数",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        priority: 100,
        resolve() {
          hero.state.actionCount++;
        },
      },
      {
        id: "entropyShift",
        name: "熵变",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        priority: 10,
        filter: ({ game, player }) =>
          hero.state.actionCount === 3 &&
          (game.stoneCounts(player.team).gem > 0 ||
            game.players.some(
              (p) =>
                p.team === player.team &&
                p.id !== player.id &&
                p.energy.gem + p.energy.crystal > 0,
            )),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "entropyShift",
              "熵变：支付1战绩宝石或队友1能量，对两名对手各1法伤",
            ))
          )
            return;
          const choices = [];
          if (game.stoneCounts(player.team).gem)
            choices.push({ value: "team", label: "战绩区1宝石" });
          for (const p of game.players.filter(
            (p) => p.team === player.team && p.id !== player.id,
          ))
            for (const type of ["gem", "crystal"])
              if (p.energy[type])
                choices.push({
                  value: `${p.id}:${type}`,
                  label: `${game.actorLabel(p.id)}的1${type === "gem" ? "宝石" : "水晶"}`,
                });
          const cost = yield* choice(
            player.id,
            "entropyCost",
            "选择熵变费用",
            choices,
          );
          if (cost === "team") game.removeStones(player.team, { gem: 1 });
          else {
            const [id, type] = cost.split(":");
            game.payEnergy(Number(id), type);
          }
          const ids = yield* selectPlayers(
            game,
            player,
            enemies(game, player),
            2,
            "entropyTargets",
            "熵变：选择两名不同对手",
          );
          for (const id of seatOrder(game, player.id, ids))
            yield* game.damageSteps(id, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "entropyShift",
            });
        },
      },
      {
        id: "manaEntropy",
        name: "魔力熵增",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END, Timing.SPELL_ACTION_END]),
        priority: 0,
        filter: ({ game, player }) =>
          hero.state.actionCount > 1 && game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "manaEntropy",
              "魔力熵增：1水晶，对手1法伤，未降士气则战绩+1宝石",
            ))
          )
            return;
          yield* game.paySkillEnergy(player.id, "crystal");
          const id = yield* game.choosePlayer(
            player.id,
            enemies(game, player),
            "魔力熵增：选择目标",
            { skillId: "manaEntropyTarget" },
          );
          const before = Object.values(game.teams).map((t) => t.morale);
          yield* game.damageSteps(id, 1, {
            ...options,
            sourceId: player.id,
            damageType: "spell",
            skillId: "manaEntropy",
          });
          if (
            Object.values(game.teams).every((t, i) => t.morale >= before[i])
          ) {
            const n = game.addStones(player.team, "gem");
            game.logSkill(
              player.id,
              "manaEntropy",
              `未造成士气下降，战绩区宝石+${n}`,
            );
          }
        },
      },
    ];
  }
}
