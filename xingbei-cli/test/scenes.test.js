import test from "node:test";
import assert from "node:assert/strict";
import { createScene, sceneNames } from "../web/scenes.js";

test("每个开发场景保持150张实际牌实例且可重复重置", () => {
  for (const id of Object.keys(sceneNames)) {
    const game = createScene(id);
    const cards = [...game.deck, ...game.discard, ...game.players.flatMap(player => [...player.hand, ...player.poisons, ...[player.shield, player.weakness].filter(Boolean)])];
    assert.equal(cards.length, 150, id);
    assert.equal(new Set(cards.map(card => card.id)).size, 150, id);
    assert.equal(JSON.stringify(game), JSON.stringify(createScene(id)), id);
  }
});
