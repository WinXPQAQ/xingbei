import test from 'node:test';
import assert from 'node:assert/strict';
import { teacherIndex } from './teacher.mjs';
import { driveGame } from './driver.mjs';

test('explicit v1.5/v1.4 teachers complete six-hero games using represented legal choices', async () => {
  for (const version of ['v1.5', 'v1.4']) for (let index = 0; index < 6; index++) {
    const result = await driveGame({ seed: 210000090 + index, start: index }, input => teacherIndex(input, version));
    assert.equal(result.terminated, true);
    assert.equal(result.truncated, false);
  }
});
