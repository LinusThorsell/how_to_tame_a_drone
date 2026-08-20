import { clamp, rad } from './physics.js';

export const ACRO_RATE_PROFILE = Object.freeze({
  roll: Object.freeze({ expo: 0.88, max: 600 }),
  pitch: Object.freeze({ expo: 0.88, max: 600 }),
  yaw: Object.freeze({ expo: 0.55, max: 1000 })
});

export const ACRO_YAW_AERO_DAMPING = 0.045;

const RATE_PID = Object.freeze({
  roll: Object.freeze({ kp: 0.42, ki: 0.015, kd: 0.002 }),
  pitch: Object.freeze({ kp: 0.42, ki: 0.015, kd: 0.002 }),
  yaw: Object.freeze({ kp: 0.55, ki: 0.02, kd: 0.004 })
});

const RATE_OUTPUT_LIMIT = Object.freeze({ roll: 2.5, pitch: 2.5, yaw: 3.2 });

export function acroThrottleFromStick(stick) {
  return (clamp(Number(stick) || 0, -1, 1) + 1) / 2;
}

export function acroCollectiveFromThrottle(throttle, hoverThrottle) {
  const command = clamp(Number(throttle) || 0, 0, 1);
  const requestedHover = Number(hoverThrottle);
  const hover = clamp(Number.isFinite(requestedHover) ? requestedHover : 0.5, 0, 1);
  if (command <= 0.5) return hover * command * 2;
  return hover + (1 - hover) * (command - 0.5) * 2;
}

export function acroRateFromStick(stick, axis = 'roll') {
  const profile = ACRO_RATE_PROFILE[axis] || ACRO_RATE_PROFILE.roll;
  const input = clamp(Number(stick) || 0, -1, 1);
  const magnitude = Math.abs(input);
  const expo = clamp(Number(profile.expo) || 0, 0, 1);
  const rateDegrees = profile.max * ((1 - expo) * magnitude + expo * magnitude ** 3);
  return rad(Math.sign(input) * rateDegrees);
}

export function createAcroRateMemory() {
  return { integral: 0, previousRate: 0 };
}

export function stepAcroRateController({ axis = 'roll', stick = 0, actualRate = 0, delta, memory }) {
  const timestep = clamp(Number(delta) || 0, 1 / 1000, 0.05);
  const safeRate = Number.isFinite(actualRate) ? actualRate : 0;
  const targetRate = acroRateFromStick(stick, axis);
  const error = targetRate - safeRate;
  const gains = RATE_PID[axis] || RATE_PID.roll;
  const outputLimit = RATE_OUTPUT_LIMIT[axis] || RATE_OUTPUT_LIMIT.roll;

  // Acro rate loops derive D from gyro movement rather than error movement. This
  // avoids a derivative kick when the pilot makes a sharp stick command.
  const gyroDerivative = (safeRate - memory.previousRate) / timestep;
  memory.previousRate = safeRate;
  if (Math.abs(stick) > 0.7) memory.integral = 0;
  else if (Math.abs(error) > rad(100)) memory.integral *= Math.exp(-10 * timestep);
  else memory.integral = clamp(memory.integral + error * timestep, -2, 2);

  return {
    targetRate,
    output: clamp(
      gains.kp * error + gains.ki * memory.integral - gains.kd * gyroDerivative,
      -outputLimit,
      outputLimit
    )
  };
}
