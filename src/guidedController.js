export const GUIDED_CONTROLLER_GAINS = Object.freeze({ kp: 2.5, ki: 0.1, kd: 1 });

export const GUIDED_CONTROLLER_STEPS = Object.freeze([
  Object.freeze({
    id: 'proportional',
    term: 'P',
    title: 'React to the error',
    summary: 'Give the drone an immediate correction that grows with the distance from its target.',
    explanation: 'The error tells us how far the drone is from the requested angle. Multiplying it by kp makes a larger error produce a larger motor command.',
    action: 'Add proportional control',
    javascript: 'const proportional = gains.kp * error;',
    python: 'proportional = gains["kp"] * error'
  }),
  Object.freeze({
    id: 'integral',
    term: 'I',
    title: 'Remember leftover error',
    summary: 'Add a small memory so the controller can remove a persistent offset.',
    explanation: 'We accumulate error over time, but limit that memory between −1 and 1. This anti-windup guard prevents old error from building an unsafe correction.',
    action: 'Add error memory',
    javascript: 'state.integral += error * dt;\nstate.integral = Math.max(-1, Math.min(1, state.integral));\nconst integral = gains.ki * state.integral;',
    python: 'state["integral"] += error * dt\nstate["integral"] = max(-1, min(1, state["integral"]))\nintegral = gains["ki"] * state["integral"]'
  }),
  Object.freeze({
    id: 'derivative',
    term: 'D',
    title: 'Slow a fast approach',
    summary: 'Measure how quickly the error changes and use that rate as damping.',
    explanation: 'The derivative compares this error with the previous one. A rapid change creates a counteracting command, helping the drone stop instead of overshooting.',
    action: 'Add derivative damping',
    javascript: 'const derivative = (error - state.previousError) / dt;\nstate.previousError = error;\nconst damping = gains.kd * derivative;',
    python: 'derivative = (error - state["previousError"]) / dt\nstate["previousError"] = error\ndamping = gains["kd"] * derivative'
  }),
  Object.freeze({
    id: 'safety',
    term: 'SAFE',
    title: 'Mix and limit the output',
    summary: 'Combine P, I, and D, then keep the final motor command inside the aircraft limit.',
    explanation: 'The three corrections work together, but an extreme command could saturate the motors. Clamping to ±2.5 keeps the controller finite and predictable.',
    action: 'Finish safe controller',
    javascript: 'const output = proportional + integral + damping;\nreturn Math.max(-2.5, Math.min(2.5, output));',
    python: 'output = proportional + integral + damping\nreturn max(-2.5, min(2.5, output))'
  })
]);

function boundedStepCount(completedSteps) {
  const count = Number.isFinite(Number(completedSteps)) ? Math.floor(Number(completedSteps)) : 0;
  return Math.max(0, Math.min(GUIDED_CONTROLLER_STEPS.length, count));
}

export function gainsForGuidedStep(completedSteps) {
  const count = boundedStepCount(completedSteps);
  return {
    kp: count >= 1 ? GUIDED_CONTROLLER_GAINS.kp : 0,
    ki: count >= 2 ? GUIDED_CONTROLLER_GAINS.ki : 0,
    kd: count >= 3 ? GUIDED_CONTROLLER_GAINS.kd : 0
  };
}

export function buildGuidedController(language, completedSteps) {
  const count = boundedStepCount(completedSteps);
  const hasP = count >= 1;
  const hasI = count >= 2;
  const hasD = count >= 3;
  const hasSafety = count >= 4;

  if (language === 'python') {
    const lines = [
      '# Built step by step in No code mode.',
      'def pid(error, dt, state, gains):'
    ];
    if (hasP) lines.push('    proportional = gains["kp"] * error');
    if (hasI) lines.push('    state["integral"] += error * dt', '    state["integral"] = max(-1, min(1, state["integral"]))', '    integral = gains["ki"] * state["integral"]');
    if (hasD) lines.push('    derivative = (error - state["previousError"]) / dt', '    state["previousError"] = error', '    damping = gains["kd"] * derivative');
    if (hasSafety) lines.push('    output = proportional + integral + damping', '    return max(-2.5, min(2.5, output))');
    else if (hasD) lines.push('    return proportional + integral + damping');
    else if (hasI) lines.push('    return proportional + integral');
    else if (hasP) lines.push('    return proportional');
    else lines.push('    return 0');
    return lines.join('\n');
  }

  const lines = [
    '// Built step by step in No code mode.',
    'function pid(error, dt, state, gains) {'
  ];
  if (hasP) lines.push('  const proportional = gains.kp * error;');
  if (hasI) lines.push('', '  state.integral += error * dt;', '  state.integral = Math.max(-1, Math.min(1, state.integral));', '  const integral = gains.ki * state.integral;');
  if (hasD) lines.push('', '  const derivative = (error - state.previousError) / dt;', '  state.previousError = error;', '  const damping = gains.kd * derivative;');
  if (hasSafety) lines.push('', '  const output = proportional + integral + damping;', '  return Math.max(-2.5, Math.min(2.5, output));');
  else if (hasD) lines.push('', '  return proportional + integral + damping;');
  else if (hasI) lines.push('', '  return proportional + integral;');
  else if (hasP) lines.push('', '  return proportional;');
  else lines.push('  return 0;');
  lines.push('}');
  return lines.join('\n');
}
