import { Hero } from "../../hero-base.js";
import { ExclusiveCard, AttackCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { cardSets, sameElements } from "../../card-sets.js";
import { choice, targets, enemies, discardCost } from "../shared/actions.js";
import { seatOrder } from "../shared/covered.js";

export class DevouringBlade extends ExclusiveCard {
  constructor(id, name, sourceId) {
    super({
      id,
      name,
      elements: name === "demonBlade" ? ["fire", "water"] : ["thunder", "wind"],
      fates: ["X"],
      heroId: "godEater",
    });
    this.type = "attack";
    this.sourceId = sourceId;
    this.publicIdentity = true;
  }
  legalTargets(c) {
    return AttackCard.prototype.legalTargets.call(this, c);
  }
  canRespond(c, ctx) {
    return AttackCard.prototype.canRespond.call(this, c, ctx);
  }
  resolve(c) {
    return AttackCard.prototype.resolve.call(this, c);
  }
  onMoved(game, { from, to, removal }) {
    // Removal is an explicit operation, not a discard or a use. Ragnarok uses it.
    if (removal || to.zone === "outside") return;
    const covered = to.zone === "covered" && to.pile !== "orbOffering";
    const leftHand =
      from.zone === "hand" &&
      !(to.zone === "hand" && to.playerId === from.playerId) &&
      !(covered && to.playerId === from.playerId);
    if (leftHand || covered)
      (game.pendingCardMoves ??= []).push({
        card: this,
        from,
        to,
        leftHand,
        covered,
      });
    // A discarded blade must not be shuffled back while its nested damage draws.
    // The originating discard still retains the entity reference for Moon Shelter.
    if (to.zone === "discard")
      game.moveCard(
        this.id,
        { zone: "outside" },
        { removal: true, animate: false },
      );
  }
  *resolveMove(game, { from, to, leftHand, covered }, options) {
    const damage = function* (card, id, amount) {
      if (amount === 3 && game.player(id).hero.id === "godEater") amount = 1;
      game.logSkill(
        card.sourceId,
        "erosion",
        `${game.actorLabel(id)}的${card.name === "demonBlade" ? "魔刃" : "异刃"}${amount === 3 ? "离手" : "触发渗蚀"}，造成${amount}点法术伤害`,
      );
      yield* game.damageSteps(id, amount, {
        ...options,
        sourceId: card.sourceId,
        damageType: "spell",
        skillId: "erosion",
        moraleLoss: true,
        useHealing: undefined,
        attackContext: undefined,
      });
    };
    if (leftHand) yield* damage(this, from.playerId, 3);
    if (covered) {
      yield* damage(this, to.playerId, 1);
      // Nested skills may already have moved this same entity elsewhere.
      if (
        this.location.zone === "covered" &&
        this.location.playerId === to.playerId &&
        this.location.pile === to.pile
      )
        game.moveCard(this.id, { zone: "outside" }, { removal: true });
    }
  }
  toJSON() {
    return { ...super.toJSON(), sourceId: this.sourceId, publicIdentity: true };
  }
}

export class GodEater extends Hero {
  constructor(enabled = true) {
    super({ id: "godEater", name: "噬神者" });
    this.state = { demonBladeId: null, alienBladeId: null };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      { id: "erosion", name: "渗蚀" },
      { id: "attunement", name: "同调" },
      {
        id: "bladeControl",
        name: "御刃",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game }) => hero.absent(game).length > 0,
        *resolve({ game, player, options }) {
          const blade = yield* hero.chooseBlade(
            game,
            player,
            "bladeControl",
            true,
          );
          if (!blade) return;
          yield* hero.gain(game, player, [blade], "bladeControl", options);
        },
      },
      {
        id: "engraving",
        name: "侵刻",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ context }) =>
          context.card instanceof DevouringBlade &&
          context.card.location.zone === "field",
        *resolve({ game, player, context, options }) {
          if (
            !(yield* game.offerSkill(
              player.id,
              "engraving",
              "侵刻：将这张刃加入攻击目标手牌",
              context,
            ))
          )
            return;
          game.moveCard(context.card.id, {
            zone: "hand",
            playerId: context.targetId,
          });
          game.logSkill(
            player.id,
            "engraving",
            `将${game.describeCards([context.card], player.id)}加入${game.actorLabel(context.targetId)}手牌`,
          );
          yield* game.drawSteps(context.targetId, 0, options);
        },
      },
      ...[
        ["devour", "噬灭", "demonBlade", ["water", "fire"]],
        ["annihilate", "殇灭", "alienBlade", ["wind", "thunder"]],
      ].map(([id, name, bladeName, elements]) => ({
        id,
        name,
        ...this.onOwnAttack([Timing.ATTACK_DECLARED]),
        filter: ({ game, player, context }) =>
          context.card.name === bladeName &&
          player.hand.some((c) =>
            c
              .getTraits({ game, playerId: player.id })
              .elements.some((e) => elements.includes(e)),
          ),
        *resolve({ game, player, context, options }) {
          const cards = yield* game.chooseHandCards(
            player.id,
            1,
            (c) =>
              c
                .getTraits({ game, playerId: player.id })
                .elements.some((e) => elements.includes(e)),
            {
              skillId: id,
              title: `${name}：额外明弃1张${elements.map((e) => ({ water: "水", fire: "火", wind: "风", thunder: "雷" })[e]).join("／")}系牌，移除治疗`,
              optional: true,
              context,
            },
          );
          if (!cards) return;
          yield* discardCost(game, player, cards, id, options);
          const targetId =
            id === "devour"
              ? context.targetId
              : yield* game.choosePlayer(
                  player.id,
                  enemies(game, player).filter((i) => i !== context.targetId),
                  "殇灭：选择攻击目标以外的对手",
                  { skillId: "annihilateTarget" },
                );
          const removed = -game.changeHealing(targetId, -1);
          game.logSkill(
            player.id,
            id,
            `移除${game.actorLabel(targetId)}${removed}治疗`,
          );
        },
      })),
      {
        id: "resonance",
        name: "共振",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "target", ["spell"]),
        filter: ({ game, player }) =>
          game.canPayEnergy(player.id, "crystal") &&
          cardSets(player.hand, {
            cardCounts: [2, 3],
            cardsFilter: (cs) => sameElements(game, player.id, cs),
          }).length > 0,
        *resolve({ game, player, context, options }) {
          const cs = yield* game.chooseCardSet(player.id, {
            counts: [2, 3],
            cardsFilter: (cs) => sameElements(game, player.id, cs),
            skillId: "resonance",
            title: "共振：水晶，明弃2–3张同系牌",
            optional: true,
            context,
          });
          if (!cs) return;
          yield* game.paySkillEnergy(player.id, "crystal");
          yield* discardCost(game, player, cs, "resonance", options);
          const absent = hero.absent(game);
          if (!absent.length) return;
          const combinations = absent.map((c) => ({
            value: c.id,
            label: c.name === "demonBlade" ? "获得魔刃" : "获得异刃",
          }));
          if (absent.length === 2)
            combinations.push({ value: "both", label: "获得两把刃" });
          const selected = yield* choice(
            player.id,
            "resonanceBlades",
            "共振：可获得场外的刃",
            [{ value: null, label: "不获得" }, ...combinations],
            null,
          );
          if (selected === null) return;
          yield* hero.gain(
            game,
            player,
            selected === "both"
              ? absent
              : absent.filter((c) => c.id === selected),
            "resonance",
            options,
          );
          const target = yield* game.choosePlayer(
            player.id,
            targets(game),
            "共振：造成1点法术伤害",
            { skillId: "resonanceTarget" },
          );
          yield* game.damageSteps(target, 1, {
            ...options,
            sourceId: player.id,
            damageType: "spell",
            skillId: "resonance",
          });
        },
      },
      {
        id: "ragnarok",
        name: "诸神终焉",
        action: () => ({ type: "spell", energy: "gem", targetCount: 0 }),
        *resolveAction({ game, player, options }) {
          yield* game.paySkillEnergy(player.id, "gem");
          game.gainEnergy(player.id, "crystal");
          game.logSkill(
            player.id,
            "ragnarok",
            "获得1水晶，先对自己造成2点法术伤害",
          );
          yield* game.damageSteps(player.id, 2, {
            ...options,
            sourceId: player.id,
            damageType: "spell",
            skillId: "ragnarok",
          });
          const blades = hero
            .blades(game)
            .filter((c) => c.location.zone !== "outside");
          const holders = blades
            .map((c) => c.location.playerId)
            .filter(Number.isInteger);
          for (const card of blades)
            game.moveCard(card.id, { zone: "outside" }, { removal: true });
          game.logSkill(
            player.id,
            "ragnarok",
            `同时移除${blades.length}把刃，不触发渗蚀`,
          );
          // Duplicate holders remain duplicate: each removed blade causes its own hit.
          for (const id of seatOrder(game, player.id, holders))
            yield* game.damageSteps(id, 3, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "ragnarok",
            });
          if (blades.length === 2) {
            const id = yield* game.choosePlayer(
              player.id,
              enemies(game, player),
              "诸神终焉：对1名对手额外造成2点法术伤害",
              { skillId: "ragnarokTarget" },
            );
            yield* game.damageSteps(id, 2, {
              ...options,
              sourceId: player.id,
              damageType: "spell",
              skillId: "ragnarok",
            });
          }
        },
      },
    ];
  }
  initialize(game, player) {
    if (!this.skills.length || this.state.demonBladeId) return;
    for (const name of ["demonBlade", "alienBlade"]) {
      const card = new DevouringBlade(`${name}-${player.id}`, name, player.id);
      game.registerCard(card, { zone: "outside" });
      this.state[`${name}Id`] = card.id;
    }
  }
  blades(game) {
    return [this.state.demonBladeId, this.state.alienBladeId]
      .map((id) => game.cards.get(id))
      .filter(Boolean);
  }
  absent(game) {
    return this.blades(game).filter((c) => c.location.zone === "outside");
  }
  *chooseBlade(game, player, skillId, optional) {
    const choices = this.absent(game).map((c) => ({
      value: c.id,
      label: c.name === "demonBlade" ? "获得魔刃" : "获得异刃",
    }));
    if (optional) choices.unshift({ value: null, label: "不发动" });
    const id = yield* choice(player.id, skillId, "御刃：获得场外的刃", choices);
    return id ? game.cards.get(id) : null;
  }
  *gain(game, player, cards, skillId, options) {
    for (const c of cards)
      game.moveCard(c.id, { zone: "hand", playerId: player.id });
    game.logSkill(
      player.id,
      skillId,
      `获得${game.describeCards(cards, player.id)}`,
    );
    yield* game.drawSteps(player.id, 0, options);
  }
}
