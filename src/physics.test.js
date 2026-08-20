import test from 'node:test';
import assert from 'node:assert/strict';
import {
  builtInController,
  compileController,
  defaultCode,
  mergeFlightInputs,
  readFlightInputs
} from './physics.js';
import { simulateRapierTuning } from './rapierTuning.js';
import {
  AIRFRAME_TRIM_TORQUE,
  ATTITUDE_TORQUE_PER_COMMAND,
  createMotorThrusts,
  MAX_FLIGHT_TILT_DEGREES,
  motorBodyTorque,
  stepMotorModel,
  YAW_TORQUE_PER_COMMAND
} from './dronePhysics.js';
import {
  CODE_SCENARIOS,
  isCodeScenarioUnlocked,
  nextCodeScenarioId,
  SCENARIOS,
  TUNE_CHECK_SCENARIOS,
  targetDegreesForScenario
} from './scenarios.js';

const starterGains = { kp: 1, ki: 0, kd: 0 };
const exampleLearnerGains = { kp: 2.5, ki: 0.1, kd: 1 };

test('starter is deliberately a P-only controller', () => {
  const controller = compileController('javascript', defaultCode.javascript);
  const pOnly = controller(0.2, 1 / 60, { integral: 4, previousError: 10 }, starterGains);
  const ignoredID = controller(0.2, 1 / 60, { integral: 4, previousError: 10 }, { kp: 1, ki: 6, kd: 6 });
  assert.equal(pOnly, ignoredID);
  assert.equal(pOnly, 0.2);
});

test('Code Lab JavaScript and Python starters use the same Rapier loop', async () => {
  const javascript = await simulateRapierTuning(compileController('javascript', defaultCode.javascript), 'easy', starterGains);
  const python = await simulateRapierTuning(compileController('python', defaultCode.python), 'easy', starterGains);
  assert.equal(python.score, javascript.score);
  assert.equal(python.rms, javascript.rms);
  assert.equal(javascript.points.length, 481);
  assert.ok(Math.abs(javascript.points.at(-1).target - 10) < 1e-10);
  assert.ok(javascript.score < 58, 'the starter should require the learner to add I and D');
});

test('Code has three staged angles and Tune adds the broader flight cases', () => {
  assert.deepEqual(CODE_SCENARIOS.map((scenario) => scenario.id), ['easy', 'medium', 'hard']);
  assert.deepEqual(SCENARIOS.map((scenario) => scenario.id), ['easy', 'medium', 'hard', 'switchback', 'envelope', 'yaw', 'gust', 'payload']);
  assert.deepEqual([0, 0.8, 4, 8].map((time) => targetDegreesForScenario('easy', time)), [0, 10, 10, 10]);
  assert.equal(targetDegreesForScenario('medium', 4), 20);
  assert.equal(targetDegreesForScenario('hard', 4), MAX_FLIGHT_TILT_DEGREES);
  assert.deepEqual([0.8, 2.5, 4.1, 5.7, 7].map((time) => targetDegreesForScenario('switchback', time)), [12, -10, 18, -14, 8]);
  const envelope = [0.8, 2.3, 3.7, 5.1, 6.5].map((time) => targetDegreesForScenario('envelope', time));
  assert.deepEqual(envelope, [15, -20, 26, -32, 18]);
  assert.equal(Math.max(...envelope.map(Math.abs)), MAX_FLIGHT_TILT_DEGREES);
});

test('Code validation unlocks Easy, Medium, and Hard in order', () => {
  const nonePassed = { easy: null, medium: null, hard: null };
  const easyPassed = { ...nonePassed, easy: 80 };
  const mediumPassed = { ...easyPassed, medium: 75 };
  const allPassed = { ...mediumPassed, hard: 68 };

  assert.deepEqual(CODE_SCENARIOS.map((scenario) => isCodeScenarioUnlocked(scenario.id, nonePassed)), [true, false, false]);
  assert.deepEqual(CODE_SCENARIOS.map((scenario) => isCodeScenarioUnlocked(scenario.id, easyPassed)), [true, true, false]);
  assert.deepEqual(CODE_SCENARIOS.map((scenario) => isCodeScenarioUnlocked(scenario.id, mediumPassed)), [true, true, true]);
  assert.equal(nextCodeScenarioId(nonePassed), 'easy');
  assert.equal(nextCodeScenarioId(easyPassed), 'medium');
  assert.equal(nextCodeScenarioId(mediumPassed), 'hard');
  assert.equal(nextCodeScenarioId(allPassed), null);
});

