import { Hero } from "../../hero-base.js";
import { Timing } from "../../timing.js";
import { sameElements, distinctElements } from "../../card-sets.js";
import { choice, discardCost } from "../shared/actions.js";

const counts = (player) => Array.from({ length: Math.max(0, player.hand.length - 1) }, (_, i) => i + 2);
const hasPair = (game, player, predicate) => player.hand.some((card, index) =>
  player.hand.slice(index + 1).some((other) => predicate(game, player.id, [card, other])));
function flipRunes(game, player, from, amount, skillId) {
  const to = from === "battleRunes" ? "magicRunes" : "battleRunes";
  player.hero.state[from] -= amount;
  player.hero.state[to] += amount;
  game.logSkill(player.id, skillId, `翻转${amount}个${from === "battleRunes" ? "战纹" : "魔纹"}（战纹${player.hero.state.battleRunes}、魔纹${player.hero.state.magicRunes}）`);
}
function* extraRunes(game, player, from, skillId, amount, targetId) {
  if (player.hero.state.form !== "runeBurst" || player.hero.state[from] < 2) return 0;
  return yield* choice(player.id, skillId, `额外翻转符文增加伤害（当前${amount}点）`,
    Array.from({ length: player.hero.state[from] }, (_, n) => ({ value: n, label: `额外翻转${n}个，伤害+${n}` })),
    0, { purpose: "extraRunes", amount, targetId, damageType: skillId === "battleRuneStrike" ? "attack" : "spell" });
}

