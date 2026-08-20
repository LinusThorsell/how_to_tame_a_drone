import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACRO_RATE_PROFILE,
  acroCollectiveFromThrottle,
  acroRateFromStick,
  acroThrottleFromStick,
  createAcroRateMemory,
  stepAcroRateController
} from './acroFlight.js';
import {
  ATTITUDE_TORQUE_PER_COMMAND,
  createMotorThrusts,
  GRAVITY,
  HOVER_THRUST,
  INERTIA,
  MASS,
  MAX_MOTOR_THRUST,
  stepMotorModel
} from './dronePhysics.js';
import { deg, rad } from './physics.js';

test('acro rates are centered, symmetric, and reach the configured full-stick rate', () => {
  assert.equal(acroRateFromStick(0, 'roll'), 0);
  assert.ok(Math.abs(deg(acroRateFromStick(1, 'roll')) - ACRO_RATE_PROFILE.roll.max) < 1e-9);
  assert.ok(Math.abs(deg(acroRateFromStick(-1, 'pitch')) + ACRO_RATE_PROFILE.pitch.max) < 1e-9);
  assert.ok(Math.abs(deg(acroRateFromStick(1, 'yaw')) - ACRO_RATE_PROFILE.yaw.max) < 1e-9);
  assert.ok(deg(acroRateFromStick(0.25, 'roll')) < ACRO_RATE_PROFILE.roll.max * 0.25);
  assert.ok(deg(acroRateFromStick(0.5, 'roll')) < ACRO_RATE_PROFILE.roll.max * 0.17);
  assert.ok(acroRateFromStick(0.5, 'yaw') > acroRateFromStick(0.5, 'roll'));
});

test('acro throttle follows the current stick position with center near hover', () => {
  assert.equal(acroThrottleFromStick(-1), 0);
  assert.equal(acroThrottleFromStick(0), 0.5);
  assert.equal(acroThrottleFromStick(1), 1);
  assert.equal(acroThrottleFromStick(2), 1);

  const hoverThrust = MASS * GRAVITY;
  const hoverThrottle = hoverThrust / (MAX_MOTOR_THRUST * 4);
  const centerStickThrust = acroCollectiveFromThrottle(
    acroThrottleFromStick(0),
    hoverThrottle
  ) * MAX_MOTOR_THRUST * 4;
  assert.ok(Math.abs(centerStickThrust - hoverThrust) < 1e-9);
  assert.equal(acroCollectiveFromThrottle(0, hoverThrottle), 0);
  assert.equal(acroCollectiveFromThrottle(1, hoverThrottle), 1);
});

test('acro rate PID commands the requested direction and brakes at centered stick', () => {
  const memory = createAcroRateMemory();
  const accelerate = stepAcroRateController({ axis: 'roll', stick: 0.5, actualRate: 0, delta: 1 / 60, memory });
  assert.ok(accelerate.targetRate > 0);
  assert.ok(accelerate.output > 0);

  memory.previousRate = 2;
  const brake = stepAcroRateController({ axis: 'roll', stick: 0, actualRate: 2, delta: 1 / 60, memory });
  assert.ok(brake.output < 0);
});

test('large acro commands reset I-term windup', () => {
  const memory = createAcroRateMemory();
  memory.integral = 2;
  stepAcroRateController({ axis: 'pitch', stick: 0.8, actualRate: 0, delta: 1 / 60, memory });
  assert.equal(memory.integral, 0);
});

test('centered acro stick arrests body rate without leveling the attitude', () => {
  const memory = createAcroRateMemory();
  const delta = 1 / 60;
  let rate = rad(400);
  let angle = rad(70);
  for (let step = 0; step < 4 / delta; step += 1) {
    const { output } = stepAcroRateController({ axis: 'roll', stick: 0, actualRate: rate, delta, memory });
    rate += (output * ATTITUDE_TORQUE_PER_COMMAND / INERTIA.z - rate * 0.08) * delta;
    angle += rate * delta;
  }
  assert.ok(Math.abs(deg(rate)) < 3);
  assert.ok(Math.abs(deg(angle)) > 60);
});

test('direct acro collective does not add automatic tilt compensation', () => {
  const motors = createMotorThrusts();
  const collectiveThrust = HOVER_THRUST * 4;
  const actual = stepMotorModel({
    motors,
    pitchOutput: 0,
    rollOutput: 0,
    yawOutput: 0,
    altitudeOutput: 0,
    bodyUpY: 0.1,
    collectiveThrust,
    delta: 1
  });
  assert.ok(Math.abs(actual - collectiveThrust) < 1e-6);
});