test('an unstable airframe remains replayable without blaming a finite controller', async () => {
  const controller = compileController('javascript', defaultCode.javascript);
  const unstable = await simulateRapierTuning(controller, 'envelope', starterGains);
  const invalidController = await simulateRapierTuning(() => Number.NaN, 'easy', starterGains);
  assert.equal(unstable.invalidOutput, false);
  assert.equal(unstable.physicsDiverged, true);
  assert.equal(unstable.points.length, 481);
  assert.equal(invalidController.invalidOutput, true);
});

test('a learner-built simple PID can pass every Rapier scenario', async () => {
  const codeRun = await simulateRapierTuning(builtInController(exampleLearnerGains), 'hard', exampleLearnerGains);
  const runs = await Promise.all(
    ['step', 'yaw', 'gust', 'payload'].map((scenario) => simulateRapierTuning(builtInController(exampleLearnerGains), scenario, exampleLearnerGains))
  );
  const scores = runs.map((run) => run.score);
  const combined = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  assert.ok(codeRun.score >= 58);
  assert.equal(runs[0].points.at(-1).target, MAX_FLIGHT_TILT_DEGREES);
  assert.ok(Math.min(...scores) >= 60, `expected every learner scenario >= 60, received ${scores.join(', ')}`);
  assert.ok(combined >= 75, `expected learner tune >= 75, received ${scores.join(', ')}`);
});

test('integral control improves persistent trim error after P and D are established', async () => {
  const pdGains = { ...exampleLearnerGains, ki: 0 };
  const pdRuns = await Promise.all(TUNE_CHECK_SCENARIOS.map((scenario) => simulateRapierTuning(builtInController(pdGains), scenario, pdGains)));
  const pidRuns = await Promise.all(TUNE_CHECK_SCENARIOS.map((scenario) => simulateRapierTuning(builtInController(exampleLearnerGains), scenario, exampleLearnerGains)));
  const pdCombined = pdRuns.reduce((sum, run) => sum + run.score, 0) / pdRuns.length;
  const pidCombined = pidRuns.reduce((sum, run) => sum + run.score, 0) / pidRuns.length;

  assert.ok(pidRuns.every((run, index) => run.steadyError < pdRuns[index].steadyError));
  assert.ok(pidCombined > pdCombined, `expected I to improve ${pdCombined} to ${pidCombined}`);
});

test('pre-flight motor trim cancels the persistent airframe torque', () => {
  const motors = createMotorThrusts();
  stepMotorModel({
    motors,
    pitchOutput: 0,
    rollOutput: -AIRFRAME_TRIM_TORQUE.roll / ATTITUDE_TORQUE_PER_COMMAND,
    yawOutput: -AIRFRAME_TRIM_TORQUE.yaw / YAW_TORQUE_PER_COMMAND,
    altitudeOutput: 0,
    bodyUpY: 1,
    delta: 1
  });
  const torque = motorBodyTorque(motors);
  assert.ok(Math.abs(torque.z + AIRFRAME_TRIM_TORQUE.roll) < 1e-8);
  assert.ok(Math.abs(torque.y + AIRFRAME_TRIM_TORQUE.yaw) < 1e-8);
});

test('invalid Python syntax produces a useful validation error', () => {
  assert.throws(
    () => compileController('python', 'def pid(error, dt, state):\n    for item in state:\n        return item'),
    /does not support/
  );
});

test('lateral and yaw controls follow chase-camera screen space', () => {
  assert.deepEqual(readFlightInputs(new Set(['KeyD', 'ArrowRight'])), {
    forwardInput: 0,
    rightInput: 1,
    upInput: 0,
    yawInput: -1
  });
  assert.deepEqual(readFlightInputs(new Set(['KeyA', 'ArrowLeft'])), {
    forwardInput: 0,
    rightInput: -1,
    upInput: 0,
    yawInput: 1
  });
});

test('touch and keyboard flight inputs combine without exceeding the control envelope', () => {
  const keyboard = readFlightInputs(new Set(['KeyW', 'ArrowLeft']));
  assert.deepEqual(mergeFlightInputs(keyboard, {
    forwardInput: 0.7,
    rightInput: -0.45,
    upInput: 0.25,
    yawInput: -0.4
  }), {
    forwardInput: 1,
    rightInput: -0.45,
    upInput: 0.25,
    yawInput: 0.6
  });
});
