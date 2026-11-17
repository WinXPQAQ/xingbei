import { RuleError } from "../../errors.js";
import { skillLabel } from "../../action-log.js";
// Select covered entities one at a time, retaining an explicit finish choice for variable costs.
export function* selectCovered(
  game,
  player,
  pile,
  {
    skillId,
    title = "选择盖牌",
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
    const label = skillLabel(player, game.activeTrigger?.skillId ?? skillId);
    const heading = label === skillId ? player.hero.name : label;
    const request = {
      type: "effectChoice",
      playerId: player.id,
      skillId,
      title: title.includes(heading) ? title : `${heading}：${title}`,
      choices,
      optional: choices.some((c) => c.value === null),
      defaultValue: choices[0].value,
      context: {
        ...game.activeTrigger?.context,
        selectedCardIds: selected.map((c) => c.id),
      },
    };
    // Runtime-only UI access to the same predicate. Saved choices and AI requests remain sequential.
    Object.defineProperty(request, "cardSelection", { value: {
      min, max, grouped: true,
      cardIds: player.covered.filter(c => c.location.pile === pile).map(c => c.id),
      legalNext(ids) {
        const chosen = ids.map(id => game.cards.get(id));
        return player.covered.filter(c => c.location.pile === pile && !ids.includes(c.id) && predicate(c, chosen)).map(c => c.id);
      },
    } });
    const id = yield request;
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
