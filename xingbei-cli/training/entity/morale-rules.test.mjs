import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/engine.js';
import { driveGame } from '../driver.mjs';

test('training synthesis keeps payment and draw, removes cups, and wins on morale; formal fifth cup stays unchanged', () => {
  for (const ruleVariant of ['standard', 'morale-only-v1']) {
    const game = new Game({seed:11, heroRules:false, ruleVariant}).setup();
    for (const card of [...game.player(0).hand]) game.moveCard(card.id, {zone:'discard'});
    game.addStones('red', 'crystal', 3);
    if (ruleVariant === 'standard') game.teams.red.cups = 4;
    game.teams.blue.morale = 2;
    game.synthesize(0, 0);
    assert.equal(game.player(0).hand.length, 3);
    assert.equal(game.stoneCounts('red').total, 0);
    assert.equal(game.teams.red.cups, ruleVariant === 'standard' ? 5 : 0);
    assert.equal(game.teams.blue.morale, ruleVariant === 'standard' ? 2 : 1);
    assert.equal(game.winner, ruleVariant === 'standard' ? 'red' : null);
    if (ruleVariant !== 'standard') {
      assert.equal(game.gainCups('red', 5), 0);
      assert.equal(game.teams.red.cups, 0);
      game.changeMorale('blue', -1);
      assert.equal(game.winner, 'red');
    }
    game.assertCardLocations();
  }
});

test('morale curriculum refuses a replay collected under cup rules', async () => {
  await assert.rejects(driveGame({seed:1,ruleVariant:'morale-only-v1',replay:{config:{ruleVariant:'standard'}}},()=>0), /rule variant mismatch/);
});
