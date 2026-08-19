import test from 'node:test';
import assert from 'node:assert/strict';
import { compileController } from './physics.js';
import { simulateRapierTuning } from './rapierTuning.js';
import {
  buildGuidedController,
  gainsForGuidedStep,
  GUIDED_CONTROLLER_GAINS,
  GUIDED_CONTROLLER_STEPS
} from './guidedController.js';

test('No code mode builds valid JavaScript and Python at every step', () => {
  for (const language of ['javascript', 'python']) {
    for (let step = 0; step <= GUIDED_CONTROLLER_STEPS.length; step += 1) {
      assert.equal(typeof compileController(language, buildGuidedController(language, step)), 'function');
    }
  }
});

test('No code mode introduces P, D, and I in a stable tuning order', () => {
  assert.deepEqual(gainsForGuidedStep(0), { kp: 0, ki: 0, kd: 0 });
  assert.deepEqual(gainsForGuidedStep(1), { kp: GUIDED_CONTROLLER_GAINS.kp, ki: 0, kd: 0 });
  assert.deepEqual(gainsForGuidedStep(2), { kp: GUIDED_CONTROLLER_GAINS.kp, ki: 0, kd: GUIDED_CONTROLLER_GAINS.kd });
  assert.deepEqual(gainsForGuidedStep(4), GUIDED_CONTROLLER_GAINS);
  assert.match(buildGuidedController('javascript', 1), /proportional/);
  assert.doesNotMatch(buildGuidedController('javascript', 1), /integral/);
  assert.match(buildGuidedController('javascript', 2), /derivative/);
  assert.doesNotMatch(buildGuidedController('javascript', 2), /integral/);
  assert.match(buildGuidedController('javascript', 3), /integral/);
  assert.match(buildGuidedController('javascript', 4), /Math\.max\(-2\.5/);
});

test('each control behavior improves the guided Easy response', async () => {
  const runs = [];
  for (const step of [1, 2, 3]) {
    const gains = gainsForGuidedStep(step);
    const controller = compileController('javascript', buildGuidedController('javascript', step));
    runs.push(await simulateRapierTuning(controller, 'easy', gains));
  }
  assert.ok(runs[1].score > runs[0].score, `D should improve ${runs[0].score} to ${runs[1].score}`);
  assert.ok(runs[2].score > runs[1].score, `I should improve ${runs[1].score} to ${runs[2].score}`);
  assert.ok(runs[2].steadyError < runs[1].steadyError, `I should reduce ${runs[1].steadyError}° steady error`);
});

test('the completed No code controller can pass the full Code validation path', async () => {
  const controller = compileController('javascript', buildGuidedController('javascript', GUIDED_CONTROLLER_STEPS.length));
  const runs = await Promise.all(['easy', 'medium', 'hard'].map((scenario) => simulateRapierTuning(controller, scenario, GUIDED_CONTROLLER_GAINS)));
  assert.ok(runs.every((run) => run.score >= 58 && run.steadyError < 5), runs.map((run) => `${run.score}/${run.steadyError}`).join(', '));
});
