import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { Sealer } from "../sealer/index.js";
import { Prayer } from "../prayer/index.js";
import { enemies, targets } from "../shared/actions.js";
import { seatOrder, discardHand } from "../shared/covered.js";
export class SpiritTide extends Hero {
  constructor(enabled = true) {
    super({ id: "spiritTide", name: "灵熙之潮" });
    this.state = { surge: 0, echoUsed: false };
    if (!enabled) return;
    this.skills = [
      { id: "spiritWill", name: "灵枝旨意" },
      {
        id: "tideReset",
        name: "魂灵重置",
        ...this.onOwnTurn([Timing.TURN_START]),
        resolve: () => {
          this.state.echoUsed = false;
        },
      },
      {
        id: "spiritExorcism",
        name: "邪灵退散",
        ...this.bind("actor", [Timing.BASIC_EFFECT_ATTACHED]),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "spiritExorcismOffer",
              "邪灵退散：可对一名对手1法伤",
            ))
          )
            return;
          const id = yield* game.choosePlayer(
            player.id,
            enemies(game, player),
            "邪灵退散：可对一名对手1法伤",
            { skillId: "spiritExorcism" },
          );
          if (id != null)
            yield* game.damageSteps(id, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "spiritExorcism",
            });
        },
      },
      {
        id: "echoSpirit",
        name: "伴响魂灵",
        ...this.bind("player", [Timing.MORALE_AFTER], "all"),
        filter: ({ game, player, context }) =>
          !this.state.echoUsed &&
          game.turn.state?.playerId === player.id &&
          context.amount < 0 &&
          context.cause?.type === "damage" &&
          context.cause.sourceId === player.id &&
          context.team !== player.team,
        *resolve({ game, player, context, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "echoSpirit",
              "伴响魂灵：对其余对手各1法伤",
            ))
          )
            return;
          player.hero.state.echoUsed = true;
          for (const id of seatOrder(
            game,
            player.id,
            enemies(game, player).filter((id) => id !== context.playerId),
          ))
            yield* game.damageSteps(id, 1, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "echoSpirit",
            });
        },
      },
      {
        id: "surgingPower",
        name: "波涌之力",
        ...this.bind("player", [Timing.BASIC_EFFECT_RESOLVED], "all"),
        resolve({ game, player }) {
          const before = player.hero.state.surge;
          player.hero.state.surge = Math.min(4, before + 1);
          game.logSkill(
            player.id,
            "surgingPower",
            `灵涌+${player.hero.state.surge - before}（${player.hero.state.surge}/4）`,
          );
        },
      },
      {
        id: "ragingTide",
        name: "怒潮荒涛",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: () => this.state.surge >= 4,
        *resolve({ game, player, options }) {
          player.hero.state.surge = 0;
          const ids = [];
          for (let n = 0; n < 4; n++)
            ids.push(
              yield* game.choosePlayer(
                player.id,
                targets(game).filter((id) => !ids.includes(id)),
                "怒潮荒涛：选择四名不同角色",
                { skillId: "ragingTide" },
              ),
            );
          for (const id of seatOrder(game, player.id, ids))
            yield* game.damageSteps(
              id,
              1 + game.player(id).getBasicEffects().length,
              {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "ragingTide",
              },
            );
        },
      },
      ...[...new Sealer().skills, ...new Prayer().skills]
        .filter((s) =>
          [
            "earthSeal",
            "waterSeal",
            "windSeal",
            "fireSeal",
            "thunderSeal",
            "powerBlessing",
            "speedBlessing",
          ].includes(s.id),
        )
        .map((s) => ({
          ...s,
          name: `海神御巫·${s.name}`,
          action(game, p) {
            const spec = s.action(game, p);
            return { ...spec, energy: "crystal" };
          },
          *resolveAction(args) {
            yield* args.game.paySkillEnergy(args.player.id, "crystal");
            yield* s.resolveAction(args);
            yield* args.game.flushRuleEvents(args.options);
            yield* discardHand(
              args.game,
              args.player.id,
              1,
              "seaPriestess",
              args.options,
            );
          },
        })),
    ];
  }
  acceptsBasicEffect() {
    return !this.skills.length;
  }
}
