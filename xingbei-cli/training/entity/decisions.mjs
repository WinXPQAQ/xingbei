// Lossless conditional selection over legal commands. No engine mutation occurs
// until the caller receives the original final candidate index.
export const FACTOR_THRESHOLD = 128;
const stages = [['type', 'skillId', 'mode'], ['index', 'cardIds'], ['targetId', 'targetIds']];
const subset = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
export async function selectEntityDecision(input, select, { teacher = null, threshold = FACTOR_THRESHOLD } = {}) {
  const { candidates, request } = input;
  if (request.type !== 'action' || candidates.length <= threshold) return select(input, teacher);
  let remaining = candidates.map((value, index) => ({ value, index }));
  let prefix = {};
  for (const [stage, keys] of stages.entries()) {
    const groups = new Map();
    for (const entry of remaining) {
      const choice = subset(entry.value, keys);
      const key = JSON.stringify(choice);
      if (!groups.has(key)) groups.set(key, { choice, entries: [] });
      groups.get(key).entries.push(entry);
    }
    const options = [...groups.values()];
    let index = 0;
    if (options.length > 1) {
      index = await select({ ...input, request: { ...request, stage: ['action', 'cards', 'targets'][stage], prefix },
        candidates: options.map(option => ({ ...prefix, ...option.choice })),
        continuations: options.map(option => option.entries.map(entry => entry.value)) },
      teacher == null ? null : options.findIndex(option => option.entries.some(entry => entry.index === teacher)));
      if (!Number.isInteger(index) || !options[index]) throw new Error('Invalid subdecision');
    }
    prefix = { ...prefix, ...options[index].choice };
    remaining = options[index].entries;
    if (remaining.length === 1) return remaining[0].index;
  }
  // Fees and any future command fields remain exact full-command choices.
  const index = await select({ ...input, request: { ...request, stage: 'completion', prefix },
    candidates: remaining.map(entry => entry.value) },
  teacher == null ? null : remaining.findIndex(entry => entry.index === teacher));
  if (!Number.isInteger(index) || !remaining[index]) throw new Error('Invalid completion');
  return remaining[index].index;
}
