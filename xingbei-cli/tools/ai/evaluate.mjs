import { Game, Timing } from '../../src/engine.js';
import { getPolicy } from '../../src/ai/versions.js';

export const lineups = Object.freeze({
  assault: ['berserker', 'windSwordmaster', 'marksman'],
  spell: ['marksman', 'sealer', 'priest'],
  support: ['sealer', 'guardianAngel', 'priest'],
  mixed: ['berserker', 'guardianAngel', 'priest'],
  tempo: ['windSwordmaster', 'sealer', 'guardianAngel'],
  pressure: ['windSwordmaster', 'marksman', 'priest'],
});
export function mirrorRoster(heroes, rotation = 0) {
  const [a,b,c] = heroes.map((_, i) => heroes[(i + rotation) % 3]);
  return [a,a,b,b,c,c];
}
export function schedule({ firstSeed, seeds, selected = Object.keys(lineups) }) {
  return selected.flatMap(lineup => Array.from({ length: seeds }, (_, i) => firstSeed + i).flatMap(seed =>
    [0,1].flatMap(start => ['red','blue'].map(team => ({ lineup, seed, start, team })))));
}
const emptyMetrics = () => ({ attacks: 0, hits: 0, damage: 0, attackDamage: 0, spellDamage: 0, moraleLost: 0, gems: 0, crystals: 0, cups: 0, actions: 0 });
export async function playMatch(config, { candidate = 'read-1', opponent = 'v1.0', turnLimit = 500 } = {}) {
  const { lineup, seed, start, team } = config;
  const heroIds = mirrorRoster(lineups[lineup], seed % 3);
  const game = new Game({ seed, heroIds }).setup();
  game.current = start;
  const policies = { red: getPolicy(team === 'red' ? candidate : opponent), blue: getPolicy(team === 'blue' ? candidate : opponent) };
  const metrics = { red: emptyMetrics(), blue: emptyMetrics() };
  const initial = game.players.map(p => ({ id: p.id, hero: p.hero.id, team: p.team, cards: p.hand.map(c => c.id) }));
  const policy = id => policies[game.player(id).team];
  const options = {
    overflow: (player, excess) => policy(player.id).chooseAiDiscard(game, player.id, excess),
    choose: request => decide(request),
    chooseResponse: request => policy(request.target.id).chooseAiResponse(game, request),
    resolveOverflow: request => game.resolveOverflowWithDecisions(request.player.id,
      policy(request.player.id).chooseAiDiscard(game, request.player.id, request.player.hand.length - request.player.handLimit), options),
  };
  function decide(request) {
    if (request.type === 'response') return options.chooseResponse(request);
    if (request.type === 'overflow') return options.resolveOverflow(request);
    const id = request.playerId ?? request.player?.id;
    if (id == null) throw new Error(`Unrouted decision: ${request.type}`);
    return policy(id).chooseAiRuleDecision(request, game);
  }
  // All synchronous nested choices (e.g. draw overflow / angel shelter) are routed
  // too. Never fall back to the production AI imported by Game.
  game.automaticDecision = request => decide(request);
  const trigger = game.trigger;
  game.trigger = function* (timing, context, options) {
    yield* trigger.call(this, timing, context, options);
    if (timing === Timing.ATTACK_DECLARED) metrics[this.player(context.actorId).team].attacks++;
    if (timing === Timing.ATTACK_HIT) metrics[this.player(context.actorId).team].hits++;
    if (timing === Timing.DAMAGE_ACTUAL && context.sourceId != null) {
      const m = metrics[this.player(context.sourceId).team];
      // Friendly/self damage is negative utility, not offensive credit.
      const sign = this.player(context.sourceId).team === this.player(context.targetId).team ? -1 : 1;
      m.damage += sign * context.actual;
      m[context.damageType === 'spell' ? 'spellDamage' : 'attackDamage'] += sign * context.actual;
    }
  };
  const changeMorale = game.changeMorale;
  game.changeMorale = function (side, amount) { const before = this.teams[side].morale; const result = changeMorale.call(this, side, amount); metrics[side].moraleLost += Math.max(0, before - this.teams[side].morale); return result; };
  const addStones = game.addStones;
  game.addStones = function (side, kind, count) { const result = addStones.call(this, side, kind, count); metrics[side][kind === 'gem' ? 'gems' : 'crystals'] += result; return result; };
  let turns = 0;
  const started = performance.now();
  while (!game.winner && turns < turnLimit) {
    turns++;
    const id = game.current;
    const turn = await game.beginTurn(id, { choose: options.choose, chooseWeakness: options.choose, resolveOverflow: options.resolveOverflow }, options);
    if (!turn.skipped && !game.winner) {
      let actions = 0;
      do {
        if (++actions > 20) throw new Error(`Action limit: ${JSON.stringify(config)}`);
        const action = policy(id).chooseAiAction(game, id);
        metrics[game.player(id).team].actions++;
        if (action.type === 'pass') { if (game.turn.hasExtraActions()) game.skipExtraActions(id); break; }
        await game.executeAction(id, action, options);
        game.assertCardLocations();
      } while (game.turn.hasExtraActions() && !game.winner);
    }
    await game.endTurnWithDecisions(options);
    game.assertCardLocations();
  }
  for (const side of ['red','blue']) metrics[side].cups = game.teams[side].cups;
  const other = team === 'red' ? 'blue' : 'red';
  return { ...config, heroIds, winner: game.winner, outcome: !game.winner ? 'truncated' : game.winner === team ? 'win' : 'loss', turns,
    elapsedMs: performance.now() - started, metrics: { candidate: metrics[team], opponent: metrics[other] }, initial };
}

export function summary(results) {
  const wins = results.filter(r => r.outcome === 'win').length, losses = results.filter(r => r.outcome === 'loss').length;
  const truncated = results.length - wins - losses;
  const score = r => r.outcome === 'win' ? 1 : r.outcome === 'loss' ? 0 : 0.5;
  // Cluster by seed across ALL lineups, colors and starts. Paired games are not
  // independent Bernoulli trials; deterministic bootstrap resamples whole seeds.
  const clusters = new Map();
  for (const r of results) { if (!clusters.has(r.seed)) clusters.set(r.seed, []); clusters.get(r.seed).push(score(r)); }
  const values = [...clusters.values()].map(xs => xs.reduce((a,b) => a+b,0)/xs.length);
  let rng = 918273;
  const rand = () => ((rng = (Math.imul(rng,1664525)+1013904223)>>>0)/2**32);
  const estimates = [];
  for (let i=0; i<4000; i++) { let sum=0; for (let j=0;j<values.length;j++) sum += values[Math.floor(rand()*values.length)]; estimates.push(sum/values.length); }
  estimates.sort((a,b)=>a-b);
  const metrics = {};
  for (const side of ['candidate','opponent']) {
    const sums = emptyMetrics();
    for (const r of results) for (const key of Object.keys(sums)) sums[key] += r.metrics[side][key];
    metrics[side] = { totals: sums, hitRate: sums.hits / Math.max(1,sums.attacks), perGame: Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,v/results.length])) };
  }
  return { games: results.length, seeds: values.length, wins, losses, draws: 0, truncated,
    scoreRate: (wins+truncated*0.5)/results.length, winRate: wins/results.length,
    clusterBootstrap95: [estimates[100],estimates[3899]], metrics };
}
