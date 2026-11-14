import { RuleError } from "../../errors.js";
// Select covered entities one at a time, retaining an explicit finish choice for variable costs.
export function* selectCovered(
  game,
  player,
  pile,
  {
    skillId,
    min = 1,
    max = min,
    optional = false,
    predicate = () => true,
  } = {},
) {
  const selected = [];
  while (selected.length < max) {
    const cards = player.covered.filter(
      (c) =>
        c.location.pile === pile &&
        !selected.includes(c) &&
        predicate(c, selected),
    );
    const choices = cards.map((c) => ({
      value: c.id,
      label: game.describeCards([c], player.id),
    }));
    if (selected.length >= min || (optional && !selected.length))
      choices.unshift({
        value: null,
        label: selected.length ? "完成选牌" : "不发动",
      });
    if (!choices.length) break;
    const id = yield {
      type: "effectChoice",
      playerId: player.id,
      skillId,
      title: "选择盖牌",
      choices,
      optional: choices.some((c) => c.value === null),
      defaultValue: choices[0].value,
      context: {
        ...game.activeTrigger?.context,
        selectedCardIds: selected.map((c) => c.id),
      },
    };
    if (!choices.some((c) => c.value === id))
      throw new RuleError("无效的盖牌选择");
    if (id === null) break;
    selected.push(cards.find((c) => c.id === id));
  }
  if (selected.length < min) return [];
  return selected;
}
export function* selectPlayers(game, player, ids, count, skillId, title) {
  const selected = [];
  while (selected.length < count) {
    const id = yield* game.choosePlayer(
      player.id,
      ids.filter((id) => !selected.includes(id)),
      title,
      { skillId },
    );
    selected.push(id);
  }
  return selected;
}
