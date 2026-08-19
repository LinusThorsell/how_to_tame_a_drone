import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distanceToFirstGate,
  formatRaceTime,
  gatesForMode,
  isGateCleared,
  RACE_GATES,
  TRAINING_GATES
} from './flightCourse.js';

test('the challenge course is longer and always advances down range', () => {
  assert.equal(TRAINING_GATES.length, 3);
  assert.ok(RACE_GATES.length >= 10);
  assert.ok(RACE_GATES.every((gate, index) => index === 0 || gate.z > RACE_GATES[index - 1].z));
  assert.equal(gatesForMode('race'), RACE_GATES);
  assert.equal(gatesForMode('training'), TRAINING_GATES);
  assert.ok(distanceToFirstGate('race') > 0);
});

test('race time uses a stable minute, second, and tenth display', () => {
  assert.equal(formatRaceTime(0), '00:00.0');
  assert.equal(formatRaceTime(9.24), '00:09.2');
  assert.equal(formatRaceTime(75.67), '01:15.7');
});

test('race gates have a tighter, rotation-aware pass window', () => {
  const trainingGate = TRAINING_GATES[0];
  assert.equal(isGateCleared(trainingGate, trainingGate, 'training'), true);
  assert.equal(isGateCleared({ ...trainingGate, x: trainingGate.x + 3.2 }, trainingGate, 'training'), false);

  const raceGate = RACE_GATES[1];
  const inside = 1.7;
  const outside = 1.9;
  assert.equal(isGateCleared({
    ...raceGate,
    x: raceGate.x + Math.cos(raceGate.yaw) * inside,
    z: raceGate.z - Math.sin(raceGate.yaw) * inside
  }, raceGate, 'race'), true);
  assert.equal(isGateCleared({
    ...raceGate,
    x: raceGate.x + Math.cos(raceGate.yaw) * outside,
    z: raceGate.z - Math.sin(raceGate.yaw) * outside
  }, raceGate, 'race'), false);
});
