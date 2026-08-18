export const DEFAULT_SCENARIO = 'easy';
export const REPLAY_DURATION_SECONDS = 5.2;

export const CODE_SCENARIOS = Object.freeze([
  { id: 'easy', level: '01', label: 'Easy · 10°', headline: '10° attitude step' },
  { id: 'medium', level: '02', label: 'Medium · 20°', headline: '20° attitude step' },
  { id: 'hard', level: '03', label: 'Hard · 32°', headline: '32° attitude step' }
]);

export const SCENARIOS = Object.freeze([
  ...CODE_SCENARIOS,
  { id: 'switchback', level: '04', label: 'Switchback', headline: 'Alternating attitude steps' },
  { id: 'envelope', level: '05', label: 'Full envelope', headline: 'Progressive shifts up to ±32°' },
  { id: 'yaw', level: '06', label: 'Yaw', headline: '20° yaw step' },
  { id: 'gust', level: '07', label: 'Gust', headline: 'Lateral wind rejection' },
  { id: 'payload', level: '08', label: 'Payload', headline: 'Offset payload recovery' }
]);

export const TUNE_CHECK_SCENARIOS = Object.freeze(['hard', 'yaw', 'gust', 'payload']);

export function scenarioDefinition(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) || SCENARIOS[0];
}

export function isScenario(id) {
  return SCENARIOS.some((scenario) => scenario.id === id);
}

export function isCodeScenario(id) {
  return CODE_SCENARIOS.some((scenario) => scenario.id === id);
}

export function hasPassedCodeScenario(passes, id) {
  const score = Number(passes?.[id]);
  return Number.isFinite(score) && score >= 58;
}

export function isCodeScenarioUnlocked(id, passes) {
  const index = CODE_SCENARIOS.findIndex((scenario) => scenario.id === id);
  if (index < 0) return false;
  return CODE_SCENARIOS.slice(0, index).every((scenario) => hasPassedCodeScenario(passes, scenario.id));
}

export function nextCodeScenarioId(passes) {
  return CODE_SCENARIOS.find((scenario) => !hasPassedCodeScenario(passes, scenario.id))?.id || null;
}

export function targetDegreesForScenario(scenario, time) {
  if (scenario === 'easy' || scenario === 'code') return time < 0.8 ? 0 : 10;
  if (scenario === 'medium') return time < 0.8 ? 0 : 20;
  if (scenario === 'hard' || scenario === 'step') return time < 0.8 ? 0 : 32;
  if (scenario === 'switchback') {
    if (time < 0.8) return 0;
    if (time < 2.4) return 12;
    if (time < 4) return -10;
    if (time < 5.6) return 18;
    if (time < 6.8) return -14;
    return 8;
  }
  if (scenario === 'envelope') {
    if (time < 0.8) return 0;
    if (time < 2.2) return 15;
    if (time < 3.6) return -20;
    if (time < 5) return 26;
    if (time < 6.4) return -32;
    return 18;
  }
  if (scenario === 'yaw') return time < 0.8 ? 0 : 20;
  if (scenario === 'payload') return time < 0.8 ? 0 : 12;
  return 0;
}
