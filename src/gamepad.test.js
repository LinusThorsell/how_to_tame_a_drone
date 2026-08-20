import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAxisDeadzone,
  applyRadialDeadzone,
  findFlightGamepad,
  gamepadButtonPressed,
  readGamepadInputs,
  resolveGamepadStickAxes
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

test('non-standard six-axis wireless controllers skip analog trigger axes', () => {
  const wireless = gamepad({
    id: 'Wireless Bluetooth Gamepad',
    mapping: '',
    axes: [0.4, -0.6, -1, -0.7, 0.5, -1]
  });
  assert.deepEqual(resolveGamepadStickAxes(wireless), {
    leftX: 0,
    leftY: 1,
    rightX: 3,
    rightY: 4
  });
  const inputs = readGamepadInputs([wireless]);
  assert.ok(inputs.yawInput < 0);
  assert.ok(inputs.upInput > 0);
  assert.ok(inputs.rightInput < 0);
  assert.ok(inputs.forwardInput < 0);
});

test('wireless raw-axis layout stays stable when a trigger moves', () => {
  const wireless = gamepad({ mapping: '', axes: [0, 0, -1, 0, 0, -1] });
  resolveGamepadStickAxes(wireless);
  wireless.axes = [0, 0, 0.5, 0.6, -0.4, -1];
  assert.deepEqual(resolveGamepadStickAxes(wireless), {
    leftX: 0,
    leftY: 1,
    rightX: 3,
    rightY: 4
  });
});

test('alternate six-axis wireless layout keeps split right-stick axes together', () => {
  const wireless = gamepad({ mapping: '', axes: [0, 0, 0.5, -1, -1, -0.6] });
  assert.deepEqual(resolveGamepadStickAxes(wireless), {
    leftX: 0,
    leftY: 1,
    rightX: 2,
    rightY: 5
  });
});

test('known raw Xbox-style wireless IDs select the trigger-separated layout', () => {
  const wireless = gamepad({ id: 'Xbox Wireless Controller', mapping: '', axes: [0, 0, 0, 0, 0, 0] });
  assert.deepEqual(resolveGamepadStickAxes(wireless), {
    leftX: 0,
    leftY: 1,
    rightX: 3,
    rightY: 4
  });
});

test('standard mapped controllers are preferred and buttons accept analog values', () => {
  const fallback = gamepad({ id: 'Fallback', mapping: '' });
  const standard = gamepad({ id: 'Standard', index: 1, buttons: [{ pressed: false, value: 0.8 }] });
  assert.equal(findFlightGamepad([fallback, standard]), standard);
  assert.equal(gamepadButtonPressed(standard, 0), true);
  assert.equal(gamepadButtonPressed(standard, 2), false);
});
