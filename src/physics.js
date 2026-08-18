export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const rad = (degrees) => degrees * Math.PI / 180;
export const deg = (radians) => radians * 180 / Math.PI;

export const legacyDefaultCode = {
  javascript: `// Called once per simulation step.
// error is in radians, dt is in seconds.
function pid(error, dt, state) {
  const kp = 1.25;
  const ki = 0.30;
  const kd = 0.42;

  state.integral += error * dt;
  state.integral = Math.max(-1, Math.min(1, state.integral));

  const derivative = (error - state.previousError) / dt;
  state.previousError = error;

  const output = kp * error
    + ki * state.integral
    + kd * derivative;

  return Math.max(-2.5, Math.min(2.5, output));
}`,
  python: `# Kast med liten drönare supports the arithmetic subset used below.
# error is in radians, dt is in seconds.
def pid(error, dt, state):
    kp = 1.25
    ki = 0.30
    kd = 0.42

    state["integral"] += error * dt
    state["integral"] = max(-1, min(1, state["integral"]))

    derivative = (error - state["previousError"]) / dt
    state["previousError"] = error

    output = kp * error + ki * state["integral"] + kd * derivative
    return max(-2.5, min(2.5, output))`
};

export const previousDefaultCode = {
  javascript: `// Your algorithm receives the gains saved in the Tune module.
// error is in radians (or meters for altitude), dt is in seconds.
function pid(error, dt, state, gains) {
  const { kp, ki, kd } = gains;

  state.integral += error * dt;
  state.integral = Math.max(-1, Math.min(1, state.integral));

  const derivative = (error - state.previousError) / dt;
  state.previousError = error;

  const output = kp * error
    + ki * state.integral
    + kd * derivative;

  return Math.max(-2.5, Math.min(2.5, output));
}`,
  python: `# The gains saved in the Tune module are supplied here.
# error is in radians (or meters for altitude), dt is in seconds.
def pid(error, dt, state, gains):
    kp = gains["kp"]
    ki = gains["ki"]
    kd = gains["kd"]

    state["integral"] += error * dt
    state["integral"] = max(-1, min(1, state["integral"]))

    derivative = (error - state["previousError"]) / dt
    state["previousError"] = error

    output = kp * error + ki * state["integral"] + kd * derivative
    return max(-2.5, min(2.5, output))`
};

export const defaultCode = {
  javascript: `// Start here: proportional control only.
// Use the learning guide to build this into your own PID loop.
function pid(error, dt, state, gains) {
  const output = gains.kp * error;
  return Math.max(-2.5, Math.min(2.5, output));
}`,
  python: `# Start here: proportional control only.
# Use the learning guide to build this into your own PID loop.
def pid(error, dt, state, gains):
    output = gains["kp"] * error
    return max(-2.5, min(2.5, output))`
};

export function createMemory() {
  return { integral: 0, previousError: 0, filteredDerivative: 0 };
}

export function readFlightInputs(pressed) {
  return {
    forwardInput: (pressed.has('KeyW') ? 1 : 0) - (pressed.has('KeyS') ? 1 : 0),
    rightInput: (pressed.has('KeyD') ? 1 : 0) - (pressed.has('KeyA') ? 1 : 0),
    upInput: (pressed.has('ArrowUp') ? 1 : 0) - (pressed.has('ArrowDown') ? 1 : 0),
    yawInput: (pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('ArrowRight') ? 1 : 0)
  };
}

export function builtInController(gains) {
  return (error, dt, memory) => {
    memory.integral = clamp(memory.integral + error * dt, -1, 1);
    const derivative = (error - memory.previousError) / dt;
    memory.previousError = error;
    return clamp(gains.kp * error + gains.ki * memory.integral + gains.kd * derivative, -2.5, 2.5);
  };
}

export function simulate(controller, scenario = 'step', gains = { kp: 1.25, ki: 0.3, kd: 0.42 }) {
  const dt = 1 / 60;
  const duration = 8;
  const points = [];
  const memory = createMemory();
  let angle = 0;
  let angularVelocity = 0;
  let controlEnergy = 0;
  let invalidOutput = false;

  for (let i = 0; i <= duration / dt; i += 1) {
    const time = i * dt;
    let target = 0;
    let disturbance = 0;
    if (scenario === 'step') target = time < 0.8 ? 0 : rad(20);
    if (scenario === 'code') {
      target = time < 0.8 ? 0 : rad(15);
      if (time > 4.1 && time < 4.35) disturbance = -2.7;
    }
    if (scenario === 'gust' && time > 1.6 && time < 2) disturbance = 3.8;
    if (scenario === 'payload') {
      target = time < 0.8 ? 0 : rad(12);
      if (time > 2.1) disturbance = -0.22;
    }

    const error = target - angle;
    let output;
    try {
      output = Number(controller(error, dt, memory, gains));
    } catch (errorThrown) {
      errorThrown.simulationTime = time;
      throw errorThrown;
    }
    if (!Number.isFinite(output)) {
      invalidOutput = true;
      output = 0;
    }
    output = clamp(output, -4, 4);
    const angularAcceleration = output * 10.2 - angularVelocity * 0.78 + disturbance;
    angularVelocity += angularAcceleration * dt;
    angle += angularVelocity * dt;
    controlEnergy += Math.abs(output) * dt;
    points.push({ time, target: deg(target), actual: deg(angle), error: deg(error), output });
  }

  return scoreSimulation(points, controlEnergy, invalidOutput, scenario);
}

