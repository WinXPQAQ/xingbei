import { createHash } from 'node:crypto';
import { ENTITY_SCHEMA, entitySnapshotKey } from './observation.mjs';

// Fixed checkpoint vocabulary: no hashing, learning or hidden state here.
// This is a transport representation of exactly the model's sparse features.
export function createWireEncoder(symbols, { delta = false, cachePrefix = false, borrowTokens = false } = {}) {
  let previousKey, prefixId = 0;
  let packedKey, packedPrefix;
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
  // In tensor mode the worker owns the raw snapshot and never edits board tokens.
  // Each vocabulary gets its own IDs, even when two policies share the same board.
  const packedTokens = new WeakMap();
  const packBorrowed = token => {
    let packed = packedTokens.get(token);
    if (!packed) {
      packed = pack(token);
      packedTokens.set(token, packed);
    }
    return packed;
  };
  return observation => {
    if (observation.schema !== ENTITY_SCHEMA) throw new Error('Incompatible entity schema');
    const question = observation.entities[observation.question].categorical;
    const snapshotKey = entitySnapshotKey(observation);
    const fresh = !snapshotKey || snapshotKey !== previousKey;
    if (delta && fresh) { previousKey = snapshotKey; prefixId++; }
    const prefix = delta && fresh ? observation.entities.slice(0, observation.question).map(pack) : null;
    let entities;
    if (borrowTokens && !delta) {
      entities = observation.entities.map(packBorrowed);
    } else if(cachePrefix&&!delta&&snapshotKey){
      if(packedKey!==snapshotKey){
        packedKey=snapshotKey;
        packedPrefix=observation.entities.slice(0,observation.question).map(pack);
      }
      // A caller owns its arrays. Reuse the expensive feature work, never
      // expose mutable cached arrays to another observation.
      entities=[...packedPrefix.map(token=>token.map(values=>values.slice())),
        ...observation.entities.slice(observation.question).map(pack)];
    }else entities=(delta?observation.entities.slice(observation.question):observation.entities).map(pack);
    return { schema: ENTITY_SCHEMA, wire: delta ? 'sparse-delta-v1' : 'sparse-v1', vocabulary, question: observation.question,
      ...(delta ? { prefixId, ...(fresh ? { prefix } : {}) } : {}),
      decision_type: question.type, decision_stage: question.stage ?? 'complete', decision_skill: question.skill ?? null,
      entities, candidates: observation.candidates.map(pack) };
  };
}
