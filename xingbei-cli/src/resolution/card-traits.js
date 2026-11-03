import { ELEMENT_NAMES } from "../cards.js";
import { RuleError } from "../errors.js";
import { Timing } from "../timing.js";

// Select a meaning for this use, not a persistent "switch element" ability.
// Set predicates (same/distinct) already solve existential assignments and do
// not need a prompt when only legality, rather than the chosen element, matters.
export function* attackTraitsFor(
  game,
  playerId,
  card,
  { matching = null, required = null, element = null, targetId = null } = {},
) {
  const traits = card.getTraits({ game, playerId, purpose: "attack" });
  if (traits.elements.length <= 1) return traits;
  let available = traits.elements;
  if (matching && available.some((e) => matching.includes(e)))
    available = available.filter((e) => matching.includes(e));
  if (required) available = available.filter((e) => e === required);
  if (!available.length) throw new RuleError("此攻击没有符合限制的系别");
  if (element && !available.includes(element))
    throw new RuleError("无效的攻击系别");
  const selected =
    element ??
    (available.length === 1
      ? available[0]
      : yield {
          type: "numberChoice",
          playerId,
          skillId: "bladeElement",
          title: "希望这张牌作为什么系别？",
          choices: available.map((value) => ({
            value,
            label: ELEMENT_NAMES[value],
          })),
          context: { cardId: card.id, targetId },
          defaultValue: available[0],
        });
  if (!available.includes(selected)) throw new RuleError("无效的攻击系别");
  return { ...traits, elements: [selected] };
}

// Remember feasible assignments for the confirmed cost. These references never
// enter observation/serialization, and are consumed by the next move/exposure.
export function rememberSelection(
  game,
  playerId,
  cards,
  predicate = () => true,
) {
  const traits = cards.map((c) => c.getTraits({ game, playerId }));
  if (!traits.some((t) => t.elements.length > 1)) return;
  let assignments = [[]];
  for (const t of traits)
    assignments = assignments.flatMap((a) =>
      (t.elements.length ? t.elements : [null]).map((e) => [...a, e]),
    );
  assignments = assignments.filter((values) =>
    predicate(
      cards.map(
        (card, i) =>
          new Proxy(card, {
            get(target, key) {
              const selected = {
                ...traits[i],
                elements: values[i] ? [values[i]] : [],
              };
              if (key === "getTraits") return () => selected;
                  if (key === "element") return values[i];
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          }),
      ),
    ),
  );
  if (!assignments.length)
    throw new RuleError("所选牌无法分配符合费用要求的系别");
  const selection = { ids: cards.map((c) => c.id), assignments };
  for (const c of cards) c.pendingTraitSelection = selection;
}

export function* resolveExposureTraits(game, event) {
  const groups = new Set(event.selections.filter(Boolean));
  for (let i = 0; i < event.cards.length; i++)
    if (event.traits[i].elements.length > 1 && !event.selections[i])
      groups.add({
        ids: [event.cards[i].id],
        assignments: event.traits[i].elements.map((e) => [e]),
      });
  for (const group of groups) {
    let allowed = group.assignments;
    for (let pos = 0; pos < group.ids.length; pos++) {
      const index = event.cards.findIndex((c) => c.id === group.ids[pos]);
      if (index < 0 || event.traits[index].elements.length < 2) continue;
      const elements = [...new Set(allowed.map((a) => a[pos]))];
      // Ask only when changing the interpretation changes an actual subscriber.
      const entries = game.triggers.get(Timing.CARD_EXPOSED, event);
      const signature = (element) => {
        const context = {
          ...event,
          traits: event.traits.map((t, i) =>
            i === index ? { ...t, elements: [element] } : t,
          ),
        };
        return entries
          .map((entry) =>
            Number(
              !entry.definition.filter ||
                entry.definition.filter({
                  game,
                  timing: Timing.CARD_EXPOSED,
                  context,
                  ...entry,
                }),
            ),
          )
          .join("");
      };
      let selected = elements[0];
      if (elements.length > 1 && new Set(elements.map(signature)).size > 1) {
        selected = yield {
          type: "numberChoice",
          playerId: event.playerId,
          skillId: "bladeElement",
          title: "希望这张牌作为什么系别？",
          choices: elements.map((value) => ({
            value,
            label: ELEMENT_NAMES[value],
          })),
          context: { cardId: group.ids[pos] },
          defaultValue: elements[0],
        };
        if (!elements.includes(selected)) throw new RuleError("无效的费用系别");
      }
      event.traits[index] = { ...event.traits[index], elements: [selected] };
      game.log.push(
        `${game.actorLabel(event.playerId)}的牌本次视为${ELEMENT_NAMES[selected]}系`,
      );
      game.recordPublicAction({
        type: "cardInterpretation",
        playerId: event.playerId,
        card: event.cards[index].name,
        elements: [selected],
      });
      allowed = allowed.filter((a) => a[pos] === selected);
    }
  }
}
