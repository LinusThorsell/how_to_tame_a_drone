import { clamp } from './physics.js';

export const MASS = 1.2;
export const GRAVITY = 9.81;
export const ARM_LENGTH = 0.23;
export const MAX_MOTOR_THRUST = 6.8;
export const HOVER_THRUST = MASS * GRAVITY / 4;
export const MOTOR_TIME_CONSTANT = 0.055;
export const YAW_TORQUE_COEFFICIENT = 0.015;
export const INERTIA = Object.freeze({ x: 0.022, y: 0.04, z: 0.022 });
export const BODY_HALF_EXTENTS = Object.freeze({ x: 0.32, y: 0.1, z: 0.35 });
export const LINEAR_DRAG = 0.16;
export const LINEAR_DAMPING = 0.08;
export const ANGULAR_DAMPING = 0.08;
// The pilot can use the complete sport-flight envelope. Rapier turns the
// horizontal component of the tilted thrust vector into acceleration, so a
// larger commanded angle produces more speed without an artificial boost.
export const MAX_FLIGHT_TILT_DEGREES = 32;

// Counter-rotating propellers and the airframe resist yaw rate. Combined with
// the motor torque response this is close to critical damping for this inertia,
// preventing the slow, wide yaw pendulum that an undamped rigid body exhibits.
export const YAW_AERO_DAMPING = 0.08;

export function createMotorThrusts() {
  return [HOVER_THRUST, HOVER_THRUST, HOVER_THRUST, HOVER_THRUST];
}

export function stepMotorModel({
  motors,
  pitchOutput,
  rollOutput,
  yawOutput,
  altitudeOutput,
  bodyUpY,
  delta,
  battery = 100
}) {
  const tiltCompensation = Math.max(bodyUpY, 0.55);
  const collective = clamp(MASS * (GRAVITY + altitudeOutput * 3.2) / tiltCompensation, 0, MAX_MOTOR_THRUST * 4);
  const pitchMix = pitchOutput * 0.12 / (4 * ARM_LENGTH);
  const rollMix = rollOutput * 0.12 / (4 * ARM_LENGTH);
  const yawMix = yawOutput * 0.055 / (4 * YAW_TORQUE_COEFFICIENT);
  const base = collective / 4;
  const targets = [
    base - pitchMix - rollMix - yawMix,
    base - pitchMix + rollMix + yawMix,
    base + pitchMix - rollMix + yawMix,
    base + pitchMix + rollMix - yawMix
  ];
  const availableThrust = MAX_MOTOR_THRUST * (0.78 + battery / 100 * 0.22);
  const motorResponse = 1 - Math.exp(-delta / MOTOR_TIME_CONSTANT);
  for (let index = 0; index < 4; index += 1) {
    motors[index] += (clamp(targets[index], 0, availableThrust) - motors[index]) * motorResponse;
  }

  return motors.reduce((sum, thrust) => sum + thrust, 0);
}

export function motorBodyTorque(motors, yawRate = 0) {
  const [frontRight, frontLeft, rearRight, rearLeft] = motors;
  return {
    x: ARM_LENGTH * (-frontRight - frontLeft + rearRight + rearLeft),
    y: YAW_TORQUE_COEFFICIENT * (-frontRight + frontLeft + rearRight - rearLeft) - YAW_AERO_DAMPING * yawRate,
    z: ARM_LENGTH * (-frontRight + frontLeft - rearRight + rearLeft)
  };
}
