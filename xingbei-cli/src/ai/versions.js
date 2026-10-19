import { createFusionPolicy } from './v1.1/fusion.js';
import { createEconomyPolicy as createEconomy4Policy } from './v1.3-economy4/index.js';
import { createEconomyPolicy } from './v1.3/index.js';
import { createEconomyPolicy as createEconomy2Policy } from './v1.3-economy2/index.js';
import { createEconomyPolicy as createFrozenEconomyPolicy } from './v1.3-a9/index.js';
import { createChallenger } from './v1.3/challengers.js';
import { runPolicyAction } from './runner.js';
import * as baseline from './v1.0/index.js';
import { createPolicy } from './v1.1/index.js';
// Explicit matchups remain possible; no assumption that version ordering implies strength.
const choices = {
  'v1.0': baseline,
  'experimental/economy-1': createFrozenEconomyPolicy(),
  'experimental/economy-2': createEconomy2Policy(),
  'experimental/economy-4': createEconomy4Policy(),
  'experimental/economy-3': createEconomyPolicy(),
  'experimental/economy-3-no-sequence': createEconomyPolicy({ sequence: false }),
  'experimental/economy-3-no-hand': createEconomyPolicy({ economy: false }),
  'experimental/economy-2-no-sequence': createEconomy2Policy({ sequence: false }),
  'experimental/economy-2-no-hand': createEconomy2Policy({ economy: false }),
  'experimental/economy-no-sequence': createFrozenEconomyPolicy({ sequence: false }),
  'experimental/economy-no-hand': createFrozenEconomyPolicy({ economy: false }),
  'experimental/style-flow': createChallenger('flow'),
  'experimental/style-reserve': createChallenger('reserve'),
  'fusion-1': createFusionPolicy(),
  'read-1': createPolicy(),
  'read-prior': createPolicy({ history: false }),
  'read-half': createPolicy({ readingWeight: 0.5 }),
  'defense-1': createPolicy({ reading: false, defense: true }),
  'heroes-1': createPolicy({ reading: false, heroes: true }),
  'read-defense': createPolicy({ defense: true }),
  'all-1': createPolicy({ defense: true, heroes: true }),
  'read-off': createPolicy({ reading: false }),
};
// Promoted after the preregistered holdout gate; exactly the frozen read-1 candidate.
choices['v1.1'] = choices['read-1'];
// Stable release alias: preserve historical v1.1 semantics.
choices['v1.2'] = choices['fusion-1'];
// Exact accepted economy-4 policy; historical stable aliases remain frozen.
choices['v1.3'] = choices['experimental/economy-4'];
choices['experimental/read-1'] = choices['read-1'];
choices['experimental/fusion-1'] = choices['fusion-1'];
export const policies = Object.freeze(Object.fromEntries(Object.entries(choices).map(([id, policy]) => [id, Object.freeze({ ...policy, runAiAction: (game, actorId, options) => runPolicyAction(policy, game, actorId, options) })])));
export function getPolicy(id) {
  if (!Object.hasOwn(policies, id)) throw new Error(`Unknown AI policy: ${id}`);
  return policies[id];
}
