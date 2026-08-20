import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAxisDeadzone,
  applyRadialDeadzone,
  findFlightGamepad,
  gamepadButtonPressed,
  readGamepadInputs
} from './gamepad.js';

const gamepad = (overrides = {}) => ({
  id: 'Test controller',
  index: 0,
  connected: true,
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: [],
  ...overrides
});

test('radial deadzone removes drift and preserves full stick range', () => {
  assert.deepEqual(applyRadialDeadzone(0.14, -0.05), { x: 0, y: 0 });
  assert.deepEqual(applyRadialDeadzone(1, 0), { x: 1, y: 0 });
  assert.equal(applyAxisDeadzone(0.04), 0);
  assert.equal(applyAxisDeadzone(1), 1);
});

test('per-axis deadzone blocks sideways drift while the other axis is active', () => {
  const inputs = readGamepadInputs([gamepad({ axes: [0, 0, -0.05, -0.75] })]);
  assert.equal(inputs.rightInput, 0);
  assert.ok(inputs.forwardInput > 0.6);
});

test('standard gamepad sticks map to mode-2 drone controls', () => {
  assert.deepEqual(readGamepadInputs([gamepad({ axes: [1, 0, 0, -1] })]), {
    forwardInput: 1,
    rightInput: 0,
    upInput: 0,
    yawInput: -1
  });
});

test('standard mapped controllers are preferred and buttons accept analog values', () => {
  const fallback = gamepad({ id: 'Fallback', mapping: '' });
  const standard = gamepad({ id: 'Standard', index: 1, buttons: [{ pressed: false, value: 0.8 }] });
  assert.equal(findFlightGamepad([fallback, standard]), standard);
  assert.equal(gamepadButtonPressed(standard, 0), true);
  assert.equal(gamepadButtonPressed(standard, 2), false);
});
