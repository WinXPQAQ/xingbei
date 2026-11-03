import { MagicalGirl } from "../magical-girl/index.js";
import { Timing } from "../../timing.js";
import { hasElement, discardCost, useUnique } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
import { gainCard } from "../shared/compound.js";
import { magicRelaySteps } from "../../resolution/magic.js";
export class GluttonousGirl extends MagicalGirl {
  constructor(enabled = true) {
    super(enabled);
    this.id = "gluttonousGirl";
    this.name = "农暴食少女";
    this.portrait = this.id;
    if (!enabled) return;
    this.skills = this.skills
      .filter((s) => !["magicMastery", "magicFusion"].includes(s.id))
      .map((s) =>
        s.id === "magicBurst"
          ? { ...s, name: "甜点冲击" }
          : s.id === "destructionStorm"
            ? { ...s, name: "美食风暴" }
            : s,
      );
    this.addSkills(
      {
        id: "deliciousFusion",
        name: "美味融合",
        action(game, p) {
          return {
            type: "spell",
            cardCount: 1,
            cardFilter: (c) => p.hero.canRelayMagic(game, p, c),
            targets: game.magicTargets(p.id),
          };
        },
        *resolveAction({ game, player, cards, options }) {
          yield* useUnique(game, player, cards[0], options);
          yield* magicRelaySteps(game, player.id, options);
        },
      },
      {
        id: "appetiteBlackHole",
        name: "食欲的黑洞",
        ...this.bind("target", [Timing.DAMAGE_REDIRECT], "team"),
        priority: 30,
        filter: ({ player, context }) =>
          context.actual > 0 &&
          player.hand.some((c) => c.name === "magicBullet"),
        *resolve({ game, player, context, options }) {
          const cards = yield* game.chooseHandCards(
            player.id,
            1,
            (c) => c.name === "magicBullet",
            {
              skillId: "appetiteBlackHole",
              optional: true,
              title: "食欲的黑洞：明弃魔弹，改由你承受此伤害，不降士气",
              context,
            },
          );
          if (!cards) return;
          yield* discardCost(game, player, cards, "appetiteBlackHole", options);
          context.targetId = player.id;
          context.moraleLoss = false;
          game.logSkill(
            player.id,
            "appetiteBlackHole",
            "改由自己承受本次实际伤害，不因此降低士气",
          );
        },
      },
      {
        id: "threeSecondRule",
        name: "三秒原则",
        ...this.bind("player", [Timing.CARDS_DISCARDED], "team"),
        filter: ({ player, context }) =>
          context.playerId !== player.id &&
          context.visibility === "public" &&
          context.cards.some(
            (c) => c.name === "magicBullet" && c.location.zone === "discard",
          ) &&
          player.hand.length > 0,
        *resolve({ game, player, context, options }) {
          const cards = context.cards.filter(
            (c) => c.name === "magicBullet" && c.location.zone === "discard",
          );
          if (
            !cards.length ||
            !(yield* game.offerSkill(
              player.id,
              "threeSecondRule",
              "三秒原则：弃1张牌，获得队友明弃的魔弹",
            ))
          )
            return;
          yield* discardHand(game, player.id, 1, "threeSecondRule", options);
          for (const card of cards)
            if (card.location.zone === "discard")
              yield* gainCard(
                game,
                player.id,
                card,
                "threeSecondRule",
                options,
              );
        },
      },
    );
  }
  canRelayMagic(game, p, c) {
    return (
      !!this.skills.length &&
      ["water", "fire"].some((e) => hasElement(game, p, c, e))
    );
  }
}
