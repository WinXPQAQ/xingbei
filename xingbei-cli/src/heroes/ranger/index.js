import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { choice, targets, healTarget, hasElement } from "../shared/actions.js";
import { coveredCards } from "../shared/covered.js";
export class Ranger extends Hero {
  constructor(enabled = true) {
    super({ id: "ranger", name: "游击士" });
    this.state = {
      doubleShadowUsed: false,
      windBulletPending: false,
      hitElement: null,
    };
    if (!enabled) return;
    this.skills = [
      { id: "elfGift", name: "精灵赠礼" },
      {
        id: "rangerReset",
        name: "子弹重置",
        ...this.onOwnTurn([Timing.TURN_START]),
        resolve: () => {
          this.state.doubleShadowUsed = false;
          this.state.windBulletPending = false;
          this.state.hitElement = null;
        },
      },
      {
        id: "elfSwordDance",
        name: "精灵的剑舞",
        priority: 100,
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ game, player, context }) =>
          this.isActiveAttack(context) &&
          game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, context }) {
          if (
            yield* game.offerSkill(
              player.id,
              "elfSwordDance",
              "精灵的剑舞：1水晶，本次攻击视为风系",
              context,
            )
          ) {
            yield* game.paySkillEnergy(player.id, "crystal");
            context.attackTraits = {
              ...context.attackTraits,
              elements: ["wind"],
            };
            game.logSkill(player.id, "elfSwordDance", "本次攻击视为风系");
          }
        },
      },
      {
        id: "bulletShot",
        name: "元素射击*SORA",
        ...this.onOwnAttack([Timing.ATTACK_DECLARED, Timing.ATTACK_HIT]),
        filter: ({ player, context, timing }) =>
          this.isActiveAttack(context) &&
          (timing === Timing.ATTACK_DECLARED
            ? coveredCards(player, "bullets").length
            : !!context.bulletElement),
        *resolve({ game, player, context, timing, options }) {
          if (timing === Timing.ATTACK_HIT) {
            if (context.bulletElement === "water")
              yield* healTarget(game, player, 1, "waterBullet");
            if (context.bulletElement === "earth") {
              const id = yield* game.choosePlayer(
                player.id,
                targets(game),
                "地之弹：1点法术伤害",
                { skillId: "earthBullet" },
              );
              yield* game.damageSteps(id, 1, {
                ...options,
                sourceId: player.id,
                damageType: "spell",
                skillId: "earthBullet",
              });
            }
            return;
          }
          const card = yield* game.chooseCoveredCard(player.id, "bullets", {
            skillId: "bulletShot",
            title: "元素射击：移除一张子弹",
            optional: true,
          });
          if (!card) return;
          const es = card.getTraits({ game, playerId: player.id }).elements;
          let allowed = es.some((e) => ["light", "dark"].includes(e))
            ? ["fire", "water", "wind", "thunder", "earth"]
            : es;
          const element =
            allowed.length === 1
              ? allowed[0]
              : yield* choice(
                  player.id,
                  "bulletElement",
                  "选择子弹效果",
                  allowed.map((value) => ({ value, label: value })),
                  allowed[0],
                  context,
                );
          game.discardCovered(player.id, card, {
            reveal: true,
            skillId: "bulletShot",
          });
          context.bulletElement = element;
          if (element === "fire") context.amount++;
          if (element === "thunder") context.canCounter = false;
          if (element === "wind") player.hero.state.windBulletPending = true;
          game.logSkill(player.id, "bulletShot", `发动${element}子弹效果`);
        },
      },
      {
        id: "doubleShadowHit",
        name: "二重剑影命中记录",
        ...this.onOwnAttack([Timing.ATTACK_RESOLVED]),
        filter: ({ context }) => this.isActiveAttack(context),
        resolve: ({ context }) => {
          this.state.hitElement = context.hit
            ? context.attackTraits.elements[0]
            : null;
        },
      },
      {
        id: "doubleShadow",
        name: "二重剑影",
        ...this.onOwnTurn([Timing.ATTACK_ACTION_END]),
        *resolve({ game, player }) {
          if (player.hero.state.windBulletPending) {
            player.hero.state.windBulletPending = false;
            game.turn.addAttackAction({ sourceSkillId: "bulletShot" });
          }
          if (
            player.hero.state.hitElement &&
            !player.hero.state.doubleShadowUsed &&
            (yield* game.offerSkill(
              player.id,
              "doubleShadow",
              "二重剑影：额外同系攻击",
              { element: player.hero.state.hitElement },
            ))
          ) {
            player.hero.state.doubleShadowUsed = true;
            game.turn.addAttackAction({
              element: player.hero.state.hitElement,
              sourceSkillId: "doubleShadow",
            });
          }
          player.hero.state.hitElement = null;
        },
      },
      {
        id: "bulletEnchant",
        name: "附魔之术",
        ...this.onOwnTurn([Timing.SPECIAL_ACTION_END]),
        filter: ({ player, context }) =>
          context.refinedStones &&
          !coveredCards(player, "bullets").length &&
          player.hand.length > 0,
        *resolve({ game, player, context, options }) {
          const cards = yield* game.chooseHandCards(player.id, 1, () => true, {
            skillId: "bulletEnchant",
            optional: true,
            title: "附魔之术：消耗本次提炼的1能量，盖放一张子弹",
          });
          if (!cards) return;
          const kinds = ["gem", "crystal"].filter(
            (k) => context.refinedStones[k] > 0 && player.energy[k] > 0,
          );
          if (!kinds.length) return;
          const kind =
            kinds.length === 1
              ? kinds[0]
              : yield* choice(
                  player.id,
                  "bulletEnergy",
                  "选择消耗的能量",
                  kinds.map((value) => ({ value, label: value })),
                );
          player.energy[kind]--;
          game.coverCards(player.id, cards, "bullets");
          yield* game.flushCardMoves(options);
        },
      },
    ];
  }
  initialize(game, p) {
    if (this.skills.length) game.coverDeck(p.id, 6, "bullets");
  }
}
