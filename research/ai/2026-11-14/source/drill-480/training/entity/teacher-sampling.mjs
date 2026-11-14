import { createHash } from 'node:crypto';

export const TEACHER_SAMPLING = 'stratified-chains-v1';

const defaults = {
  samplesPerSeat: 12,
  chainSteps: 12,
  bytesPerGame: 6 * 1024 * 1024,
};

export function teacherSamplingConfig() {
  const config = {
    samplesPerSeat: Number(process.env.XINGBEI_TEACHER_SAMPLES_PER_SEAT ?? defaults.samplesPerSeat),
    chainSteps: Number(process.env.XINGBEI_TEACHER_CHAIN_STEPS ?? defaults.chainSteps),
    bytesPerGame: Number(process.env.XINGBEI_TEACHER_BYTES_PER_GAME ?? defaults.bytesPerGame),
  };
  if (Object.values(config).some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error('Teacher sampling limits must be positive integers');
  }
  return { version: TEACHER_SAMPLING, ...config };
}

// These limits cover retained JSON samples. Engine state and replay prefixes
// remain the driver's responsibility. Sampling never consumes the engine RNG.
export function createTeacherSampler(seed, config = teacherSamplingConfig()) {
  const random = key => createHash('sha256').update(`${seed}:${key}`).digest().readUInt32LE(0) / 0x100000000;
  const perSeatBytes = Math.floor(config.bytesPerGame / 6);
  const strataBudget = Math.floor(perSeatBytes / 2);
  const chainBudget = perSeatBytes - strataBudget;
  const seats = Array.from({ length: 6 }, () => ({
    strata: new Map(), counts: new Map(), chain: [], eligibleChains: 0, omittedChains: 0, oversizedSamples: 0,
  }));
  let ordinal = 0, chainId = 0, current = null;

  function finishChain() {
    if (!current) return;
    const seat = seats[current.seat];
    if (current.omitted) seat.omittedChains++;
    else if (current.rows.length > 1) {
      seat.eligibleChains++;
      if (random(`chain:${current.seat}:${seat.eligibleChains}`) < 1 / seat.eligibleChains) {
        seat.chain = current.rows;
      }
    }
    current = null;
  }

  function add(input, choice, observation, root = input.rootRequest ?? input.request) {
    const seatId = input.playerId, seat = seats[seatId];
    if (!current || current.root !== root || current.seat !== seatId) {
      finishChain();
      current = { root, seat: seatId, id: chainId++, rows: [], bytes: 0, steps: 0, omitted: false };
    }
    const question = observation.entities[observation.question].categorical;
    const stratum = JSON.stringify([question.type, question.stage, question.skill, question.purpose]);
    const seen = (seat.counts.get(stratum) ?? 0) + 1;
    seat.counts.set(stratum, seen);
    const sample = { seat: seatId, choice, observation,
      sample: { ordinal: ordinal++, chain: current.id, step: current.steps++, stratum } };
    const bytes = Buffer.byteLength(JSON.stringify(sample));

    if (!current.omitted) {
      if (current.steps > config.chainSteps || current.bytes + bytes > chainBudget) {
        current.omitted = true;
        current.rows = [];
      } else {
        current.rows.push(sample);
        current.bytes += bytes;
      }
    }

    if (bytes > strataBudget) seat.oversizedSamples++;
    else if (!seat.strata.has(stratum) || random(`row:${seatId}:${stratum}:${seen}`) < 1 / seen) {
      seat.strata.set(stratum, { sample, bytes });
    }
    // Prefer underrepresented kinds when a seat has more kinds than slots.
    // Within each retained kind, reservoir replacement avoids always taking its
    // first occurrence. Coverage below describes the resulting biased sample.
    const ranked = [...seat.strata.entries()].sort(([left], [right]) =>
      seat.counts.get(left) - seat.counts.get(right)
      || random(`kind:${seatId}:${left}`) - random(`kind:${seatId}:${right}`));
    seat.strata.clear();
    let retainedBytes = 0;
    for (const [key, entry] of ranked) {
      if (seat.strata.size >= config.samplesPerSeat || retainedBytes + entry.bytes > strataBudget) continue;
      seat.strata.set(key, entry);
      retainedBytes += entry.bytes;
    }
  }

  function finish() {
    finishChain();
    const retained = new Map();
    for (const seat of seats) {
      for (const { sample } of seat.strata.values()) retained.set(sample.sample.ordinal, sample);
      for (const sample of seat.chain) retained.set(sample.sample.ordinal, sample);
    }
    const decisions = [...retained.values()].sort((left, right) => left.sample.ordinal - right.sample.ordinal);
    const coverage = seats.map((seat, id) => ({
      seat: id,
      observed: [...seat.counts.values()].reduce((sum, value) => sum + value, 0),
      retained: decisions.filter(sample => sample.seat === id).length,
      eligibleChains: seat.eligibleChains,
      omittedChains: seat.omittedChains,
      retainedChain: seat.chain.length ? { id: seat.chain[0].sample.chain, steps: seat.chain.length } : null,
      oversizedSamples: seat.oversizedSamples,
      strata: [...seat.counts].map(([key, seen]) => ({ key, seen,
        retained: decisions.filter(sample => sample.seat === id && sample.sample.stratum === key).length })),
    }));
    return { decisions, sampling: { config, observed: ordinal,
      retainedBytes: decisions.reduce((sum, sample) => sum + Buffer.byteLength(JSON.stringify(sample)), 0), coverage } };
  }
  return { add, finish };
}
