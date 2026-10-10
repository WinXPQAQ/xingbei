import test from "node:test";
import assert from "node:assert/strict";
import { askIndex } from "../src/tui.js";

test("非法选择会提示并重复询问，而不会抛出错误", async () => {
  const answers = ["99", "abc", "2"];
  const messages = [];
  const ui = {
    async question() { return answers.shift(); },
    console(message) { messages.push(message); },
  };
  const selected = await askIndex(ui, "应战> ", [0, 2]);
  assert.equal(selected, 2);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.startsWith("输入无效")));
});
