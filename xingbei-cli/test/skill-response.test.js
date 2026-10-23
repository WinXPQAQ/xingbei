import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine.js";
import { chooseAiResponse, chooseAiRuleDecision } from "../src/ai.js";

function fixture({ healing = 0, shield = false } = {}) {
  const game = new Game({
    shuffleDeck: false,
    heroIds: ["elementalist", "none", "none", "none", "none", "magicalGirl"],
  });
  const take = (id, predicate) => {
    const c = game.deck.find(predicate);
    assert.ok(c);
    game.moveCard(c.id, { zone: "hand", playerId: id });
    return c;
  };
  const light = take(0, (c) => c.name === "holyLight");
  while (game.player(0).hand.length < 6)
    take(0, (c) => c.type === "attack" && c.element === "water");
  const fire = take(5, (c) => c.type === "attack" && c.element === "fire");
  const magic = take(5, (c) => c.name === "magicBullet");
  game.player(0).healing = healing;
  if (shield) {
    const card = game.deck.find((c) => c.name === "holyShield");
    game.attachCard(card.id, 0, { effectId: "holyShield" });
  }
  game.onDecision = (request) => chooseAiRuleDecision(request, game);
  return { game, light, fire, magic };
}

test("异步魔弹与融合技能共用响应：满手无足额治疗的元素师使用圣光且不损士气", async () => {
  for (const fusion of [false, true])
    for (const healing of [0, 1]) {
      const { game, light, fire, magic } = fixture({ healing });
      let requests = 0;
      const action = fusion
        ? {
            type: "skill",
            skillId: "magicFusion",
            cardIds: [fire.id],
            targetIds: [0],
          }
        : {
            type: "play",
            index: game.player(5).hand.indexOf(magic),
            targetId: 0,
          };
      await game.executeAction(5, action, {
        chooseResponse: async (request) => {
          requests++;
          assert.equal(request.target.id, 0);
          assert.equal(request.attack, undefined);
          assert.equal(request.damage, 2);
          assert.ok(request.valid.some((e) => e.card.id === light.id));
          const decision = chooseAiResponse(game, request);
          assert.equal(decision.index, 0);
          return decision;
        },
      });
      assert.equal(requests, 1);
      assert.equal(game.teams.red.morale, 15);
      assert.equal(light.location.zone, "discard");
      assert.equal(game.player(0).hand.length, 5);
      assert.equal(game.player(0).healing, healing);
      assert.equal(game.field.length, 0);
      game.assertCardLocations();
    }
});

test("融合魔弹响应等待期间不推进；明确不响应后圣盾和治疗仍正常防御", async () => {
  const { game, light, fire } = fixture();
  let respond, entered;
  const atResponse = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = game.executeAction(
    5,
    {
      type: "skill",
      skillId: "magicFusion",
      cardIds: [fire.id],
      targetIds: [0],
    },
    {
      chooseResponse: (request) =>
        new Promise((resolve) => {
          respond = resolve;
          entered(request);
        }),
    },
  );
  const request = await atResponse;
  assert.equal(fire.location.zone, "field");
  assert.equal(light.location.zone, "hand");
  assert.equal(game.player(0).hand.length, 6);
  assert.equal(game.teams.red.morale, 15);
  respond(chooseAiResponse(game, request));
  await pending;
  assert.equal(light.location.zone, "discard");
  for (const config of [{ healing: 2 }, { shield: true }]) {
    const f = fixture(config);
    let calls = 0;
    await f.game.executeAction(
      5,
      {
        type: "skill",
        skillId: "magicFusion",
        cardIds: [f.fire.id],
        targetIds: [0],
      },
      {
        chooseResponse: (request) => {
          calls++;
          return null;
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(f.light.location.zone, "hand");
    assert.equal(f.game.player(0).hand.length, 6);
    assert.equal(f.game.teams.red.morale, 15);
    if (config.healing) assert.equal(f.game.player(0).healing, 0);
    if (config.shield)
      assert.equal(f.game.player(0).getStatus("holyShield").length, 0);
    f.game.assertCardLocations();
  }
});
