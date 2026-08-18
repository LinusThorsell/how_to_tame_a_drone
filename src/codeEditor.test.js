import test from 'node:test';
import assert from 'node:assert/strict';
import { getControllerDiagnostics } from './codeEditor.js';
import { defaultCode } from './physics.js';

test('CodeMirror lint accepts both starter controllers', () => {
  assert.deepEqual(getControllerDiagnostics('javascript', defaultCode.javascript), []);
  assert.deepEqual(getControllerDiagnostics('python', defaultCode.python), []);
});

test('CodeMirror language parsers report syntax errors', () => {
  const javascript = getControllerDiagnostics('javascript', 'function pid(error) {\n  return error;');
  const python = getControllerDiagnostics('python', 'def pid(error, dt, state, gains)\n    return error');
  assert.ok(javascript.some((item) => item.severity === 'error' && /JavaScript syntax/.test(item.message)));
  assert.ok(python.some((item) => item.severity === 'error' && /Python syntax/.test(item.message)));
});

test('flight compiler restrictions and PID safety checks appear as diagnostics', () => {
  const unsupported = getControllerDiagnostics('python', 'def pid(error, dt, state, gains):\n    for item in state:\n        return item');
  const unclamped = getControllerDiagnostics('javascript', 'function pid(error, dt, state, gains) {\n  state.integral += error * dt;\n  return state.integral;\n}');
  assert.ok(unsupported.some((item) => item.severity === 'error' && /does not support/.test(item.message)));
  assert.ok(unclamped.some((item) => item.severity === 'warning' && /anti-windup/.test(item.message)));
  assert.ok(unclamped.some((item) => item.severity === 'warning' && /Clamp the returned/.test(item.message)));
});