export class HeroicPuppet extends Hero {
  constructor(enabled = true) {
    super({ id: "heroicPuppet", name: "英灵人形" });
    this.state = { form: null, battleRunes: enabled ? 3 : 0, magicRunes: 0 };
    if (!enabled) return;
    this.skills = [
      { id: "runeMastery", name: "战纹掌握" },
      {
        id: "angerSuppression", name: "怒火压制",
        ...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter: ({ context }) => this.isActiveAttack(context) && this.state.battleRunes > 0 && !context.puppetMissMode,
        *resolve({ game, player, context }) {
          if (!(yield* game.offerSkill(player.id, "angerSuppression", "怒火压制", context))) return;
          context.puppetMissMode = "angerSuppression";
          flipRunes(game, player, "battleRunes", 1, "angerSuppression");
        },
      },
      {
        id: "battleRuneStrike", name: "战纹碎击",
        ...this.onOwnAttack([Timing.ATTACK_HIT]),
        filter: ({ game, player, context }) => this.isActiveAttack(context) && this.state.battleRunes > 0 && hasPair(game, player, sameElements),
        *resolve({ game, player, context, options }) {
          const cards = yield* game.chooseCardSet(player.id, {
            counts: counts(player), cardsFilter: (cards) => sameElements(game, player.id, cards),
            skillId: "battleRuneStrike", title: "战纹碎击：可明弃至少2张同系牌", optional: true,
            context: { targetId: context.targetId, amount: context.amount },
          });
          if (!cards) return;
          const extra = yield* extraRunes(game, player, "battleRunes", "battleRuneStrike", context.amount + cards.length - 1, context.targetId);
          flipRunes(game, player, "battleRunes", 1 + extra, "battleRuneStrike");
          yield* discardCost(game, player, cards, "battleRuneStrike", options);
          const added = cards.length - 1 + extra;
          context.amount += added;
          game.logSkill(player.id, "battleRuneStrike", `本次攻击伤害+${added}，变为${context.amount}`);
        },
      },
      {
        id: "magicRuneFusion", name: "魔纹融合",
        ...this.onOwnAttack([Timing.ATTACK_MISS]),
        filter: ({ game, player, context }) => this.isActiveAttack(context) && this.state.magicRunes > 0 && !context.puppetMissMode && hasPair(game, player, distinctElements),
        *resolve({ game, player, context, options }) {
          const cards = yield* game.chooseCardSet(player.id, {
            counts: counts(player), cardsFilter: (cards) => distinctElements(game, player.id, cards),
            skillId: "magicRuneFusion", title: "魔纹融合：可明弃至少2张异系牌", optional: true,
            context: { targetId: context.targetId, amount: 0 },
          });
          if (!cards) return;
          context.puppetMissMode = "magicRuneFusion";
          const extra = yield* extraRunes(game, player, "magicRunes", "magicRuneFusion", cards.length - 1, context.targetId);
          flipRunes(game, player, "magicRunes", 1 + extra, "magicRuneFusion");
          yield* discardCost(game, player, cards, "magicRuneFusion", options);
          const amount = cards.length - 1 + extra;
          game.logSkill(player.id, "magicRuneFusion", `对${game.actorLabel(context.targetId)}造成${amount}点法术伤害`);
          yield* game.damageSteps(context.targetId, amount, {
            ...options, attackContext: undefined, sourceId: player.id, damageType: "spell", skillId: "magicRuneFusion",
          });
        },
      },
      {
        id: "runeReconstruction", name: "符文改造",
        ...this.onOwnTurn([Timing.ACTIVATION]),
        filter: ({ game, player }) => !this.state.form && game.canPayEnergy(player.id, "gem"),
        modifyHandLimit: (limit) => limit + Number(this.state.form === "runeBurst"),
        *resolve({ game, player, options }) {
          if (!(yield* game.offerSkill(player.id, "runeReconstruction", "符文改造"))) return;
          yield* game.paySkillEnergy(player.id, "gem");
          player.hero.state.form = "runeBurst";
          game.logSkill(player.id, "runeReconstruction", "横置，进入蓄势迸发形态，手牌上限+1并摸1张牌");
          yield* game.drawSteps(player.id, 1, { ...options, cause: { type: "directDraw", skillId: "runeReconstruction" } });
          const battle = yield* choice(player.id, "runeReconstruction", "选择战纹和魔纹数量",
            Array.from({ length: 4 }, (_, n) => ({ value: n, label: `${n}战纹、${3 - n}魔纹` })),
            player.hero.state.battleRunes, { purpose: "runeAllocation" });
          player.hero.state.battleRunes = battle;
          player.hero.state.magicRunes = 3 - battle;
          game.logSkill(player.id, "runeReconstruction", `调整为${battle}战纹、${3 - battle}魔纹`);
        },
      },
      {
        id: "runeReconstructionEnd", name: "符文改造重置",
        ...this.onOwnTurn([Timing.TURN_END]),
        filter: () => this.state.form === "runeBurst",
        *resolve({ game, player, options }) {
          player.hero.state.form = null;
          game.logSkill(player.id, "runeReconstruction", "回合结束，重置并恢复手牌上限");
          yield* game.drawSteps(player.id, 0, { ...options, cause: { type: "directDraw", skillId: "runeReconstruction" } });
        },
      },
      {
        id: "doubleEcho", name: "双重回响",
        ...this.onDamage([Timing.DAMAGE_BEFORE], "actor"),
        filter: ({ game, player, context }) => context.skillId !== "doubleEcho" && context.amount > 0 &&
          !game.turn.state?.usedSkills[`doubleEcho:${player.id}`] && game.canPayEnergy(player.id, "crystal"),
        *resolve({ game, player, context, options }) {
          if (!(yield* game.offerSkill(player.id, "doubleEcho", "双重回响", context))) return;
          if (game.turn.state) game.turn.state.usedSkills[`doubleEcho:${player.id}`] = true;
          yield* game.paySkillEnergy(player.id, "crystal");
          const amount = Math.min(3, context.amount);
          const targetId = yield* game.choosePlayer(player.id,
            game.players.filter((p) => p.id !== context.targetId).map((p) => p.id),
            `双重回响：对另一名角色造成${amount}点法术伤害`,
            { skillId: "doubleEcho", context: { targetId: context.targetId, amount, moraleLoss: false } });
          game.logSkill(player.id, "doubleEcho", `对${game.actorLabel(targetId)}造成${amount}点法术伤害，不降低士气`);
          yield* game.damageSteps(targetId, amount, {
            ...options, attackContext: undefined, sourceId: player.id, damageType: "spell", skillId: "doubleEcho", moraleLoss: false,
          });
        },
      },
    ];
  }
}
