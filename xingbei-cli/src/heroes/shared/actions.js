import { skillLabel } from "../../action-log.js";
import { RuleError } from "../../errors.js";
export const targets = (game) => game.players.map((p) => p.id);
export const enemies = (game, player) =>
  game.players.filter((p) => p.team !== player.team).map((p) => p.id);
export const hasElement = (game, player, card, element) =>
  card.getTraits({ game, playerId: player.id }).elements.includes(element);
export function* choice(
  playerId,
  skillId,
  title,
  choices,
  defaultValue = choices[0]?.value,
  context = {},
) {
  const value = yield {
    type: "numberChoice",
    context,
    playerId,
    skillId,
    title,
    choices,
    defaultValue,
  };
  if (!choices.some((c) => c.value === value))
    throw new RuleError("无效的技能选项");
  return value;
}
export function* healTarget(game, player, amount, skillId) {
  const id = yield* game.choosePlayer(
    player.id,
    targets(game),
    `${skillLabel(player, skillId)}：选择治疗目标`,
    { skillId },
  );
  game.changeHealing(id, amount);
}
export function* drawCards(game, player, count, skillId, options) {
  yield* game.drawSteps(player.id, count, {
    overflow: "defer",
    cause: { type: "directDraw", skillId },
  });
  yield* game.present();
  if (player.pendingOverflow) yield { type: "overflow", player };
}
export function* discardCost(
  game,
  player,
  cards,
  skillId,
  options,
  visibility = "public",
) {
  game.discardCards(player.id, cards, { reason: skillId, visibility });
  yield* game.flushRuleEvents(options);
}
export function* useUnique(game, player, card, options) {
  game.playCard(player, player.hand.indexOf(card), options);
  yield* game.flushRuleEvents(options);
}
export function uniqueAction(
  skillId,
  name,
  resolveAction,
  targetCounts = null,
) {
  return {
    id: skillId,
    name,
    action(game) {
      return {
        type: "spell",
        cardCount: 1,
        cardFilter: (c) => c.hasUniqueSkill(skillId),
        targets: targets(game),
        ...(targetCounts ? { targetCounts } : {}),
      };
    },
    resolveAction,
  };
}
export function* extraAction(game, player, skillId) {
  const type = yield* choice(player.id, skillId, "选择额外行动", [
    { value: "attack", label: "攻击行动" },
    { value: "spell", label: "法术行动" },
  ]);
  game.turn.addAction({ type, sourceSkillId: skillId });
}
export function* spendStones(game, player, skillId, maximum = 2) {
  const count = game.stoneCounts(player.team),
    choices = [];
  for (let gem = 0; gem <= count.gem; gem++)
    for (let crystal = 0; crystal <= count.crystal; crystal++)
      if (gem + crystal >= 1 && gem + crystal <= maximum)
        choices.push({
          value: `${gem}:${crystal}`,
          label: `${gem}宝石、${crystal}水晶`,
        });
  const selected = yield* choice(
    player.id,
    skillId,
    "选择消耗的战绩星石",
    choices,
  );
  const [gem, crystal] = selected.split(":").map(Number);
  game.removeStones(player.team, { gem, crystal });
  game.logSkill(player.id, skillId, `消耗战绩区${gem}宝石、${crystal}水晶`);
  return gem + crystal;
}
