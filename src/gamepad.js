import { clamp } from './physics.js';

export const GAMEPAD_DEADZONE = 0.16;
export const GAMEPAD_AXIS_DEADZONE = 0.05;
export const GAMEPAD_BUTTONS = Object.freeze({
  primary: 0,
  flightMode: 3,
  reset: 9
});

function availableGamepads(gamepads) {
  if (gamepads) return Array.from(gamepads).filter(Boolean);
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return Array.from(navigator.getGamepads()).filter(Boolean);
}

export function findFlightGamepad(gamepads) {
  const compatible = availableGamepads(gamepads).filter((gamepad) => (
    gamepad.connected !== false && gamepad.axes?.length >= 4
  ));
  return compatible.find((gamepad) => gamepad.mapping === 'standard') || compatible[0] || null;
}

export function applyRadialDeadzone(x, y, deadzone = GAMEPAD_DEADZONE) {
  const safeX = clamp(Number(x) || 0, -1, 1);
  const safeY = clamp(Number(y) || 0, -1, 1);
  const magnitude = Math.hypot(safeX, safeY);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const normalizedMagnitude = (Math.min(magnitude, 1) - deadzone) / (1 - deadzone);
  const scale = normalizedMagnitude / magnitude;
  return { x: safeX * scale, y: safeY * scale };
}

export function applyAxisDeadzone(value, deadzone = GAMEPAD_AXIS_DEADZONE) {
  const safeValue = clamp(Number(value) || 0, -1, 1);
  const magnitude = Math.abs(safeValue);
  if (magnitude <= deadzone) return 0;
  return Math.sign(safeValue) * (magnitude - deadzone) / (1 - deadzone);
}

export function readGamepadInputs(gamepads) {
  const gamepad = findFlightGamepad(gamepads);
  if (!gamepad) return { forwardInput: 0, rightInput: 0, upInput: 0, yawInput: 0 };
  const radialLeft = applyRadialDeadzone(gamepad.axes[0], gamepad.axes[1]);
  const radialRight = applyRadialDeadzone(gamepad.axes[2], gamepad.axes[3]);
  const left = { x: applyAxisDeadzone(radialLeft.x), y: applyAxisDeadzone(radialLeft.y) };
  const right = { x: applyAxisDeadzone(radialRight.x), y: applyAxisDeadzone(radialRight.y) };
  return {
    forwardInput: right.y === 0 ? 0 : -right.y,
    rightInput: right.x,
    upInput: left.y === 0 ? 0 : -left.y,
    yawInput: left.x === 0 ? 0 : -left.x
  };
}

export function gamepadButtonPressed(gamepad, index) {
  const button = gamepad?.buttons?.[index];
  return Boolean(button && (button.pressed || button.value > 0.5));
}

export function gamepadLabel(gamepad) {
  const cleaned = String(gamepad?.id || '')
    .replace(/\s*\([^)]*(?:vendor|product|standard gamepad)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || `Gamepad ${Number(gamepad?.index ?? 0) + 1}`).slice(0, 32);
}
