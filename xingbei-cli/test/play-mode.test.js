import test from "node:test";
import assert from "node:assert/strict";
import { Session, Cancelled } from "../web/session.js";
import { PlaybackGate } from "../web/play-mode.js";
import { runAiAction } from "../src/ai.js";
import { Game, Timing } from "../src/engine.js";

test("观战暂停独立于动画，恢复释放检查点，重开取消旧等待", async () => {
  const gate = new PlaybackGate(), session = new Session();
  gate.setPaused(true);
  let advanced = false;
  const waiting = gate.wait(session).then(() => { advanced = true; });
  await Promise.resolve(); assert.equal(advanced, false);
  gate.setPaused(false); await waiting; assert.equal(advanced, true);
  gate.setPaused(true);
  const cancelled = assert.rejects(gate.wait(session), Cancelled);
  session.cancel(); await cancelled; assert.equal(gate.waiters.size, 0);
  await new PlaybackGate().wait(new Session());
});

test("测试重复回合完整经过结束和再次开始，不复制牌或复用额外行动", () => {
  const game = new Game({ seed: 13 }).setup();
  game.startTurn(0);
  assert.throws(() => game.turn.repeatLast(0));
  game.turn.state.attackCount = 3; game.turn.state.usedSkills.swordShadow = true;
  game.turn.addAttackAction({ sourceSkillId: "swordShadow" });
  runAiAction(game, 0); game.endTurn();
  assert.equal(game.current, 1); assert.equal(game.timeline.at(-1).timing, Timing.TURN_END);
  assert.throws(() => game.turn.repeatLast(1));
  const cards = [...game.cards.keys()];
  game.turn.repeatLast(0); assert.equal(game.current, 0);
  assert.throws(() => game.turn.repeatLast(0));
  game.startTurn(0);
  assert.equal(game.turn.state.attackCount, 0); assert.deepEqual(game.turn.state.usedSkills, {});
  assert.deepEqual(game.turn.state.pendingActions, []);
  assert.deepEqual([...game.cards.keys()], cards); game.assertCardLocations();
  runAiAction(game, 0); game.endTurn(); assert.equal(game.current, 1);
});
