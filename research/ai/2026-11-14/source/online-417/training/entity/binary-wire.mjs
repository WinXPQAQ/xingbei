// Flatten the existing sparse features into a length-delimited little-endian frame.
export function encodeTensorWire(observation) {
  const rows = [], ids = [], sources = [], targets = [], roles = [], weightIndices = [], weights = [];
  let maximum = 0;
  for (const [row, token] of [...observation.entities, ...observation.candidates].entries()) {
    const [features, values, referenceRoles, pointers] = token;
    for (let index = 0; index < features.length; index++) {
      if (values[index] !== 1) { weightIndices.push(ids.length); weights.push(values[index]); }
      rows.push(row); ids.push(features[index]);
      maximum = Math.max(maximum, row, features[index]);
    }
    for (let index = 0; index < pointers.length; index++) {
      sources.push(row); targets.push(pointers[index]); roles.push(referenceRoles[index]);
      maximum = Math.max(maximum, row, pointers[index], referenceRoles[index]);
    }
  }
  maximum = Math.max(maximum, ids.length - 1);
  const indexBytes = maximum <= 65535 ? 2 : 4;
  const groups = [rows, ids, sources, targets, roles, weightIndices];
  const weightOffset = Math.ceil(groups.reduce((sum, group) => sum + group.length, 0) * indexBytes / 4) * 4;
  const body = Buffer.alloc(weightOffset + weights.length * 4);
  let offset = 0;
  for (const group of groups) for (const value of group) {
    if (indexBytes === 2) body.writeUInt16LE(value, offset);
    else body.writeUInt32LE(value, offset);
    offset += indexBytes;
  }
  weights.forEach((value, index) => body.writeFloatLE(value === 0 ? 0 : value, weightOffset + index * 4));
  const { entities, candidates, ...metadata } = observation;
  return { body, observation: { ...metadata, wire: 'tensor-v1', indexBytes,
    entity_count: entities.length, action_count: candidates.length,
    feature_count: ids.length, reference_count: roles.length, weight_count: weights.length } };
}
