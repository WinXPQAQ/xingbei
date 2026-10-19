import { createFusionPolicy } from './v1.1/fusion.js';
import { runPolicyAction } from './runner.js';
import * as baseline from './v1.0/index.js';
import { createPolicy } from './v1.1/index.js';
// Explicit matchups remain possible; no assumption that version ordering implies strength.
const choices = {
  'v1.0': baseline,
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
choices['experimental/read-1'] = choices['read-1'];
choices['experimental/fusion-1'] = choices['fusion-1'];
export const policies = Object.freeze(Object.fromEntries(Object.entries(choices).map(([id, policy]) => [id, Object.freeze({ ...policy, runAiAction: (game, actorId, options) => runPolicyAction(policy, game, actorId, options) })])));
export function getPolicy(id) {
  if (!Object.hasOwn(policies, id)) throw new Error(`Unknown AI policy: ${id}`);
  return policies[id];
}
