import { createHash } from 'node:crypto';
import { ENTITY_SCHEMA } from './observation.mjs';

// Fixed checkpoint vocabulary: no hashing, learning or hidden state here.
// This is a transport representation of exactly the model's sparse features.
export function createWireEncoder(symbols) {
  if (!Array.isArray(symbols) || symbols[0] !== '<pad>' || symbols[1] !== '<unknown>' ||
      new Set(symbols).size !== symbols.length || symbols.some(s => typeof s !== 'string'))
    throw new Error('Invalid entity vocabulary');
  const ids = new Map(symbols.map((symbol, index) => [symbol, index]));
  const vocabulary = createHash('sha256').update(JSON.stringify(symbols)).digest('hex');
  const id = symbol => ids.get(symbol) ?? 1;
  const text = value => value == null ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value);
  const pack = token => {
    const features = [id('kind=' + token.kind)], weights = [1], roles = [], targets = [];
    for (const [key, value] of Object.entries(token.categorical)) {
      if (value === undefined) continue; // Same as JSON omission in the raw path.
      for (const item of Array.isArray(value) ? value : [value]) {
        features.push(id(`${key}=${text(item)}`)); weights.push(1);
      }
    }
    for (const [key, value] of Object.entries(token.numbers)) if (value != null) {
      if (!Number.isFinite(Number(value))) throw new Error('Nonfinite numeric feature');
      features.push(id('number:' + key)); weights.push(Math.sign(value) * Math.log1p(Math.abs(value)));
    }
    for (const [role, pointers] of Object.entries(token.refs)) for (const [index, pointer] of pointers.entries()) {
      roles.push(id('ref:' + role + (role === 'targets' ? ':' + index : ''))); targets.push(pointer);
    }
    return [features, weights, roles, targets];
  };
  return observation => {
    if (observation.schema !== ENTITY_SCHEMA) throw new Error('Incompatible entity schema');
    return { schema: ENTITY_SCHEMA, wire: 'sparse-v1', vocabulary, question: observation.question,
      entities: observation.entities.map(pack), candidates: observation.candidates.map(pack) };
  };
}
