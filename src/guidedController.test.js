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

test('No code mode introduces P, I, and D progressively', () => {
  assert.deepEqual(gainsForGuidedStep(0), { kp: 0, ki: 0, kd: 0 });
  assert.deepEqual(gainsForGuidedStep(1), { kp: GUIDED_CONTROLLER_GAINS.kp, ki: 0, kd: 0 });
  assert.deepEqual(gainsForGuidedStep(2), { kp: GUIDED_CONTROLLER_GAINS.kp, ki: GUIDED_CONTROLLER_GAINS.ki, kd: 0 });
  assert.deepEqual(gainsForGuidedStep(4), GUIDED_CONTROLLER_GAINS);
  assert.match(buildGuidedController('javascript', 1), /proportional/);
  assert.doesNotMatch(buildGuidedController('javascript', 1), /integral/);
  assert.match(buildGuidedController('javascript', 2), /integral/);
  assert.match(buildGuidedController('javascript', 3), /derivative/);
  assert.match(buildGuidedController('javascript', 4), /Math\.max\(-2\.5/);
});

test('the completed No code controller can pass the full Code validation path', async () => {
  const controller = compileController('javascript', buildGuidedController('javascript', GUIDED_CONTROLLER_STEPS.length));
  const runs = await Promise.all(['easy', 'medium', 'hard'].map((scenario) => simulateRapierTuning(controller, scenario, GUIDED_CONTROLLER_GAINS)));
  assert.ok(runs.every((run) => run.score >= 58 && run.steadyError < 5), runs.map((run) => `${run.score}/${run.steadyError}`).join(', '));
});
