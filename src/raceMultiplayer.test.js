import test from 'node:test';
import assert from 'node:assert/strict';
import { safeGhostPose } from './raceMultiplayer.js';

test('ghost poses are finite and quaternions are normalized for rendering', () => {
  assert.deepEqual(safeGhostPose({ p: [1, 2, 3], q: [0, 0, 0, 2] }), {
    p: [1, 2, 3],
    q: [0, 0, 0, 1]
  });
  assert.equal(safeGhostPose({ p: [1, Number.NaN, 3], q: [0, 0, 0, 1] }), null);
  assert.equal(safeGhostPose({ p: [1, 2, 3], q: [0, 0, 0, 0] }), null);
});