export function scoreSimulation(points, controlEnergy, invalidOutput, scenario) {
  const active = points.filter((point) => point.time >= 0.8);
  const targetMagnitude = Math.max(1, ...active.map((point) => Math.abs(point.target)));
  const rms = Math.sqrt(active.reduce((sum, point) => sum + point.error ** 2, 0) / active.length);
  const peak = Math.max(...active.map((point) => Math.abs(point.actual)));
  const overshoot = scenario === 'gust'
    ? Math.max(...points.map((point) => Math.abs(point.actual))) * 2.2
    : Math.max(0, (peak - targetMagnitude) / Math.max(targetMagnitude, 1) * 100);
  const tail = points.slice(-60);
  const steadyError = tail.reduce((sum, point) => sum + Math.abs(point.error), 0) / tail.length;
  let settlingStart = 0.8;
  for (let index = 1; index < points.length; index += 1) {
    if (Math.abs(points[index].target - points[index - 1].target) > 0.01) settlingStart = points[index].time;
  }
  const finalTargetMagnitude = Math.abs(points.at(-1)?.target || 0);
  const band = Math.max(finalTargetMagnitude * 0.05, 0.7);
  let lastOutside = settlingStart;
  points.forEach((point) => {
    if (point.time >= settlingStart && Math.abs(point.error) > band) lastOutside = point.time;
  });
  const settling = clamp(lastOutside - settlingStart, 0, Math.max(0, 8 - settlingStart));
  const score = clamp(Math.round(100 - rms * 2.6 - overshoot * 0.32 - steadyError * 4.5 - controlEnergy * 0.16), 0, 100);
  return { points, rms, overshoot, steadyError, settling, score, invalidOutput };
}

export function compileJavascript(source) {
  if (!/function\s+pid\s*\(/.test(source)) throw new Error('Define a function named pid(error, dt, state).');
  const factory = new Function('error', 'dt', 'state', 'gains', `"use strict";\n${source}\nreturn pid(error, dt, state, gains);`);
  return (error, dt, state, gains) => factory(error, dt, state, gains);
}

function pythonExpression(expression) {
  return expression
    .replace(/\bmax\s*\(/g, 'Math.max(')
    .replace(/\bmin\s*\(/g, 'Math.min(')
    .replace(/\babs\s*\(/g, 'Math.abs(')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||');
}

export function compilePython(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  if (!lines.some((line) => /^\s*def\s+pid\s*\(\s*error\s*,\s*dt\s*,\s*state(?:\s*,\s*gains)?\s*\)\s*:/.test(line))) {
    throw new Error('Define def pid(error, dt, state, gains): exactly as shown in the starter.');
  }
  const body = [];
  const declared = new Set(['error', 'dt', 'state', 'gains']);
  let inside = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^def\s+pid/.test(trimmed)) { inside = true; continue; }
    if (!inside || !trimmed || trimmed.startsWith('#')) continue;
    if (/^(if|elif|else|for|while|import|from|class|try|with)\b/.test(trimmed)) {
      throw new Error(`The browser Python subset does not support “${trimmed.split(/[\s:]/)[0]}” yet. Use arithmetic, assignments, min/max/abs, and return.`);
    }
    if (trimmed.startsWith('return ')) {
      body.push(`return ${pythonExpression(trimmed.slice(7))};`);
      continue;
    }
    const assignment = trimmed.match(/^([A-Za-z_]\w*|state\[[^\]]+\])\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/);
    if (!assignment) throw new Error(`Unsupported Python statement: ${trimmed}`);
    const [, name, operator, expression] = assignment;
    const converted = pythonExpression(expression);
    if (name.startsWith('state[')) body.push(`${name} ${operator} ${converted};`);
    else if (operator === '=' && !declared.has(name)) {
      body.push(`let ${name} = ${converted};`);
      declared.add(name);
    } else body.push(`${name} ${operator} ${converted};`);
  }
  if (!body.some((line) => line.startsWith('return '))) throw new Error('Your pid function must return a motor command.');
  const factory = new Function('error', 'dt', 'state', 'gains', `"use strict";\n${body.join('\n')}`);
  return (error, dt, state, gains) => factory(error, dt, state, gains);
}

export function compileController(language, source) {
  return language === 'python' ? compilePython(source) : compileJavascript(source);
}
