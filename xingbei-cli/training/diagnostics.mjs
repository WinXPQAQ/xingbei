import { Game } from '../src/engine.js';
import { actionCandidates, decisionCandidates } from './candidates.mjs';
import { teacherIndex } from './teacher.mjs';
import { enrichPreview } from './preview.mjs';
import { encodeDecision } from './observation.mjs';

// Deliberately known diagnostic fixtures, NOT held-out evaluation.
export function prepare(ordinaryAvailable, reverse = false) {
  const game = new Game({ seed: 210000101, playerHeroId: 'sealer' }).setup();
  const available = [...game.cards.values()].filter(card => card.category === 'basic');
  const used = new Set();
  const take = predicate => {
    const card = available.find(card => !used.has(card.id) && predicate(card));
    if (!card) throw new Error('Missing diagnostic card');
    used.add(card.id); return card;
  };
  const ordinary = () => take(card => card.name === 'waterStrike' && !card.uniqueSkills.includes('waterSeal'));
  const unique = take(card => card.uniqueSkills.includes('waterSeal'));
  const cards = [unique, ordinaryAvailable ? ordinary() : take(card => card.name === 'fireStrike'),
    take(card => card.name === 'fireStrike'), take(card => card.name === 'earthStrike')];
  const incoming = ordinary();
  for (const player of game.players) for (const card of [...player.hand]) game.moveCard(card.id, { zone: 'deck' }, { animate: false });
  for (const card of reverse ? cards.reverse() : cards) game.moveCard(card.id, { zone: 'hand', playerId: 0 }, { animate: false });
  game.moveCard(incoming.id, { zone: 'hand', playerId: 1 }, { animate: false });
  game.teams.red.morale = 1;
  game.player(0).handLimit = 4;
  game.player(0).healing = 0;
  game.current = 1;
  const steps = game.actionSteps(1, 0, 0, { overflow: 'defer' });
  let step = steps.next();
  while (!step.done && step.value.type === 'presentation') step = steps.next();
  if (step.value?.type !== 'response' || step.value.target.id !== 0) throw new Error('Fixture did not reach intended response');
  return { game, request: step.value, steps };
}

function sealerCases(baseline = false) {
  return [true, false].flatMap(ordinaryAvailable => [false, true].map(reverse => {
    const { game, request } = prepare(ordinaryAvailable, reverse);
    const candidates = decisionCandidates(game, request);
    const observation = encodeDecision({ game, playerId: 0, request, candidates });
    const baselineChoice = baseline ? teacherIndex({ game, playerId: 0, request, candidates }, 'v1.5') : null;
    if (baseline) enrichPreview(observation);
    const preferred = candidates.flatMap((candidate, index) => {
      if (candidate == null) return [];
      const unique = game.player(0).hand[candidate.index].uniqueSkills.includes('waterSeal');
      return unique !== ordinaryAvailable ? [index] : [];
    });
    return { name: ordinaryAvailable ? 'preserve-water-seal' : 'spend-only-water-seal-to-survive',
      reversedHand: reverse, preferred, observation, ...(baseline ? { baselineChoice } : {}) };
  }));
}


export function diagnosticCases(baseline = false) {
  const cases = sealerCases(baseline);
  for (const healing of [0, 2]) for (const ordinaryAvailable of [true, false]) for (const reverse of [false, true]) {
    const game = new Game({ seed: 210000201, heroIds: ['berserker', 'none', 'none', 'none', 'none', 'none'] });
    const roar = game.deck.find(card => card.name === 'fireStrike' && card.hasUniqueSkill('bloodyRoar'));
    const ordinary = game.deck.find(card => card.name === 'fireStrike' && !card.hasUniqueSkill('bloodyRoar'));
    const cards = ordinaryAvailable ? [roar, ordinary] : [roar];
    for (const card of reverse ? cards.reverse() : cards) game.moveCard(card.id, { zone: 'hand', playerId: 0 });
    for (const player of game.players) if (player.team !== game.player(0).team) player.healing = healing;
    game.startTurn(0);
    const request = { type: 'action' };
    // Hand >= 4 disables purchase; repeated harmless cards avoid forced labels
    // on synthesis/refine. Diagnostic compares legal attacks, not a training reward.
    while (game.player(0).hand.length < 4) {
      const card = game.deck.find(card => card.name === 'holyLight');
      game.moveCard(card.id, { zone: 'hand', playerId: 0 });
    }
    const candidates = actionCandidates(game, 0);
    const input = { game, playerId: 0, request, candidates };
    const observation = encodeDecision(input);
    if (baseline) enrichPreview(observation);
    const preferRoar = healing === 2 || !ordinaryAvailable;
    const preferred = candidates.flatMap((candidate, index) => candidate.index != null &&
      game.player(0).hand[candidate.index].hasUniqueSkill('bloodyRoar') === preferRoar ? [index] : []);
    cases.push({ name: preferRoar ? `use-roar-healing-${healing}-alternative-${ordinaryAvailable}` : 'preserve-inactive-roar',
      reversedHand: reverse, preferred, observation,
      ...(baseline ? { baselineChoice: teacherIndex(input, 'v1.5') } : {}) });
  }
  return cases;
}

export function verifyDiagnosticDecline() {
  for (const ordinaryAvailable of [true, false]) {
    const { game, steps } = prepare(ordinaryAvailable);
    let step = steps.next(null);
    while (!step.done) {
      const request = step.value;
      if (request.type === 'gameOver') { steps.return(); break; }
      if (request.type === 'overflow') {
        const player = request.player;
        game.resolveOverflow(player.id, Array.from({ length: player.hand.length - player.handLimit }, (_, index) => index));
      } else if (request.type !== 'presentation') throw new Error(`Unexpected diagnostic choice ${request.type}`);
      step = steps.next();
    }
    if (game.winner !== 'blue') throw new Error('Declining diagnostic attack must cause immediate loss');
    game.assertCardLocations();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  verifyDiagnosticDecline();
  console.log(JSON.stringify(diagnosticCases(process.argv.includes('--baseline'))));
}
