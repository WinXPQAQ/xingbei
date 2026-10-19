// Paired seeds / sides against the previous policy, on the same current rules engine.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Game } from "../src/engine.js";
import * as current from "../src/ai.js";
const seeds = Number(process.argv[2] ?? 100);
const output = resolve(process.argv[3] ?? "xingbei-cli/artifacts/ai/benchmark.json");
const baselineRef = process.argv[4] ?? "a0588bd";
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 10000 || !/^[\da-f]{7,40}$/.test(baselineRef)) throw new Error("Usage: benchmark-ai.mjs [1..10000 seeds] [output.json] [baseline commit hash]");
const source = execFileSync("git", ["show", `${baselineRef}:xingbei-cli/src/ai.js`], { encoding: "utf8" }).replace('"./resolution/decisions.js"', JSON.stringify(new URL("../src/resolution/decisions.js", import.meta.url).href));
const baseline = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const results = [];
for (let seed = 1; seed <= seeds; seed++) for (const team of ["red", "blue"]) {
  const game = new Game({ seed }).setup();
  const policy = id => game.player(id).team === team ? current : baseline;
  const choose = request => policy(request.playerId ?? request.player?.id).chooseAiRuleDecision(request, game);
  const options = { overflow: player => player.team === team ? "ai" : "random", choose, chooseResponse: request => policy(request.target.id).chooseAiResponse(game, request) };
  let turns = 0, maxDecisionMs = 0, baselineRetries = 0;
  while (!game.winner && turns++ < 500) {
    const id = game.current;
    const turn = await game.beginTurn(id, { choose, chooseWeakness: request => policy(id) === current ? current.chooseAiRuleDecision(request, game) : "skip" }, options);
    if (!turn.skipped && !game.winner) {
      let actions = 0;
      do {
        if (++actions > 20) throw new Error(`Seed ${seed}: too many actions`);
        const started = performance.now();
        let action = policy(id).chooseAiAction(game, id);
        maxDecisionMs = Math.max(maxDecisionMs, performance.now() - started);
        for (let retry = 0; ; retry++) {
          if (action.type === "pass") { game.skipExtraActions(id); break; }
          try { await game.executeAction(id, action, options); break; }
          catch (error) {
            // The old priest can spend its planned cost during activation. Let it
            // reselect as a human would, instead of scoring that invalid action as a loss.
            if (policy(id) === current || retry >= 2 || !error.message.includes("启动后")) throw error;
            baselineRetries++; action = baseline.chooseAiAction(game, id);
          }
        }
        game.assertCardLocations();
      } while (game.turn.hasExtraActions() && !game.winner);
    }
    await game.endTurnWithDecisions(options); game.assertCardLocations();
  }
  results.push({ seed, team, winner: game.winner, turns, maxDecisionMs, baselineRetries });
}
const summary = {
  baselineRef, games: results.length, wins: results.filter(result => result.winner === result.team).length,
  unfinished: results.filter(result => !result.winner).length,
  byTeam: Object.fromEntries(["red", "blue"].map(team => [team, results.filter(result => result.team === team && result.winner === team).length])),
  maxTurns: Math.max(...results.map(result => result.turns)), maxDecisionMs: Math.max(...results.map(result => result.maxDecisionMs)),
  baselineRetries: results.reduce((sum, result) => sum + result.baselineRetries, 0),
};
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
