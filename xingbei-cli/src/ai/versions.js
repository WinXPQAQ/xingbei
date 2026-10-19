import * as baseline from './v1.0/index.js';
import { createPolicy } from './v1.1/index.js';
// Explicit matchups remain possible; no assumption that version ordering implies strength.
export const policies = Object.freeze({
  'v1.0': baseline,
  'read-1': createPolicy(),
  'read-half': createPolicy({ readingWeight: 0.5 }),
  'read-off': createPolicy({ reading: false }),
});
export function getPolicy(id) {
  if (!Object.hasOwn(policies, id)) throw new Error(`Unknown AI policy: ${id}`);
  return policies[id];
}
