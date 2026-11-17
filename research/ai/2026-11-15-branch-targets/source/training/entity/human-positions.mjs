// Extract human turn-start positions from recorded games.
// usage: node training/entity/human-positions.mjs HUMAN_GAMES_DIR OUT.jsonl [--hero sage]
// Each row: the state just before the human seat's beginTurn, the game's
// initial config, and the category of the human's first real action that turn.
import fs from 'node:fs';
import path from 'node:path';
import { restoreSnapshot } from './snapshot.mjs';

const [root, output, ...rest] = process.argv.slice(2);
const heroFilter = rest.includes('--hero') ? rest[rest.indexOf('--hero') + 1] : null;

function category(game, seat, event) {
  if (event.name === 'attackWithDecisions') return 'attack';
  if (event.name === 'playMagicWithDecisions') return 'spell';
  if (event.name === 'playWithDecisions') {
    const card = game.player(seat).hand[event.args[1]];
    return card?.type === 'attack' ? 'attack' : card?.type === 'spell' ? 'spell' : null;
  }
  if (event.name === 'executeAction') {
    const action = event.args[1] ?? {};
    if (['refine', 'purchase', 'synthesize'].includes(action.type)) return action.type;
    if (action.type === 'skill') return 'heroSkill';
    if (action.type === 'play') {
      const card = game.player(seat).hand[action.index];
      return card?.type === 'attack' ? 'attack' : card?.type === 'spell' ? 'spell' : null;
    }
    if (action.type === 'activate') return 'activate';
  }
  return null;
}

const rows = [], report = [];
for (const name of fs.readdirSync(root).sort()) {
  const folder = path.join(root, name), metaPath = path.join(folder, 'metadata.json');
  if (!fs.existsSync(metaPath)) continue;
  const meta = JSON.parse(fs.readFileSync(metaPath));
  const cfg = meta.configuration, config = cfg.initialConfig, seat = cfg.humanSeat;
  if (cfg.mode !== 'normal' || !Number.isInteger(seat)) continue;
  if (heroFilter && config.heroIds[seat] !== heroFilter) continue;
  const summary = JSON.parse(fs.readFileSync(path.join(folder, 'summary.json')));
  const events = fs.readdirSync(folder).filter(n => /^\d+\.json$/.test(n)).sort()
    .map(n => JSON.parse(fs.readFileSync(path.join(folder, n))));
  const counts = { turns: 0, accepted: 0, noAction: 0, restoreFailed: 0 };
  for (let i = 0; i < events.length; i++) {
    const e = events[i].event;
    if (!(e.type === 'command' && e.name === 'beginTurn' && (e.depth ?? 0) === 0 && e.args[0] === seat)) continue;
    counts.turns++;
    let first = null;
    for (let j = i + 1; j < events.length; j++) {
      const f = events[j].event;
      if (f.type === 'command' && (f.depth ?? 0) === 0 && f.name === 'endTurnWithDecisions') break;
      if (f.type === 'command' && (f.depth ?? 0) === 0 && f.args?.[0] === seat &&
          ['attackWithDecisions', 'playWithDecisions', 'playMagicWithDecisions', 'executeAction'].includes(f.name)) {
        let game;
        try { game = restoreSnapshot(config, f.state); } catch { game = null; }
        const kind = game ? category(game, seat, f) : null;
        if (kind && kind !== 'activate') { first = { kind, sequence: events[j].sequence }; break; }
      }
    }
    if (!first) { counts.noAction++; continue; }
    try { restoreSnapshot(config, e.state); } catch { counts.restoreFailed++; continue; }
    rows.push({ gameId: name, seat, hero: config.heroIds[seat], sequence: events[i].sequence, config, state: e.state,
                human: first.kind, actionSequence: first.sequence, winner: summary.winner ?? null,
                humanTeam: config.teams[seat], ruleRevision: meta.ruleRevision });
    counts.accepted++;
  }
  report.push({ gameId: name, hero: config.heroIds[seat], status: summary.status, ...counts });
}
fs.writeFileSync(output, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ positions: rows.length, games: report }, null, 1));
