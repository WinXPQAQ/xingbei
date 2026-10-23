import {createHeroWaveThreePolicy} from "./hero-wave-three/index.js";
import {createHeroWaveTwoPolicy} from './hero-wave-two/index.js';
import {createEconomyPolicy as createHeroFoundationPolicy} from './v1.5.2-rules/index.js';
import {createEconomyPolicy as createPlans4Policy} from './v1.5-plans4/index.js';
import {createEconomyPolicy as createPlans3Policy} from './v1.5-plans3/index.js';
import {createEconomyPolicy as createPlansPolicy} from './v1.5-plans1/index.js';
import {createEconomyPolicy as createPlans2Policy} from './v1.5-plans2/index.js';
import {createEconomyPolicy as createTargetedFixesPolicy} from './targeted-fixes1/index.js';
import { createEconomyPolicy as createActionValue2Policy } from './action-value2/index.js';
import { createEconomyPolicy as createActionValuePolicy } from './action-value1/index.js';
import { createEconomyPolicy as createTeamRoute2Policy } from './team-route2/index.js';
import { createEconomyPolicy as createTeamRoutePolicy } from './team-route1/index.js';
import { createEconomyPolicy as createCapabilityPolicy } from './economy-capability1/index.js';
import { createFusionPolicy } from './v1.1/fusion.js';
import { createEconomyPolicy as createEconomy4Policy } from './v1.3-economy4/index.js';
import { createEconomyPolicy } from './v1.3/index.js';
import { createEconomyPolicy as createEconomy2Policy } from './v1.3-economy2/index.js';
import { createEconomyPolicy as createFrozenEconomyPolicy } from './v1.3-a9/index.js';
import { createChallenger } from './v1.3/challengers.js';
import { legalPolicy } from './legal-policy.js';
import { runPolicyAction } from './runner.js';
import * as baseline from './v1.0/index.js';
import { createPolicy } from './v1.1/index.js';
// Explicit matchups remain possible; no assumption that version ordering implies strength.
const choices = {
  'experimental/hero-foundation-1': createHeroFoundationPolicy(),
  'experimental/plans-1': createPlansPolicy(),
  'experimental/plans-2': createPlans2Policy(),
  'experimental/plans-3': createPlans3Policy(),
  'experimental/plans-4': createPlans4Policy(),
  'experimental/targeted-fixes-1': createTargetedFixesPolicy(),
  'experimental/targeted-fixes-1-no-ownership': createTargetedFixesPolicy({ownership:false}),
  'experimental/targeted-fixes-1-no-energy': createTargetedFixesPolicy({energy:false}),
  'experimental/targeted-fixes-1-no-healing': createTargetedFixesPolicy({healing:false}),
  'experimental/targeted-fixes-1-no-ownership-energy-healing': createTargetedFixesPolicy({ownership:false,energy:false,healing:false}),
  'experimental/action-value-2': createActionValue2Policy(),
  'experimental/action-value-2-no-projection': createActionValue2Policy({projection:false}),
  'experimental/action-value-2-no-tempo': createActionValue2Policy({tempo:false}),
  'experimental/action-value-2-no-energy': createActionValue2Policy({energy:false}),
  'experimental/action-value-2-no-allocation': createActionValue2Policy({allocation:false}),
  'experimental/action-value-1': createActionValuePolicy(),
  'experimental/action-value-1-no-draws': createActionValuePolicy({draws:false}),
  'experimental/action-value-1-no-tempo': createActionValuePolicy({tempo:false}),
  'experimental/action-value-1-no-energy': createActionValuePolicy({energy:false}),
  'experimental/action-value-1-no-allocation': createActionValuePolicy({allocation:false}),
  'v1.0': baseline,
  'experimental/team-route-2': createTeamRoute2Policy(),
  'experimental/team-route-2-no-routes': createTeamRoute2Policy({routes:false}),
  'experimental/team-route-2-no-gifts': createTeamRoute2Policy({gifts:false}),
  'experimental/team-route-2-no-risk': createTeamRoute2Policy({risk:false}),
  'experimental/team-route-1': createTeamRoutePolicy(),
  'experimental/team-route-1-no-routes': createTeamRoutePolicy({routes:false}),
  'experimental/team-route-1-no-gifts': createTeamRoutePolicy({gifts:false}),
  'experimental/team-route-1-no-risk': createTeamRoutePolicy({risk:false}),
  'experimental/economy-capability-1': createCapabilityPolicy(),
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
// Accepted targeted fixes; alias only, frozen candidate behavior is unchanged.
choices['v1.4'] = choices['experimental/targeted-fixes-1'];
// Exact plans-4 frozen at a0e9baa after its independent paired confirmation.
choices['v1.5'] = choices['experimental/plans-4'];
choices['v1.7.0-preview.4'] = createHeroWaveTwoPolicy(choices['v1.5']);
choices['v1.8.0-preview.1'] = createHeroWaveThreePolicy(choices['v1.7.0-preview.4']);
choices['experimental/read-1'] = choices['read-1'];
choices['experimental/fusion-1'] = choices['fusion-1'];
export const policies = Object.freeze(Object.fromEntries(Object.entries(choices).map(([id, frozen]) => { const policy = legalPolicy(frozen); return [id, Object.freeze({ ...policy, runAiAction: (game, actorId, options) => runPolicyAction(policy, game, actorId, options) })]; })));
export function getPolicy(id) {
  if (!Object.hasOwn(policies, id)) throw new Error(`Unknown AI policy: ${id}`);
  return policies[id];
}
