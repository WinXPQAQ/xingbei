import { createInterface } from 'node:readline';
import { driveGame } from './driver.mjs';
import { DECISION_MODE_V2, DECISION_MODE_V3 } from './decision-space.mjs';
import { driveSageDrill, SAGE_DRILL, SAGE_POISON_DRILL } from './entity/sage-drill.mjs';
import { encodeDecision } from './observation.mjs';
import { createEntityEncoder, ENTITY_SCHEMA } from './entity/observation.mjs';
import { encodeTensorWire } from './entity/binary-wire.mjs';
import { createWireEncoder } from './entity/wire.mjs';
import { enrichPreview } from './preview.mjs';
import { selectEntityDecision } from './entity/decisions.mjs';
import { teacherIndex } from './teacher.mjs';
import { takeLegacyCoverage } from './legacy/policy.mjs';
import { firstSageRefinement, removeExerciseObjective } from './entity/sage-transfer.mjs';
import { createBranchControl } from './entity/branch.mjs';
import { handLabels, poolCounts } from './entity/belief.mjs';

// JSON control headers may be followed by a length-delimited numeric payload.
// Each worker runs one game at a time; launch
// several workers and batch their pending decisions in the Python learner.
let running = false, waiting = null, sequence = 0;
const send = (value, body = null) => {
  process.stdout.write(JSON.stringify(value) + '\n');
  if (body) process.stdout.write(body);
};
createInterface({ input: process.stdin }).on('line', async line => {
  try {
    const message = JSON.parse(line);
    if (message.type === 'select') {
      if (!waiting || waiting.id !== message.id) throw new Error('Stale or unsolicited selection');
      const pending = waiting; waiting = null;
      pending.resolve(message.index);
      return;
    }
    if (message.type !== 'start' || running) throw new Error('Expected start while idle');
    if (message.schema && ![2, ENTITY_SCHEMA].includes(message.schema)) throw new Error('Unsupported observation schema');
    if (message.schema === ENTITY_SCHEMA && (message.baseline || message.seatBaselines)) throw new Error('Legacy residual baseline is incompatible with entity schema');
    if (message.schema === ENTITY_SCHEMA && message.teacher) throw new Error('Hierarchical teacher labels require a teacher-executed path; use collect-all or teacher seat policies');
    if (message.wire && (!['sparse-v1', 'sparse-delta-v1', 'tensor-v1'].includes(message.wire) || message.schema !== ENTITY_SCHEMA)) throw new Error('Unsupported wire format');
    const tensorWire = message.wire === 'tensor-v1';
    const encoders = Object.fromEntries(Object.entries(message.vocabularies ?? {current:message.vocabulary}).map(([key,vocabulary]) => [key,message.wire ? createWireEncoder(vocabulary, { borrowTokens: tensorWire, delta: message.wire === 'sparse-delta-v1', cachePrefix:process.env.XINGBEI_PREFIX_CACHE==='1' }) : value=>value]));
    const encodeEntities = createEntityEncoder({ borrowTokens: tensorWire });
    const forcedChoices = {};
    const sageTransfer = { refined: false, decisions: 0 };
    const branch = message.config.branch ? createBranchControl(message.config.branch) : null;
    const profiling=message.config.profile===true;
    const pipeline={entityMs:0,packMs:0,wireMs:0,teacherMs:0,modelWaitMs:0};
    const cpuStarted=profiling?process.cpuUsage():null;
    const elapsedStarted=profiling?performance.now():0;
    const timed=(key,operation)=>{
      if(!profiling)return operation();
      const start=performance.now(),cpuStart=process.cpuUsage();
      try{return operation();}finally{
        pipeline[key]+=performance.now()-start;
        const cpu=process.cpuUsage(cpuStart),cpuKey=key.replace(/Ms$/,'CpuMs');
        pipeline[cpuKey]=(pipeline[cpuKey]??0)+(cpu.user+cpu.system)/1000;
      }
    };
    const requestIds = new WeakMap();
    let nextRequestId = 0;
    takeLegacyCoverage();
    running = true;
    try {
      if (message.config.exercise && ![SAGE_DRILL, SAGE_POISON_DRILL].includes(message.config.exercise)) throw new Error('Unknown exercise');
      const driver = [SAGE_DRILL, SAGE_POISON_DRILL].includes(message.config.exercise) ? driveSageDrill : driveGame;
      const requestedMode = message.config.decisionMode;
      const decisionMode = message.schema === ENTITY_SCHEMA
        ? [DECISION_MODE_V2, DECISION_MODE_V3].includes(requestedMode) ? requestedMode : 'hierarchical-v1'
        : 'flat';
      const policyForSeat = playerId => message.seatPolicies?.[playerId] ?? 'model';
      const seatDecisionModes = decisionMode === DECISION_MODE_V3
        ? Array.from({ length: 6 }, (_, id) => policyForSeat(id) === 'model' ? DECISION_MODE_V3 : DECISION_MODE_V2)
        : null;
      if (seatDecisionModes && (message.config.exercise || message.config.gemPolicy))
        throw new Error('V3 requires the full-game learner route');
      // Search rollouts run from resampled hidden states; a rule failure there
      // invalidates that one rollout (archived by the driver), not the batch.
      const tolerate = message.config.resample != null;
      const result = await driver({ ...message.config, decisionMode, seatDecisionModes }, async input => {
        const policy = policyForSeat(input.playerId);
        if (policy !== 'model' && !policy.startsWith('model:')) return timed('teacherMs',()=>teacherIndex(input, policy));
        let recordNode = null;
        if (branch && input.playerId === branch.seat) {
          const step = branch.step(input);
          if (step.index !== undefined) return step.index;
          recordNode = step.record ?? null;
        }
        if (policy === 'model' && message.config.sageRefineFirst === true) {
          const forced = firstSageRefinement(input, sageTransfer);
          if (forced !== null) return forced;
        }
        // Keep driveGame.pick in the path so forced choices remain replayable.
        // No observation, GPU request or policy-gradient sample is necessary.
        if (message.schema === ENTITY_SCHEMA && input.candidates.length === 1 && !recordNode) {
          const kind = [input.request.type, input.request.stage ?? 'complete'].join('/');
          forcedChoices[kind] = (forcedChoices[kind] ?? 0) + 1;
          return 0;
        }
        // Optional gem specialist: the learner seat's decisions while it holds
        // at least one gem are answered by another network (same observation).
        const gemRoute = policy === 'model' && message.config.gemPolicy &&
          input.game.player(input.playerId).energy.gem > 0;
        const modelKey = policy === 'model' ? (gemRoute ? message.config.gemPolicy : 'current') : policy.slice(6);
        const pack = encoders[modelKey];
        if (!pack) throw new Error('Unknown network route');
        const fullTeacher = message.teacher ? teacherIndex(input, message.teacher) : null;
        const query = (input, teacher) => {
          const observation = timed('entityMs',()=>message.schema === ENTITY_SCHEMA ? encodeEntities(input) : encodeDecision(input));
          if (message.schema === ENTITY_SCHEMA && message.config.exercise && message.config.hideExerciseObjective === true) {
            removeExerciseObjective(observation);
          }
          const baselineVersion = message.seatBaselines?.[input.playerId] ?? message.baseline;
          if (baselineVersion && !['v1.5','experimental/hero-foundation-1'].includes(baselineVersion)) throw new Error('Unsupported baseline');
          const baseline = baselineVersion ? teacherIndex(input, baselineVersion) : null;
          if (baselineVersion) enrichPreview(observation);
          const id = ++sequence;
          return new Promise(resolve => {
            let sentAt;
            waiting = { id, resolve:value=>{
              if(profiling)pipeline.modelWaitMs+=performance.now()-sentAt;
              resolve(value);
            } };
            const packed = timed('packMs',()=>pack(observation));
            const scope = input.decisionScope ?? input.request;
            if (!requestIds.has(scope)) requestIds.set(scope, ++nextRequestId);
            const team = input.game.player(input.playerId).team;
            const otherTeam = team === 'red' ? 'blue' : 'red';
            // Belief training labels: true hands of the other seats, attached only to
            // the learner's top-level action decisions. Never encoded into observations.
            const beliefRecord = !recordNode && message.config.beliefLabels === true && modelKey === 'current' &&
              input.request.type === 'action' && input.request.stage === 'direction'
              ? { belief: handLabels(input.game, input.playerId), pool: poolCounts(input.game, input.playerId) } : null;
            const header = { type: 'decision', id, seat: input.playerId, modelKey, teacher, baseline,
              ...(modelKey === 'current' && input.v3 ? { v3: input.v3 } : {}),
              ...(recordNode ?? beliefRecord ? { record: recordNode ?? beliefRecord } : {}),
              learning: { requestId: requestIds.get(scope),
                ownMorale: input.game.teams[team].morale,
                enemyMorale: input.game.teams[otherTeam].morale } };
            if (message.wire === 'tensor-v1') {
              const frame = timed('wireMs',()=>encodeTensorWire(packed));
              send({ ...header, observation: frame.observation, binaryBytes: frame.body.length }, frame.body);
            } else send({ ...header, observation: packed });
            if(profiling)sentAt=performance.now();
          });
        };
        if (recordNode) {
          // The observation is stored by the learner; the answer is unused.
          await query(input, null);
          branch.stop('node');
        }
        return message.schema === ENTITY_SCHEMA ? selectEntityDecision(input, query, { teacher: fullTeacher }) : query(input, fullTeacher);
      }).catch(error => {
        if (!tolerate) throw error;
        return { seed: message.config.seed, heroIds: message.config.heroIds, failed: true,
          error: String(error?.message ?? error).slice(0, 300), terminated: false, truncated: true,
          winner: null, rewards: null, forcedUsed: -1, engineRequests: 0, replayedEngineRequests: 0 };
      });
      if(profiling){
        const cpu=process.cpuUsage(cpuStarted);
        pipeline.cpuMs=(cpu.user+cpu.system)/1000;
        pipeline.elapsedMs=performance.now()-elapsedStarted;
      }
      send({ type: 'result', result: { ...result, forcedChoices, legacyCoverage: takeLegacyCoverage(),
        ...(message.config.sageRefineFirst ? {sageTransfer} : {}),
        ...(branch ? { branchInfo: branch.info() } : {}),
        ...(profiling?{pipeline}: {}) } });
    } finally { running = false; }
  } catch (error) {
    send({ type: 'error', error: error.stack });
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
