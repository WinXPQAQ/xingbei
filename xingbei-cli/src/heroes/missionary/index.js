import { Hero } from "../../hero-base.js";
import { ExclusiveCard } from "../../card.js";
import { Timing } from "../../timing.js";
import { choice, targets, healTarget } from "../shared/actions.js";
import { discardHand } from "../shared/covered.js";
import { gainCard } from "../shared/compound.js";
export class Missionary extends Hero {
  constructor(enabled = true) {
    super({ id: "missionary", name: "传教士" });
    this.state = {
      devotion: 0,
      started: false,
      waypointCardId: null,
      confessedIds: [],
    };
    if (!enabled) return;
    const hero = this;
    this.skills = [
      {
        id: "confessionReset",
        name: "告解式重置",
        ...this.bind("player", [Timing.TURN_BEFORE], "all"),
        resolve() {
          hero.state.confessedIds = [];
        },
      },
      {
        id: "pathOfFaith",
        name: "信仰之路",
        ...this.onOwnTurn([Timing.TURN_START]),
        filter: () => !hero.state.started,
        *resolve({ game, player, options }) {
          hero.state.started = true;
          yield* hero.place(
            game,
            player,
            hero.previous(game, player.id),
            false,
            options,
          );
        },
      },
      {
        id: "pathTravel",
        name: "信仰之路转移",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: ({ game, context }) =>
          context.route !== "special" && hero.holder(game) != null,
        *resolve({ game, player, options }) {
          yield* hero.transfer(game, player, options);
        },
      },
      {
        id: "preaching",
        name: "传道",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        activationEnablesAction: ({ game, player }) => player.hand.length > 0 || (hero.holder(game) !== player.id && game.player(hero.holder(game)).hand.length > 0),
        filter: ({ game }) => hero.holder(game) != null,
        *resolve({ game, player, context, options }) {
          if (context.usedSkills.terminalActivation) return;
          if (
            !(yield* game.offerSkill(
              player.id,
              "preaching",
              "传道：可摸1张，明弃1张并与路标角色交换",
            ))
          )
            return;
          context.usedSkills.terminalActivation = true;
          const n = yield* choice(
            player.id,
            "preachingDraw",
            "传道：摸牌数量",
            [
              { value: 0, label: "不摸牌" },
              { value: 1, label: "摸1张" },
            ],
          );
          if (n) yield* game.drawSteps(player.id, n, options);
          const [mine] = yield* hero.selfDiscard(
            game,
            player,
            "preachingCost",
            options,
            "public",
          );
          hero.gain(game, player, 1);
          const id = hero.holder(game);
          const [received] = yield* discardHand(
            game,
            id,
            1,
            "preachingRecipient",
            options,
            "public",
          );
          if (received?.location.zone === "discard") {
            const a = mine?.getTraits({ game, playerId: player.id }),
              b = received.getTraits({ game, playerId: id });
            yield* gainCard(game, player.id, received, "preaching", options);
            if (
              a &&
              (a.elements.some((e) => b.elements.includes(e)) ||
                a.fates.some((f) => b.fates.includes(f)))
            )
              hero.gain(game, player, 1);
          }
        },
      },
      {
        id: "spiritualGift",
        name: "属灵恩赐",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, context, options }) {
          if (context.usedSkills.terminalActivation) return;
          if (
            !(yield* game.offerSkill(
              player.id,
              "spiritualGift",
              "属灵恩赐：水晶，治疗+1，弃1牌",
            ))
          )
            return;
          context.usedSkills.terminalActivation = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          game.changeHealing(player.id, 1);
          yield* hero.selfDiscard(game, player, "spiritualGiftCost", options);
        },
      },
      { id: "revelation", name: "启示" },
      { id: "service", name: "事奉" },
      { id: "mass", name: "弥撒" },
      { id: "confession", name: "告解式" },
      { id: "godsDisciple", name: "神的门徒" },
    ];
  }
  initialize(g, p) {
    if (!this.skills.length) return;
    this.state.waypointCardId = `waypoint:${p.id}`;
    if (!g.effects.has("waypoint"))
      g.registerEffect("waypoint", { name: "路标", category: "exclusive" });
    g.registerCard(
      new ExclusiveCard({ id: this.state.waypointCardId, name: "waypoint" }),
      { zone: "outside" },
    );
  }
  holder(g) {
    const c = g.cards.get(this.state.waypointCardId);
    return c?.location.zone === "status" ? c.location.playerId : null;
  }
  followsPlayer(g) {
    return this.holder(g);
  }
  eligible(g) {
    return g.players.filter((p) => p.hero.id !== "missionary").map((p) => p.id);
  }
  previous(g, id) {
    for (let n = 1; n < g.players.length; n++) {
      const next = (id - n + g.players.length) % g.players.length;
      if (this.eligible(g).includes(next)) return next;
    }
    return null;
  }
  gain(g, p, n) {
    const old = this.state.devotion;
    this.state.devotion = Math.min(4, old + n);
    g.logSkill(
      p.id,
      "pathOfFaith",
      `虔诚+${this.state.devotion - old}（${this.state.devotion}/4）`,
    );
  }
  *selfDiscard(g, p, skill, options, visibility = "hidden") {
    const cs = yield* discardHand(g, p.id, 1, skill, options, visibility);
    const c = cs[0],
      id = this.holder(g);
    if (
      c?.location.zone === "discard" &&
      p.healing > 0 &&
      id != null &&
      (yield* g.offerSkill(
        p.id,
        "service",
        "事奉：移除1治疗，将弃牌交给路标角色",
        { targetId: id },
      ))
    ) {
      g.changeHealing(p.id, -1);
      const team = g.player(id).team,
        before = g.teams[team].morale;
      yield* gainCard(g, id, c, "service", options);
      if (g.teams[team].morale >= before) {
        const target = yield* g.choosePlayer(
          p.id,
          targets(g).filter((t) => t !== p.id),
          "事奉：目标+1治疗",
          { skillId: "serviceHealing" },
        );
        g.changeHealing(target, 1);
      }
    }
    return cs;
  }
  *transfer(g, p, options) {
    let id = this.previous(g, this.holder(g)),
      transferred = true;
    if (
      this.state.devotion >= 2 &&
      (yield* g.offerSkill(
        p.id,
        "revelation",
        "启示：2虔诚，治疗或展示摸牌尝试改放路标",
      ))
    ) {
      this.state.devotion -= 2;
      g.logSkill(p.id, "revelation", "移除2虔诚");
      const mode = yield* choice(p.id, "revelationMode", "启示", [
        { value: "heal", label: "目标+1治疗" },
        { value: "draw", label: "摸1张并展示" },
      ]);
      if (mode === "heal") yield* healTarget(g, p, 1, "revelationHealing");
      else {
        const cs = yield* g.drawSteps(p.id, 1, options);
        g.logSkill(p.id, "revelation", `展示${g.describeCards(cs, p.id)}`);
        g.queueExposure(p.id, cs);
        yield* g.flushRuleEvents(options);
        if (
          cs.some(
            (c) =>
              c.type === "spell" ||
              c.getTraits({ game: g, playerId: p.id }).fates.includes("S"),
          )
        ) {
          id = yield* g.choosePlayer(
            p.id,
            this.eligible(g),
            "启示：重新放置路标",
            { skillId: "revelationTarget" },
          );
          g.removeEffect(this.state.waypointCardId, { zone: "outside" });
          transferred = false;
        }
      }
    }
    yield* this.place(g, p, id, transferred, options);
  }
  *place(g, p, id, transferred, options) {
    if (id == null) return;
    g.attachCard(this.state.waypointCardId, id, {
      effectId: "waypoint",
      sourcePlayerId: p.id,
    });
    yield* this.mass(g, p, id, options);
    if (
      transferred &&
      !this.state.confessedIds.includes(id) &&
      (yield* g.offerSkill(
        id,
        "confession",
        "告解式：摸2牌、我方水晶+1，继续传递路标",
      ))
    ) {
      this.state.confessedIds.push(id);
      yield* g.drawSteps(id, 2, options);
      g.addStones(g.player(id).team, "crystal");
      yield* this.transfer(g, p, options);
      yield* this.selfDiscard(g, p, "confessionCost", options);
    }
  }
  *mass(g, p, id, options) {
    if (!g.canPayEnergy(p.id, "crystal")) return;
    const effects = g.player(id).getBasicEffects();
    if (!p.hand.length && !effects.length) return;
    if (
      !(yield* g.offerSkill(
        p.id,
        "mass",
        "弥撒：水晶，虔诚+1并放置或收取基础效果",
        { targetId: id },
      ))
    )
      return;
    yield* g.paySkillEnergy(p.id, "crystal");
    this.gain(g, p, 1);
    const choices = [];
    if (p.hand.length)
      choices.push({ value: "place", label: "明弃1牌，可放置为基础效果" });
    if (effects.length)
      choices.push({ value: "take", label: "收取基础效果，再+1虔诚" });
    const mode = yield* choice(p.id, "massMode", "弥撒", choices);
    if (mode === "take") {
      const card = yield* g.chooseBasicEffect(
        p.id,
        effects,
        "弥撒：收取基础效果",
        { skillId: "massEffect" },
      );
      g.removeEffect(card, { zone: "hand", playerId: p.id });
      this.gain(g, p, 1);
      yield* g.drawSteps(p.id, 0, options);
    } else {
      const [c] = yield* this.selfDiscard(g, p, "massCost", options, "public");
      if (
        c?.location.zone === "discard" &&
        ["poison", "weakness", "holyShield"].includes(c.name) &&
        g.canAttach(c, id, c.name)
      )
        g.attachCard(c.id, id, {
          effectId: c.name,
          sourcePlayerId: p.id,
          sourceSkillId: "mass",
        });
    }
  }
}
