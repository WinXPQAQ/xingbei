import { SwordWitch } from "../sword-witch/index.js";
import { Timing } from "../../timing.js";
import { choice, enemies } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
import { chooseVisibleCard, gainCard } from "../shared/compound.js";
export class SwordChild extends SwordWitch {
  constructor(enabled = true) {
    super(enabled);
    this.id = "swordChild";
    this.name = "剑之子";
    this.portrait = this.id;
    this.state = {
      ...this.state,
      admiresWitch: false,
      oathHit: false,
      cupsAtStart: 0,
      residualUsed: false,
      residualTarget: null,
    };
    if (!enabled) return;
    const inherited = this.skills
      .filter((s) =>
        ["dreamSword", "swordActionCount", "swordSeverance"].includes(s.id),
      )
      .map((s) => ({
        ...s,
        filter: (a) => this.state.admiresWitch && (s.filter?.(a) ?? true),
      }));
    this.skills = [
      ...inherited,
      { id: "admiration", name: "倾慕" },
      {
        id: "childReset",
        name: "誓言重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve: ({ game, player, context }) => {
          this.state.oathHit = false;
          this.state.cupsAtStart = game.teams.red.cups + game.teams.blue.cups;
          this.state.severanceUsed = false;
          this.state.residualUsed = false;
          if (context.playerId === player.id) {
            this.state.attacksCompleted = 0;
            this.state.residualTarget = null;
          }
        },
      },
      {
        id: "windSword",
        name: "风之剑",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ game, context }) =>
          this.isActiveAttack(context) &&
          context.attackTraits.fates.includes("J") &&
          game.stoneCounts(game.player(context.actorId).team).total > 0 &&
          (context.card.hasUniqueSkill("galeArt") ||
            (context.card.hasUniqueSkill("stormArt") &&
              game.player(context.targetId).getStatus("holyShield").length)),
        *resolve({ game, player, context }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "windSword",
              "风之剑：移除1战绩星石，发动剑圣独有技",
              context,
            ))
          )
            return;
          const counts = game.stoneCounts(player.team);
          const kind = yield* choice(
            player.id,
            "windSwordStone",
            "选择战绩星石",
            ["gem", "crystal"]
              .filter((k) => counts[k])
              .map((value) => ({ value, label: value })),
          );
          game.removeStones(player.team, {
            gem: Number(kind === "gem"),
            crystal: Number(kind === "crystal"),
          });
          if (context.card.hasUniqueSkill("galeArt"))
            game.turn.addAttackAction({ sourceSkillId: "windSword" });
          else {
            context.shieldable = false;
            context.canCounter = false;
          }
        },
      },
      {
        id: "oathHit",
        name: "剑守誓言命中记录",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) => this.isActiveAttack(context),
        resolve: () => {
          this.state.oathHit = true;
        },
      },
      {
        id: "swordOath",
        name: "剑守誓言",
        ...this.bind("player", [Timing.TURN_END], "all"),
        priority: -100,
        filter: ({ game }) =>
          !this.state.admiresWitch &&
          (this.state.oathHit ||
            game.teams.red.cups + game.teams.blue.cups >
              this.state.cupsAtStart),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "swordOath",
              "剑守誓言：展示弃牌堆顶牌，可获得1张，出现法术变为剑圣",
            ))
          )
            return;
          const cards = [];
          for (
            let n = 0;
            n < game.teams.red.cups + game.teams.blue.cups + 1;
            n++
          ) {
            const card = game.takeDeckCard();
            if (!card) break;
            game.moveCard(
              card.id,
              { zone: "discard" },
              { visibility: "public" },
            );
            cards.push(card);
          }
          game.logSkill(
            player.id,
            "swordOath",
            `展示弃置${game.describeCards(cards, player.id)}`,
          );
          const selected = yield* chooseVisibleCard(
            game,
            player.id,
            cards,
            "oathCard",
            "剑守誓言：可获得1张展示牌",
            true,
          );
          if (selected)
            yield* gainCard(game, player.id, selected, "swordOath", options);
          if (cards.some((c) => c.type === "spell")) {
            game.gainEnergy(player.id, "crystal", 2);
            game.replaceHero(player.id, "windSwordmaster", {
              oathEmpowered: "waiting",
            });
            game.turn.addExtraTurn(player.id);
          }
        },
      },
      {
        id: "swordAfterimage",
        name: "剑残影",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        filter: ({ game, player }) =>
          !this.state.residualUsed && game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "swordAfterimage",
              "剑残影：1水晶，令对手弃1牌，额外攻击只能指定他",
            ))
          )
            return;
          player.hero.state.residualUsed = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          const id = yield* game.choosePlayer(
            player.id,
            enemies(game, player),
            "剑残影：选择对手",
            { skillId: "afterimageTarget" },
          );
          player.hero.state.residualTarget = id;
          yield* discardHand(game, id, 1, "swordAfterimage", options);
          game.turn.addAttackAction({ sourceSkillId: "swordAfterimage" });
        },
      },
    ];
  }
  initialize(game) {
    this.state.admiresWitch =
      !!this.skills.length &&
      game.players.some((p) => p.hero.id === "swordWitch");
  }
  allowsAttackTarget({ game, actor, targetId, isCounter }) {
    if (isCounter) return true;
    const source = game.turn.state?.completed
      ? game.turn.nextAction()?.sourceSkillId
      : game.turn.state?.actionSourceSkillId;
    return (
      source !== "swordAfterimage" || targetId === this.state.residualTarget
    );
  }
}
