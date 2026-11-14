// Read-only inventory and demonstration index; never imports records into training.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { decisionPlayer } from '../training/candidates.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tools/audit-human-games.mjs RECORD_DIRECTORY OUTPUT_DIRECTORY');
const root = resolve(input), destination = resolve(output);
if (destination === root || destination.startsWith(root + '/')) throw new Error('Keep audit output outside the original records');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const actionNames = new Set(['executeAction', 'playWithDecisions', 'attackWithDecisions', 'playMagicWithDecisions', 'skipExtraActions', 'activateAsync']);
const rows = [], games = [];
function forced(request) {
  if (Array.isArray(request.choices)) return request.choices.length === 1;
  if (request.type === 'response') return request.valid?.length === 0;
  if (request.type === 'target') return request.targets?.length === 1;
  if (request.type === 'cardChoice' && request.validSets) return request.validSets.length + (request.optional ? 1 : 0) === 1;
  return false; // Unknown candidate counts require rule replay, not a guess.
}
for (const directory of (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  const source = join(root, directory.name);
  const game = { id: directory.name, source, issues: [], humanActions: 0, humanDecisions: 0, forcedDecisions: 0, modelSteps: 0, decisionTypes: {}, samples: 0 };
  games.push(game);
  try {
    const metadata = await json(join(source, 'metadata.json')), summary = await json(join(source, 'summary.json'));
    const config = metadata.configuration, seat = config.humanSeat;
    if (!Number.isInteger(seat) || seat < 0 || seat > 5 || !['normal', 'team'].includes(config.mode)) throw new Error('Invalid human seat/mode');
    const humanSeats = config.humanSeats ?? [seat];
    Object.assign(game, {mode:config.mode, humanSeats, informationScope:config.informationScope ?? 'individual', heroes:humanSeats.map(id=>config.initialConfig.heroIds[id])});
    Object.assign(game, { humanSeat: seat, hero: config.initialConfig.heroIds[seat], team: config.initialConfig.teams[seat], sourceSeed: config.initialConfig.seed, ruleVariant: config.initialConfig.ruleVariant ?? 'standard', ruleRevision: metadata.ruleRevision, modelHash: config.modelHash, status: summary.status });
    const files = (await readdir(source)).filter(name => /^\d+\.json$/.test(name)).sort();
    const requests = new Map(), commands = [], samples = [];
    let initial, finished;
    for (let index = 0; index < files.length; index++) {
      const record = await json(join(source, files[index]));
      if (record.sequence !== index || Number(files[index].slice(0,-5)) !== index) game.issues.push(`sequence gap at ${index}`);
      const event = record.event, sequence = record.sequence;
      if (event.type === 'initial') initial = event;
      if (event.type === 'finished') finished = event;
      if (event.type === 'model-choice') game.modelSteps++;
      if (event.type === 'decision-request') {
        if (requests.has(event.decisionId)) game.issues.push(`duplicate decision ${event.decisionId}`);
        requests.set(event.decisionId, { sequence, request: event.request, parentDecisionId: event.parentDecisionId });
      }
      if (event.type === 'decision-choice') {
        const pending = requests.get(event.decisionId);
        if (!pending) { game.issues.push(`unpaired choice ${sequence}`); continue; }
        requests.delete(event.decisionId);
        const actingSeat=decisionPlayer(pending.request);
        if (!humanSeats.includes(actingSeat)) continue;
        game.humanDecisions++;
        const type = pending.request.type;
        game.decisionTypes[type] = (game.decisionTypes[type] ?? 0) + 1;
        if (forced(pending.request)) { game.forcedDecisions++; continue; }
        samples.push({ kind: 'human-decision', actingSeat, sequence, stateSequence: pending.sequence, decisionId: event.decisionId, parentDecisionId: pending.parentDecisionId, requestType: type, skillId: pending.request.skillId ?? null, choice: event.choice });
      }
      if (event.type === 'command') {
        const humanAction = actionNames.has(event.name) && humanSeats.includes(event.args?.[0]) && (event.depth ?? 0) === 0;
        const sample = humanAction ? { kind: 'human-action', actingSeat:event.args[0], sequence, stateSequence: sequence, name: event.name, args: event.args } : null;
        if (event.name === 'skipExtraActions') { if (sample) { samples.push(sample); game.humanActions++; } }
        else commands.push({ name: event.name, sample });
      }
      if (event.type === 'command-result' || event.type === 'command-error') {
        const command = commands.pop();
        if (command?.name !== event.name) game.issues.push(`command pairing ${sequence}`);
        if (event.type === 'command-error') game.issues.push(`command error ${sequence}: ${event.message}`);
        else if (command?.sample) { samples.push(command.sample); game.humanActions++; }
      }
    }
    if (!initial || initial.state.players[seat].team !== game.team) game.issues.push('initial identity missing/mismatch');
    if (files.length !== summary.lastSequence + 1) game.issues.push('summary sequence mismatch (possibly still uploading)');
    game.complete = summary.status === 'completed' && !!finished;
    if (game.complete) {
      const winner = finished.winner;
      if (!['red','blue'].includes(winner) || winner !== summary.winner || winner !== finished.state.winner) game.issues.push('winner mismatch');
      if (requests.size || commands.length) game.issues.push('unfinished requests/commands');
      game.winner = winner; game.humanWon = winner === game.team;
      game.victoryRoute = finished.state.teams[winner]?.cups >= 5 ? 'cups' : finished.state.teams[winner === 'red' ? 'blue' : 'red']?.morale <= 0 ? 'morale' : 'other';
    }
    game.indexable = game.complete && game.issues.length === 0;
    if (game.indexable) for (const sample of samples.sort((a,b) => a.sequence-b.sequence)) {
      rows.push({ gameId: game.id, source, sourceSeed: game.sourceSeed, splitGroup: String(game.sourceSeed), hero: config.initialConfig.heroIds[sample.actingSeat], humanSeat: sample.actingSeat, humanSeats, mode:config.mode, informationScope:game.informationScope, ruleVariant: game.ruleVariant, ruleRevision: game.ruleRevision, humanWon: game.humanWon, teamOutcome: game.humanWon ? 1 : -1, ...sample, trainReady: false, labelMeaning: 'recorded human choice; outcome is not an action-quality label' });
      game.samples++;
    }
  } catch (error) { game.indexable = false; game.issues.push(error.message); }
}
const accepted = games.filter(game => game.indexable), winners = accepted.filter(game => game.humanWon);
const coverage = set => Object.fromEntries([...new Set(set.flatMap(game => game.heroes))].sort().map(hero => [hero, set.filter(game => game.heroes.includes(hero)).length]));
const summary = { games: games.length, complete: games.filter(game => game.complete).length, indexable: accepted.length, humanWins: winners.length, humanLosses: accepted.length-winners.length, samples: rows.length, winningSamples: rows.filter(row => row.humanWon).length, humanActions: accepted.reduce((n,g)=>n+g.humanActions,0), humanDecisions: accepted.reduce((n,g)=>n+g.humanDecisions,0), forcedExcluded: accepted.reduce((n,g)=>n+g.forcedDecisions,0), heroCoverage: coverage(accepted), winningHeroCoverage: coverage(winners) };
await mkdir(destination, { recursive: true });
for (const [name, samples] of [['human-decisions', rows], ['winning-human-decisions', rows.filter(row => row.humanWon)]]) await writeFile(join(destination, name+'.jsonl'), samples.map(row => JSON.stringify(row)).join('\n') + (samples.length ? '\n' : ''));
await writeFile(join(destination, 'audit.json'), JSON.stringify({ createdAt: new Date().toISOString(), source: root, summary, caveats: ['Team-control records include possible teammate-hand memory and must not be mixed into individual-view demonstrations without an explicit distillation policy.', 'Indices only: no policy observations reconstructed and no samples approved for imitation.', 'Complete games with record errors quarantined; incomplete games have no loss label.', 'Nested requests and root actions may belong to one decision; deduplicate during replay.', 'Split by whole source game; winning games still contain mistakes; AI choices excluded.', 'Standard cup victories must not be relabelled as wins under morale-only rules.', 'Human choices are fallible positive references, not ground truth or mandatory policy targets; win-only exports are optional subsets.'], games }, null, 2));
console.log(JSON.stringify({ output: destination, ...summary }, null, 2));
