import test from "node:test";
import assert from "node:assert/strict";
import { Session, Cancelled } from "../web/session.js";

test("重置取消所有未完成选择并清理监听器", async () => {
  const session = new Session();
  let cleaned = 0;
  const waits = [session.wait(() => () => cleaned++), session.delay(10000)];
  session.cancel();
  const results = await Promise.allSettled(waits);
  assert.equal(cleaned, 1);
  assert.ok(results.every(result => result.status === "rejected" && result.reason instanceof Cancelled));
  assert.equal(session.pending.size, 0);
});

test("已选中后立即重置，不让旧选择进入新局", async () => {
  const session = new Session();
  let choose;
  const result = session.wait(resolve => { choose = resolve; });
  choose(2);
  session.cancel();
  await assert.rejects(result, Cancelled);
});

test("同一个选择只提交一次，完成后解除等待", async () => {
  const session = new Session();
  let choose, cleaned = 0;
  const result = session.wait(resolve => { choose = resolve; return () => cleaned++; });
  choose(1); choose(2);
  assert.equal(await result, 1);
  assert.equal(cleaned, 1);
  assert.equal(session.pending.size, 0);
});
