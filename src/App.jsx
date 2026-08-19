import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import ResponseChart from './components/ResponseChart';
import { controllerEditorExtensions, getControllerDiagnostics, showControllerDiagnostics } from './codeEditor';
import {
  builtInController,
  compileController,
  createMemory,
  defaultCode,
  legacyDefaultCode,
  previousDefaultCode,
  simulate
} from './physics';
import { simulateRapierTuning } from './rapierTuning';
import {
  CODE_SCENARIOS,
  DEFAULT_SCENARIO,
  hasPassedCodeScenario,
  isCodeScenario,
  isCodeScenarioUnlocked,
  isScenario,
  nextCodeScenarioId,
  scenarioDefinition,
  SCENARIOS,
  TUNE_CHECK_SCENARIOS
} from './scenarios';
import {
  distanceToFirstGate,
  FLIGHT_START,
  formatRaceTime,
  gatesForMode,
  RACE_GATES,
  RACE_PAR_SECONDS,
  TRAINING_GATES
} from './flightCourse';
import { COURSE_NAVIGATION, isViewUnlocked, resolveView } from './courseNavigation';
import {
  buildGuidedController,
  gainsForGuidedStep,
  GUIDED_CONTROLLER_STEPS
} from './guidedController';

const FlightScene = lazy(() => import('./components/FlightScene'));
const LearnFlightDemo = lazy(() => import('./components/LearnFlightDemo'));

const STORAGE_KEY = 'rotor-lab-react-v1';
const MAX_GAIN = 6;
const TUNE_PASS_SCORE = 75;
const TUNE_SCENARIO_FLOOR = 60;
const CODE_REQUIREMENT_VERSION = 2;
const TUNE_REQUIREMENT_VERSION = 2;
const RETIRED_STARTER_FINGERPRINTS = {
  javascript: '60ff5592',
  python: '8184c69f'
};
const baseProgress = {
  learned: false,
  codePassed: false,
  tunePassed: false,
  tuneRequirementVersion: 0,
  tuneScore: null,
  tuneWarning: false,
  tuneWeakest: null,
  language: 'javascript',
  codeScenario: DEFAULT_SCENARIO,
  codeScenarioPasses: { easy: null, medium: null, hard: null },
  scenario: DEFAULT_SCENARIO,
  codeRequirementVersion: 0,
  codeMode: 'manual',
  helpfulStep: 0,
  validated: null,
  code: { ...defaultCode },
  gains: { kp: 1, ki: 0, kd: 0 },
  practicePassed: false,
  raceBest: null
};

function initialFlightTelemetry(mode = 'training') {
  return {
    altitude: FLIGHT_START.y,
    speed: 0,
    tilt: 0,
    commandedTilt: 0,
    heading: 0,
    battery: 100,
    elapsed: 0,
    checkpoint: 0,
    distance: distanceToFirstGate(mode),
    motors: [43, 43, 43, 43],
    controllerFault: false
  };
}

const lessons = [
  { title: 'The control loop', time: '4 min', focus: 'loop', demoMode: 'balanced', kicker: '01 · THE CONTROL LOOP', heading: 'Every correction starts with error.', body: 'The controller compares where the drone should be with where it is now. That difference is the <strong>error</strong>. PID turns that error, its history, and its rate of change into a motor command.', cue: 'Follow the glow from target → PID → drone, then watch the measured angle return.', takeaway: 'Error is not failure—it is the information your controller needs.', next: 'Next: Proportional' },
  { title: 'Proportional', time: '3 min', focus: 'p', demoMode: 'high', kicker: '02 · PROPORTIONAL', heading: 'P reacts to what is wrong now.', body: 'The proportional term pushes in direct proportion to the current error. More <strong>P</strong> makes the drone respond faster, but too much creates overshoot and repeated oscillation around the target.', cue: 'Compare P too low and P too high. Look for the point where authority turns into wobble.', takeaway: 'Raise P until response is decisive, then stop before persistent oscillation.', next: 'Next: Integral' },
  { title: 'Integral', time: '3 min', focus: 'i', demoMode: 'high', kicker: '03 · INTEGRAL', heading: 'I remembers what P leaves behind.', body: 'The integral term accumulates error over time. It removes the small offset caused by an uneven payload or motor, but too much <strong>I</strong> stores a large correction and produces slow, swelling oscillations called windup.', cue: 'Watch the slow swing with I too high: stored error keeps pushing after the target is crossed.', takeaway: 'Use just enough I to remove steady error, and clamp its stored value.', next: 'Next: Derivative' },
  { title: 'Derivative', time: '3 min', focus: 'd', demoMode: 'low', kicker: '04 · DERIVATIVE', heading: 'D sees where the motion is going.', body: 'The derivative term reacts to how quickly error changes. It acts like aerodynamic damping: <strong>D</strong> slows a fast approach before the drone shoots past its target. Sensor noise is its main weakness.', cue: 'Start with D absent, then add damping and watch the drone stop chasing the ghost target.', takeaway: 'Add D to calm overshoot, but filter noisy measurements in real aircraft.', next: 'Next: Tuning method' },
  { title: 'A tuning method', time: '5 min', focus: 'method', demoMode: 'high', kicker: '05 · A TUNING METHOD', heading: 'Tune one behavior at a time.', body: 'Start with I and D at zero. Raise <strong>P</strong> until the response becomes crisp, add <strong>D</strong> to control overshoot, then introduce a small amount of <strong>I</strong> to remove lasting bias. Re-test after every change.', cue: 'Step through P → add D → add I. Each click changes only the behavior you are evaluating.', takeaway: 'P for authority, D for calm, I for accuracy—in that order.', next: 'Continue to Code Lab' }
];

const learningComparisons = {
  loop: {
    title: 'See the loop close',
    options: [
      { id: 'low', label: 'No correction', gains: { kp: 0, ki: 0, kd: 0 }, copy: 'The target changes, but no motor correction closes the error.' },
      { id: 'balanced', label: 'Controlled', gains: { kp: 1.2, ki: 0.3, kd: 0.4 }, copy: 'Measurement feeds back and the aircraft converges on the ghost target.' },
      { id: 'high', label: 'Over-correcting', gains: { kp: 3.6, ki: 0, kd: 0.1 }, copy: 'Each correction creates another large error in the opposite direction.' }
    ]
  },
  p: {
    title: 'Compare proportional gain',
    options: [
      { id: 'low', label: 'P too low', gains: { kp: 0.25, ki: 0, kd: 0 }, copy: 'Too little authority: the aircraft reacts late and trails the target.' },
      { id: 'balanced', label: 'P balanced', gains: { kp: 1.2, ki: 0.3, kd: 0.4 }, copy: 'Enough authority to move decisively without repeatedly crossing the target.' },
      { id: 'high', label: 'P too high', gains: { kp: 3.6, ki: 0, kd: 0.1 }, copy: 'The correction is too aggressive, so the aircraft overshoots and reverses.' }
    ]
  },
  i: {
    title: 'Compare integral memory',
    options: [
      { id: 'low', label: 'I absent', gains: { kp: 1.2, ki: 0, kd: 0.4 }, copy: 'The response is stable, but a small persistent error can remain.' },
      { id: 'balanced', label: 'I balanced', gains: { kp: 1.2, ki: 0.3, kd: 0.4 }, copy: 'A little memory removes the leftover error without taking control.' },
      { id: 'high', label: 'I too high', gains: { kp: 1.2, ki: 1.5, kd: 0.1 }, copy: 'Stored error keeps commanding the motors after the target is crossed.' }
    ]
  },
  d: {
    title: 'Compare derivative damping',
    options: [
      { id: 'low', label: 'D absent', gains: { kp: 2.6, ki: 0.2, kd: 0 }, copy: 'Nothing resists the fast approach, so momentum carries the drone past target.' },
      { id: 'balanced', label: 'D balanced', gains: { kp: 1.2, ki: 0.3, kd: 0.4 }, copy: 'D starts braking as the error changes quickly and controls overshoot.' },
      { id: 'high', label: 'D too high', gains: { kp: 1.2, ki: 0.2, kd: 2.2 }, copy: 'Excessive damping fights useful motion and makes the response sluggish.' }
    ]
  },
  method: {
    title: 'Tune in this order',
    options: [
      { id: 'low', label: '1 · Set P', gains: { kp: 1.4, ki: 0, kd: 0 }, copy: 'Begin with authority. Ignore fine accuracy until the drone responds clearly.' },
      { id: 'balanced', label: '2 · Add D', gains: { kp: 1.4, ki: 0, kd: 0.7 }, copy: 'Add damping next so the decisive P response no longer overshoots.' },
      { id: 'high', label: '3 · Add I', gains: { kp: 1.4, ki: 0.25, kd: 0.7 }, copy: 'Finish with only enough memory to remove the remaining steady error.' }
    ]
  }
};

const pidGuide = [
  {
    term: '1 · P',
    title: 'React to the error now',
    body: 'The starter already multiplies the current error by P. Change P and run the physical test until the response has authority without endless oscillation.',
    javascript: 'const proportional = gains.kp * error;',
    python: 'proportional = gains["kp"] * error'
  },
  {
    term: '2 · I',
    title: 'Remember leftover error',
    body: 'Accumulate error over time and clamp the stored value to limit windup. Add the integral term to your output, then introduce only a little I.',
    javascript: `state.integral += error * dt;
state.integral = Math.max(-1, Math.min(1, state.integral));
const integral = gains.ki * state.integral;`,
    python: `state["integral"] += error * dt
state["integral"] = max(-1, min(1, state["integral"]))
integral = gains["ki"] * state["integral"]`
  },
  {
    term: '3 · D',
    title: 'Damp fast movement',
    body: 'Measure how quickly error changes. D resists a rapid approach and can calm overshoot, but too much makes the motors react to noise.',
    javascript: `const derivative = (error - state.previousError) / dt;
state.previousError = error;
const damping = gains.kd * derivative;`,
    python: `derivative = (error - state["previousError"]) / dt
state["previousError"] = error
damping = gains["kd"] * derivative`
  },
  {
    term: '4 · MIX',
    title: 'Combine, clamp, and test',
    body: 'Sum your three terms and retain the output clamp. Run the Rapier test after every edit, then verify roll, yaw, gust, and payload in Tune.',
    javascript: `const output = proportional + integral + damping;
return Math.max(-2.5, Math.min(2.5, output));`,
    python: `output = proportional + integral + damping
return max(-2.5, min(2.5, output))`
  }
];

function sourceFingerprint(source = '') {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isRetiredStarter(language, source) {
  return source === legacyDefaultCode[language]
    || source === previousDefaultCode[language]
    || sourceFingerprint(source) === RETIRED_STARTER_FINGERPRINTS[language];
}

function emptyCodeScenarioPasses() {
  return Object.fromEntries(CODE_SCENARIOS.map((scenario) => [scenario.id, null]));
}

function clearCodeValidation() {
  return {
    codePassed: false,
    codeRequirementVersion: 0,
    codeScenario: DEFAULT_SCENARIO,
    codeScenarioPasses: emptyCodeScenarioPasses()
  };
}

function loadProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const code = { ...defaultCode, ...(stored.code || {}) };
    const selectedLanguage = stored.language || baseProgress.language;
    let selectedStarterRetired = false;
    for (const language of ['javascript', 'python']) {
      if (isRetiredStarter(language, code[language])) {
        if (language === selectedLanguage) selectedStarterRetired = true;
        code[language] = defaultCode[language];
      }
    }
    const validatedLanguage = stored.validated?.language;
    const validatedIsStarter = validatedLanguage && isRetiredStarter(validatedLanguage, stored.validated?.source);
    const validated = validatedIsStarter
      ? { language: stored.validated.language, source: defaultCode[stored.validated.language] }
      : stored.validated || null;
    const resetExercise = Boolean(selectedStarterRetired || validatedIsStarter);
    const storedGains = { ...baseProgress.gains, ...(stored.gains || {}) };
    const gains = Object.fromEntries(Object.entries(storedGains).map(([key, value]) => [
      key,
      Number.isFinite(Number(value)) ? Math.max(0, Math.min(MAX_GAIN, Number(value))) : baseProgress.gains[key]
    ]));
    const codeRequirementCurrent = !resetExercise && stored.codeRequirementVersion === CODE_REQUIREMENT_VERSION;
    const codeScenarioPasses = Object.fromEntries(CODE_SCENARIOS.map((scenario) => {
      const score = Number(stored.codeScenarioPasses?.[scenario.id]);
      return [scenario.id, codeRequirementCurrent && Number.isFinite(score) && score >= 58 && score <= 100 ? score : null];
    }));
    const nextCodeScenario = nextCodeScenarioId(codeScenarioPasses);
    const requestedCodeScenario = isCodeScenario(stored.codeScenario) ? stored.codeScenario : DEFAULT_SCENARIO;
    const codeScenario = isCodeScenarioUnlocked(requestedCodeScenario, codeScenarioPasses)
      ? requestedCodeScenario
      : nextCodeScenario || 'hard';
    const codePassed = CODE_SCENARIOS.every((scenario) => hasPassedCodeScenario(codeScenarioPasses, scenario.id));
    return {
      ...baseProgress,
      ...stored,
      codeScenario,
      codeScenarioPasses,
      codeMode: stored.codeMode === 'helpful' ? 'helpful' : 'manual',
      helpfulStep: Math.max(0, Math.min(GUIDED_CONTROLLER_STEPS.length, Math.floor(Number(stored.helpfulStep) || 0))),
      scenario: isScenario(stored.scenario) ? stored.scenario : DEFAULT_SCENARIO,
      code,
      validated,
      gains: resetExercise ? { ...baseProgress.gains } : gains,
      practicePassed: resetExercise ? false : Boolean(stored.practicePassed || stored.raceBest),
      raceBest: Number.isFinite(Number(stored.raceBest)) && Number(stored.raceBest) > 0
        ? Number(stored.raceBest)
        : null,
      codePassed,
      tunePassed: resetExercise
        ? false
        : Boolean(stored.tunePassed && stored.tuneRequirementVersion === TUNE_REQUIREMENT_VERSION),
      tuneWarning: resetExercise ? false : Boolean(stored.tuneWarning),
      tuneWeakest: resetExercise ? null : stored.tuneWeakest || null
    };
  } catch {
    return structuredClone(baseProgress);
  }
}

function Brand() {
  return (
    <a className="brand" href="#learn" aria-label="Kast med liten drönare home">
      <span className="hiq-logo-mark" aria-hidden="true" />
      <span className="brand-copy"><strong>Kast med liten</strong><em>drönare</em></span>
    </a>
  );
}

function LockIcon() {
  return (
    <svg className="nav-lock-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.75 7V5.25a3.25 3.25 0 0 1 6.5 0V7" />
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M8 10v1.5" />
    </svg>
  );
}

function Header({ view, navigate, progress }) {
  const completed = [progress.learned, progress.codePassed, progress.tunePassed, progress.practicePassed].filter(Boolean).length;
  const percentage = Math.round(completed / 4 * 100);
  return (
    <header className="topbar">
      <Brand />
      <nav className="course-nav" aria-label="Course modules">
        {COURSE_NAVIGATION.map((item, index) => {
          const locked = !isViewUnlocked(item.id, progress);
          return (
            <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => navigate(item.id)} data-view={item.id} disabled={locked} title={locked ? `Finish the previous stage to unlock ${item.label}` : undefined} aria-label={locked ? `${item.label}, locked` : item.label}>
              <span>0{index + 1}</span> {item.label} {locked && <LockIcon />}
            </button>
          );
        })}
      </nav>
      <div className="course-progress" aria-label="Course progress">
        <div><span>{percentage}% complete</span><b id="progress-count">{completed}/4</b></div>
        <div className="progress-track"><i style={{ width: `${percentage}%` }} /></div>
      </div>
    </header>
  );
}

function GainSlider({ id, term, label, value, max, step, compact = false, help, highlight = false, onChange }) {
  const fill = `${value / max * 100}%`;
  if (compact) {
    return (
      <div className={`mini-control ${term.toLowerCase()}-control ${highlight ? 'teaching-focus' : ''}`}>
        <label htmlFor={id}><span>{term}</span> {label} <output>{value.toFixed(2)}</output></label>
        <input id={id} type="range" min="0" max={max} value={value} step={step} style={{ '--fill': fill }} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    );
  }
  return (
    <div className={`gain-control ${term.toLowerCase()}-control`}>
      <div className="gain-readout"><span>{term}</span><div><b>{label}</b><small>{help}</small></div><output>{value.toFixed(2)}</output></div>
      <input id={id} type="range" min="0" max={max} value={value} step={step} style={{ '--fill': fill }} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

function ScenarioSelector({ value, onChange, compact = false, scenarios = SCENARIOS }) {
  return (
    <div className={`scenario-selector ${compact ? 'compact' : ''}`} role="tablist" aria-label="Flight test scenario">
      {scenarios.map((scenario) => (
        <button key={scenario.id} className={value === scenario.id ? 'active' : ''} onClick={() => onChange(scenario.id)} role="tab" aria-selected={value === scenario.id} title={scenario.headline}>
          <span>{scenario.level}</span><b>{scenario.label}</b>
        </button>
      ))}
    </div>
  );
}

function CodeScenarioProgress({ value, onChange, passes }) {
  const passedCount = CODE_SCENARIOS.filter((scenario) => hasPassedCodeScenario(passes, scenario.id)).length;
  const nextScenario = nextCodeScenarioId(passes);
  return (
    <div className="code-progression">
      <div className="code-progression-head">
        <span>VALIDATION PATH</span>
        <div><i><b style={{ width: `${passedCount / CODE_SCENARIOS.length * 100}%` }} /></i><strong>{passedCount}/3 PASSED</strong></div>
      </div>
      <div className="code-stage-list" role="tablist" aria-label="Code validation stages">
        {CODE_SCENARIOS.map((scenario) => {
          const passed = hasPassedCodeScenario(passes, scenario.id);
          const unlocked = isCodeScenarioUnlocked(scenario.id, passes);
          const active = value === scenario.id;
          const recommended = nextScenario === scenario.id;
          const status = passed ? `Passed · ${passes[scenario.id]}/100` : unlocked ? (active ? 'Current test' : 'Ready') : 'Pass previous stage';
          return (
            <button
              key={scenario.id}
              className={`${active ? 'active ' : ''}${passed ? 'passed ' : ''}${recommended ? 'recommended ' : ''}${unlocked ? '' : 'locked'}`}
              onClick={() => onChange(scenario.id)}
              disabled={!unlocked}
              role="tab"
              aria-selected={active}
              aria-label={`${scenario.label}: ${status}`}
            >
              <span className="code-stage-number">{passed ? '✓' : scenario.level}</span>
              <span className="code-stage-copy"><b>{scenario.label}</b></span>
              <span className="code-stage-state" aria-hidden="true">{passed ? `${passes[scenario.id]}/100` : unlocked ? (recommended ? 'NEXT' : 'OPEN') : 'LOCKED'}</span>
            </button>
          );
        })}
      </div>
      <p className={nextScenario ? '' : 'complete'}>
        {nextScenario
          ? <><span>Next objective</span> Pass <strong>{scenarioDefinition(nextScenario).label}</strong> to unlock the following stage.</>
          : <><span>Validation complete</span> All three angles passed. Continue to Tune for direction changes and disturbances.</>}
      </p>
    </div>
  );
}

function ResponseLegend() {
  return <div className="code-graph-legend"><span><i className="target-line" />Command</span><span><i className="actual-line" />Response</span><span><i className="error-line" />Error</span></div>;
}

function TuneWarningDialog({ score, weakest, controllerWarning = false, onClose, onProceed, proceedLabel = 'I understand' }) {
  return (
    <div className="warning-dialog-backdrop" role="presentation">
      <section className="warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tune-warning-title" aria-describedby="tune-warning-copy">
        <span className="warning-dialog-icon" aria-hidden="true">!</span>
        <p className="eyebrow"><span>Stability warning</span></p>
        <h2 id="tune-warning-title">This flight setup needs extra caution.</h2>
        <p id="tune-warning-copy">{controllerWarning ? <>The current controller has not passed bench validation. </> : null}{score != null ? <>The tune scored <strong>{score}/100</strong>{weakest ? <>, with <strong>{weakest.name}</strong> weakest at <strong>{weakest.score}/100</strong></> : null}. </> : null}Flight is still available, but the aircraft may respond slowly, overshoot, wobble, or activate its fallback controller.</p>
        <div className="warning-dialog-targets"><span>Recommended</span><b>{TUNE_PASS_SCORE}+ combined</b><b>{TUNE_SCENARIO_FLOOR}+ every test</b></div>
        <div className="warning-dialog-actions">
          <button className="ghost-btn" onClick={onClose}>Keep tuning</button>
          <button className="warning-proceed" onClick={onProceed}>{proceedLabel}</button>
        </div>
      </section>
    </div>
  );
}

function LearnView({ onComplete }) {
  const [lessonIndex, setLessonIndex] = useState(0);
  const [gains, setGains] = useState({ kp: 1.2, ki: 0.3, kd: 0.4 });
  const [demoMode, setDemoMode] = useState('balanced');
  const lesson = lessons[lessonIndex];
  const comparison = learningComparisons[lesson.focus];
  const activeOption = comparison.options.find((option) => option.id === demoMode);
  const run = useMemo(() => simulate(builtInController(gains), 'step'), [gains]);
  let response = ['Balanced response', 'Quick rise with controlled overshoot.'];
  let responseKind = 'balanced';
  if (gains.kp < 0.45) { response = ['Weak response', 'Add P to give the controller more authority.']; responseKind = 'weak'; }
  else if (gains.ki > 0.9) { response = ['Integral windup risk', 'Stored error is driving a slow overshoot.']; responseKind = 'windup'; }
  else if (gains.kd > 1.5) { response = ['Over-damped', 'High D makes the response safe but sluggish.']; responseKind = 'damped'; }
  else if (run.overshoot > 45 || run.score < 30) { response = ['Oscillation detected', 'Reduce P or add D to dissipate motion.']; responseKind = 'oscillation'; }

  const chooseMode = (option) => {
    setDemoMode(option.id);
    setGains({ ...option.gains });
  };

  const chooseLesson = (index) => {
    const nextLesson = lessons[index];
    const nextOption = learningComparisons[nextLesson.focus].options.find((option) => option.id === nextLesson.demoMode);
    setLessonIndex(index);
    chooseMode(nextOption);
  };

  const changeLearningGain = (key, value) => {
    setDemoMode('custom');
    setGains((current) => ({ ...current, [key]: value }));
  };

  const next = () => {
    if (lessonIndex < lessons.length - 1) chooseLesson(lessonIndex + 1);
    else onComplete();
  };

  return (
    <section className="view active" id="learn-view" aria-labelledby="learn-title">
      <div className="view-head learn-head"><div><p className="eyebrow"><span>Module 01</span> Control theory, made tangible</p><h1 id="learn-title">Turn error into <em>controlled flight.</em></h1><p className="lede">A quadcopter is always falling. A well-tuned PID loop is what makes that fall look effortless. Change each term and see exactly what the aircraft feels.</p></div><div className="module-stamp" aria-hidden="true"><b>PID</b><span>FOUNDATIONS</span></div></div>
      <div className="learn-grid">
        <aside className="lesson-rail panel"><p className="panel-label">Flight manual</p>{lessons.map((item, index) => <button key={item.title} className={`lesson-link ${index === lessonIndex ? 'active' : ''}`} onClick={() => chooseLesson(index)}><span>0{index + 1}</span><b>{item.title}</b><i>{item.time}</i></button>)}</aside>
        <article className="lesson-card panel" data-focus={lesson.focus}>
          <div className="lesson-copy"><div className="lesson-kicker">{lesson.kicker}</div><h2>{lesson.heading}</h2><p dangerouslySetInnerHTML={{ __html: lesson.body }} /><div className="lesson-attention"><span>WATCH</span><p>{lesson.cue}</p></div></div>
          <div className="control-loop" aria-label="PID control loop diagram"><div className="loop-node setpoint"><span>01</span><b>Setpoint</b><small>Where we want to be</small></div><div className="loop-arrow"><span>error</span>→</div><div className="loop-node controller"><span>02</span><b>PID</b><small>Calculate correction</small></div><div className="loop-arrow"><span>output</span>→</div><div className="loop-node drone-node"><span>03</span><b>Drone</b><small>Motors change motion</small></div><div className="feedback-line"><span>measured angle</span></div></div>
          <div className="equation-strip"><span>controller output</span><b>=</b><strong className="p-color">K<sub>p</sub> · e(t)</strong><b>+</b><strong className="i-color">K<sub>i</sub> · ∫e(t)dt</strong><b>+</b><strong className="d-color">K<sub>d</sub> · de(t)/dt</strong></div>
          <div className="lesson-footer"><div><span className="key-cap">KEY IDEA</span><p>{lesson.takeaway}</p></div><button className="primary-btn" id="next-lesson" onClick={next}>{lesson.next} <span>→</span></button></div>
        </article>
        <aside className={`live-lab panel response-${responseKind}`} data-focus={lesson.focus}>
          <div className="panel-title"><div><p className="panel-label">Interactive Three.js lab</p><h3>{comparison.title}</h3></div><span className="demo-badge">SIMULATED</span></div>
          <Suspense fallback={<div className="learn-flight-loading">Loading aircraft…</div>}><LearnFlightDemo run={run} mode={responseKind} label={activeOption?.label || 'Custom gains'} /></Suspense>
          <div className="learn-comparison">
            <span>TRY EACH RESPONSE</span>
            <div role="group" aria-label={comparison.title}>{comparison.options.map((option) => <button key={option.id} className={demoMode === option.id ? 'active' : ''} onClick={() => chooseMode(option)}>{option.label}</button>)}</div>
            <p><i>↳</i>{activeOption?.copy || 'Custom gains are active. Watch the aircraft and compare its motion with the ghost target.'}</p>
          </div>
          <div className="learn-gain-controls">
            <GainSlider compact highlight={lesson.focus === 'p' || lesson.focus === 'method'} id="learn-p" term="P" label="Proportional" value={gains.kp} max={MAX_GAIN} step={0.05} onChange={(kp) => changeLearningGain('kp', kp)} />
            <GainSlider compact highlight={lesson.focus === 'i' || lesson.focus === 'method'} id="learn-i" term="I" label="Integral" value={gains.ki} max={MAX_GAIN} step={0.02} onChange={(ki) => changeLearningGain('ki', ki)} />
            <GainSlider compact highlight={lesson.focus === 'd' || lesson.focus === 'method'} id="learn-d" term="D" label="Derivative" value={gains.kd} max={MAX_GAIN} step={0.02} onChange={(kd) => changeLearningGain('kd', kd)} />
          </div>
          <div className="response-note" aria-live="polite"><b>{response[0]}</b><span>{response[1]}</span></div>
        </aside>
      </div>
    </section>
  );
}

function CodeModeSelector({ mode, onChange }) {
  const modes = [
    { id: 'manual', label: 'Manual mode', detail: 'Write and edit the PID controller yourself.', meta: 'Full editor · JavaScript or Python' },
    { id: 'helpful', label: 'No code mode', detail: 'Build working code through a guided, plain-language wizard.', meta: 'No coding experience needed' }
  ];
  return (
    <div className="code-mode-selector" role="radiogroup" aria-label="Code learning mode">
      {modes.map((item) => (
        <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => onChange(item.id)} role="radio" aria-checked={mode === item.id}>
          <span className="code-mode-icon" aria-hidden="true">{item.id === 'manual' ? '{ }' : '✦'}</span>
          <span><b>{item.label}</b><small>{item.detail}</small></span>
          <em>{item.meta}</em>
          <i aria-hidden="true">{mode === item.id ? '✓' : ''}</i>
        </button>
      ))}
    </div>
  );
}

function HelpfulCodeWizard({ language, source, completedSteps, activeStep, validationLabel, nextValidationLabel, validationComplete, testing, onLanguageChange, onSelectStep, onApplyStep, onRestart, onValidate, onContinueValidation, onContinueTune }) {
  const complete = completedSteps >= GUIDED_CONTROLLER_STEPS.length;
  const step = GUIDED_CONTROLLER_STEPS[activeStep];
  const viewingCompletedStep = !complete && activeStep < completedSteps;
  const preview = completedSteps ? source : buildGuidedController(language, 0);
  return (
    <div className="helpful-wizard">
      <div className="helpful-toolbar">
        <div className="language-tabs" role="tablist" aria-label="Programming language">
          {['javascript', 'python'].map((item) => <button key={item} className={language === item ? 'active' : ''} onClick={() => onLanguageChange(item)} role="tab" aria-selected={language === item}>{item === 'javascript' ? 'JavaScript' : 'Python'}</button>)}
        </div>
        <button className="ghost-btn small" onClick={onRestart}>Restart wizard</button>
      </div>
      <div className="helpful-progress">
        <div><span>GUIDED BUILD</span><b>{completedSteps} / {GUIDED_CONTROLLER_STEPS.length} steps added</b></div>
        <i><b style={{ width: `${completedSteps / GUIDED_CONTROLLER_STEPS.length * 100}%` }} /></i>
      </div>
      <div className="helpful-step-tabs" role="tablist" aria-label="Controller builder steps">
        {GUIDED_CONTROLLER_STEPS.map((item, index) => {
          const available = index <= completedSteps;
          const done = index < completedSteps;
          return (
            <button key={item.id} className={`${activeStep === index ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => onSelectStep(index)} disabled={!available} role="tab" aria-selected={activeStep === index}>
              <span>{done ? '✓' : index + 1}</span><b>{item.term}</b>
            </button>
          );
        })}
      </div>
      <div className="helpful-lesson" aria-live="polite">
        <p className="panel-label">Step {activeStep + 1} · {step.term}</p>
        <h3>{step.title}</h3>
        <p className="helpful-summary">{step.summary}</p>
        <div className="helpful-explanation"><span aria-hidden="true">?</span><p><b>What this means</b>{step.explanation}</p></div>
        <div className="helpful-addition"><span>CODE THIS STEP ADDS</span><pre><code>{step[language]}</code></pre></div>
        <div className="helpful-actions">
          {viewingCompletedStep ? (
            <button className="primary-btn" onClick={() => onSelectStep(activeStep + 1)}>Next explanation <span>→</span></button>
          ) : !complete ? (
            <button className="primary-btn" onClick={() => onApplyStep(activeStep)}>{step.action} <span>→</span></button>
          ) : validationComplete ? (
            <button className="primary-btn" id="continue-code" onClick={onContinueTune}>Continue to Tune <span>→</span></button>
          ) : nextValidationLabel ? (
            <button className="primary-btn" id="continue-code" onClick={onContinueValidation}>Continue to {nextValidationLabel} <span>→</span></button>
          ) : (
            <button className="run-btn" id="run-code" onClick={onValidate} disabled={testing}><span>▶</span> {testing ? 'Testing…' : `Run ${validationLabel} validation`}</button>
          )}
          <small>{validationComplete
            ? 'All three physical tests passed. Tune is now unlocked.'
            : nextValidationLabel
              ? `${validationLabel} passed. Continue when you are ready for the next angle.`
              : complete
                ? 'Your controller is complete. It must still pass all three physical tests.'
                : 'You can switch to Manual mode at any time to inspect or edit the generated code.'}</small>
        </div>
      </div>
      <details className="helpful-code-preview" open={complete}>
        <summary><span>Generated controller</span><b>{language === 'javascript' ? 'JAVASCRIPT' : 'PYTHON'} · READ ONLY</b></summary>
        <pre><code>{preview}</code></pre>
      </details>
    </div>
  );
}

function CodeView({ progress, updateProgress, toast, navigate }) {
  const scenarioPasses = progress.codeScenarioPasses || emptyCodeScenarioPasses();
  const passedStageCount = CODE_SCENARIOS.filter((item) => hasPassedCodeScenario(scenarioPasses, item.id)).length;
  const requiredScenario = nextCodeScenarioId(scenarioPasses);
  const [language, setLanguage] = useState(progress.language);
  const [code, setCode] = useState(progress.code);
  const [gains, setGains] = useState(progress.gains);
  const [codeMode, setCodeMode] = useState(progress.codeMode === 'helpful' ? 'helpful' : 'manual');
  const [helpfulStep, setHelpfulStep] = useState(Math.max(0, Math.min(GUIDED_CONTROLLER_STEPS.length, progress.helpfulStep || 0)));
  const [wizardStep, setWizardStep] = useState(Math.min(GUIDED_CONTROLLER_STEPS.length - 1, progress.helpfulStep || 0));
  const [result, setResult] = useState(() => ({
    status: progress.codePassed ? 'success' : 'idle',
    message: progress.codePassed
      ? 'All three validation stages passed. Controller stored in the flight computer.'
      : passedStageCount
        ? `${passedStageCount}/3 stages passed. Continue with ${scenarioDefinition(requiredScenario).label}.`
        : 'Stage 1 of 3: pass Easy 10° to unlock Medium.',
    run: null
  }));
  const [testing, setTesting] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [benchView, setBenchView] = useState('both');
  const [benchTime, setBenchTime] = useState(0);
  const [scenario, setScenario] = useState(isCodeScenario(progress.codeScenario) ? progress.codeScenario : DEFAULT_SCENARIO);
  const editorRef = useRef();
  const source = code[language];
  const editorExtensions = useMemo(() => controllerEditorExtensions(language), [language]);
  const diagnostics = useMemo(() => getControllerDiagnostics(language, source), [language, source]);
  const lintErrors = diagnostics.filter((item) => item.severity === 'error');

  const changeLanguage = (nextLanguage) => {
    if (nextLanguage === language) return;
    const updatedCode = codeMode === 'helpful'
      ? { ...code, [nextLanguage]: buildGuidedController(nextLanguage, helpfulStep) }
      : code;
    setLanguage(nextLanguage);
    setCode(updatedCode);
    if (codeMode === 'manual') {
      setHelpfulStep(0);
      setWizardStep(0);
    }
    setScenario(DEFAULT_SCENARIO);
    setBenchTime(0);
    setResult({ status: 'idle', message: 'Language changed. Start the validation path again with Easy 10°.', run: null });
    updateProgress({ language: nextLanguage, code: updatedCode, helpfulStep: codeMode === 'helpful' ? helpfulStep : 0, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const changeCode = (value) => {
    const updated = { ...code, [language]: value };
    setCode(updated);
    setHelpfulStep(0);
    setWizardStep(0);
    setScenario(DEFAULT_SCENARIO);
    setResult({ status: 'idle', message: 'Controller changed. Validation reset — begin again with Easy 10°.', run: null });
    setBenchTime(0);
    updateProgress({ code: updated, helpfulStep: 0, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const changeGain = (key, value) => {
    const updated = { ...gains, [key]: value };
    setGains(updated);
    setScenario(DEFAULT_SCENARIO);
    setResult({ status: 'idle', message: 'PID gains changed. Validation reset — begin again with Easy 10°.', run: null });
    setBenchTime(0);
    updateProgress({ gains: updated, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const selectCodeMode = (nextMode) => {
    if (nextMode === codeMode) return;
    setCodeMode(nextMode);
    setResult({ status: 'idle', message: nextMode === 'helpful' ? 'No code mode ready. Add each controller step, then begin validation.' : 'Manual editor ready. Your current controller is available to inspect or change.', run: null });
    updateProgress({ codeMode: nextMode });
  };
  const applyGuidedStep = (stepIndex) => {
    if (stepIndex !== helpfulStep || helpfulStep >= GUIDED_CONTROLLER_STEPS.length) return;
    const nextStep = helpfulStep + 1;
    const updatedCode = { ...code, [language]: buildGuidedController(language, nextStep) };
    const updatedGains = gainsForGuidedStep(nextStep);
    setCode(updatedCode);
    setGains(updatedGains);
    setHelpfulStep(nextStep);
    setWizardStep(Math.min(nextStep, GUIDED_CONTROLLER_STEPS.length - 1));
    setScenario(DEFAULT_SCENARIO);
    setBenchTime(0);
    setResult({
      status: 'idle',
      message: nextStep === GUIDED_CONTROLLER_STEPS.length
        ? 'Controller assembled. Run Easy 10° to begin the physical validation path.'
        : `${GUIDED_CONTROLLER_STEPS[stepIndex].term} added. Continue to ${GUIDED_CONTROLLER_STEPS[nextStep].term}.`,
      run: null
    });
    updateProgress({
      codeMode: 'helpful',
      helpfulStep: nextStep,
      code: updatedCode,
      gains: updatedGains,
      ...clearCodeValidation(),
      tunePassed: false,
      tuneWarning: false,
      tuneScore: null,
      tuneWeakest: null
    });
    toast(nextStep === GUIDED_CONTROLLER_STEPS.length ? 'Safe PID controller assembled' : `${GUIDED_CONTROLLER_STEPS[stepIndex].term} added to your controller`);
  };
  const restartHelpfulWizard = () => {
    const updatedCode = { ...code, [language]: buildGuidedController(language, 0) };
    const updatedGains = gainsForGuidedStep(0);
    setCode(updatedCode);
    setGains(updatedGains);
    setHelpfulStep(0);
    setWizardStep(0);
    setScenario(DEFAULT_SCENARIO);
    setBenchTime(0);
    setResult({ status: 'idle', message: 'Wizard restarted. Begin by adding proportional control.', run: null });
    updateProgress({ code: updatedCode, gains: updatedGains, helpfulStep: 0, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const changeScenario = (nextScenario) => {
    if (!isCodeScenarioUnlocked(nextScenario, scenarioPasses)) {
      toast(`Pass ${scenarioDefinition(requiredScenario).label} first`);
      return;
    }
    setScenario(nextScenario);
    setBenchTime(0);
    setResult({ status: 'idle', message: `${scenarioDefinition(nextScenario).headline} selected. Run validation to replay this test.`, run: null });
    updateProgress({ codeScenario: nextScenario });
  };
  const validate = () => {
    if (codeMode === 'helpful' && helpfulStep < GUIDED_CONTROLLER_STEPS.length) {
      setResult({ status: 'error', message: 'Finish all four No code mode steps before running the aircraft test.', run: null });
      return;
    }
    if (lintErrors.length) {
      setResult({ status: 'error', message: `Fix ${lintErrors.length === 1 ? 'the lint error' : `${lintErrors.length} lint errors`} before starting the aircraft test.`, run: null });
      showControllerDiagnostics(editorRef);
      return;
    }
    setTesting(true);
    setBenchTime(0);
    setResult({ status: 'idle', message: 'Compiling controller and starting the Rapier rigid-body test…', run: null });
    window.setTimeout(async () => {
      try {
        const controller = compileController(language, source);
        const probe = controller(0.1, 1 / 60, createMemory(), gains);
        if (!Number.isFinite(Number(probe))) throw new Error('pid() must return a finite number.');
        const run = await simulateRapierTuning(controller, scenario, gains);
        if (run.invalidOutput) throw new Error('pid() returned an invalid number during the test.');
        const passed = run.score >= 58 && run.steadyError < 5;
        if (passed) {
          const nextPasses = { ...scenarioPasses, [scenario]: run.score };
          const nextRequiredScenario = nextCodeScenarioId(nextPasses);
          const sequenceComplete = nextRequiredScenario == null;
          updateProgress({
            codePassed: sequenceComplete,
            codeRequirementVersion: CODE_REQUIREMENT_VERSION,
            codeScenarioPasses: nextPasses,
            language,
            code,
            validated: { language, source }
          });
          setResult({
            status: 'success',
            message: sequenceComplete
              ? `PASS — score ${run.score}/100 on Hard 32°. All stages complete; Tune is unlocked.`
              : `PASS — score ${run.score}/100 on ${scenarioDefinition(scenario).label}. ${scenarioDefinition(nextRequiredScenario).label} is now unlocked.`,
            run
          });
          toast(sequenceComplete ? 'Validation path complete — Tune unlocked' : `${scenarioDefinition(nextRequiredScenario).label} unlocked`);
        } else {
          updateProgress({ code });
          setResult({ status: 'error', message: `NOT YET — score ${run.score}/100. Aim for less than 5° steady error and a score of 58+.`, run });
        }
      } catch (error) {
        updateProgress({ code });
        const time = error.simulationTime == null ? '' : ` at t=${error.simulationTime.toFixed(2)}s`;
        setResult({ status: 'error', message: `${error.message}${time}`, run: null });
      } finally { setTesting(false); }
    }, 280);
  };

  let benchMotion = 'balanced';
  if (result.run) {
    if (gains.kp < 0.45) benchMotion = 'weak';
    else if (gains.ki > 0.9) benchMotion = 'windup';
    else if (gains.kd > 1.5) benchMotion = 'damped';
    else if (result.run.overshoot > 45 || result.run.score < 30) benchMotion = 'oscillation';
  }
  const benchLabel = testing
    ? 'Rapier test running'
    : result.run
      ? `${result.status === 'success' ? 'Validated' : 'Unstable'} user controller`
      : 'Awaiting user controller run';
  const selectBenchView = (nextView) => { setBenchTime(0); setBenchView(nextView); };
  const nextStageAction = result.status === 'success' && !progress.codePassed ? nextCodeScenarioId(scenarioPasses) : null;
  const flightReplay = (className = '') => <Suspense fallback={<div className="learn-flight-loading code-flight-loading">Loading aircraft…</div>}><LearnFlightDemo className={`code-flight-demo ${className}`} run={result.run} mode={benchMotion} label={benchLabel} idle={!result.run} onTime={benchView === 'both' ? setBenchTime : undefined} /></Suspense>;
  const responseGraph = (synced = false) => <div className="code-graph-pane"><ResponseChart run={result.run} showError playbackTime={synced ? benchTime : null} animate={!synced} /><ResponseLegend /></div>;

  return (
    <section className="view active" id="code-view" aria-labelledby="code-title">
      <div className="view-head compact-head"><div><p className="eyebrow"><span>Module 02</span> Controller workshop</p><h1 id="code-title">Build the <em>flight brain.</em></h1><p className="lede">Begin with proportional control, then add memory and damping one piece at a time. Every run steps the same Rapier aircraft used in Tune, Practice, and Race.</p></div><div className={`module-status ${progress.codePassed ? 'passed' : ''}`}><i /><span>{progress.codePassed ? 'Controller validated' : 'Validation pending'}</span></div></div>
      <CodeModeSelector mode={codeMode} onChange={selectCodeMode} />
      <div className="code-workspace">
        <div className={`editor-panel panel code-mode-${codeMode}`}>
          {codeMode === 'manual' ? (
            <>
              <div className="editor-toolbar">
                <div className="language-tabs" role="tablist" aria-label="Programming language">
                  {['javascript', 'python'].map((item) => <button key={item} className={language === item ? 'active' : ''} onClick={() => changeLanguage(item)} role="tab" aria-selected={language === item}>{item === 'javascript' ? 'JavaScript' : 'Python'}</button>)}
                </div>
                <div className="editor-actions">
                  <button className="ghost-btn" onClick={() => changeCode(defaultCode[language])}>Reset</button>
                  <button className="run-btn" id="run-code" onClick={validate} disabled={testing}><span>▶</span> {testing ? 'Testing…' : 'Run validation'}</button>
                </div>
              </div>
              <div className="code-editor-wrap" onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  validate();
                }
              }}>
                <CodeMirror
                  ref={editorRef}
                  value={source}
                  height="100%"
                  theme="none"
                  extensions={editorExtensions}
                  basicSetup={{
                    foldGutter: false,
                    syntaxHighlighting: false,
                    highlightActiveLine: true,
                    highlightActiveLineGutter: true,
                    highlightSelectionMatches: true,
                    autocompletion: true,
                    lintKeymap: true,
                    tabSize: 2
                  }}
                  indentWithTab={false}
                  onChange={changeCode}
                />
              </div>
            </>
          ) : (
            <HelpfulCodeWizard
              language={language}
              source={source}
              completedSteps={helpfulStep}
              activeStep={wizardStep}
              validationLabel={scenarioDefinition(scenario).label}
              nextValidationLabel={nextStageAction ? scenarioDefinition(nextStageAction).label : null}
              validationComplete={progress.codePassed}
              testing={testing}
              onLanguageChange={changeLanguage}
              onSelectStep={(index) => setWizardStep(Math.max(0, Math.min(GUIDED_CONTROLLER_STEPS.length - 1, index)))}
              onApplyStep={applyGuidedStep}
              onRestart={restartHelpfulWizard}
              onValidate={validate}
              onContinueValidation={() => changeScenario(nextStageAction)}
              onContinueTune={() => navigate('tune')}
            />
          )}
          <div className={`console ${result.status}`} aria-live="polite">
            <span className="console-prompt">{result.status === 'success' ? '✓' : result.status === 'error' ? '×' : '›'}</span>
            <span className="console-message">{result.message}</span>
            {codeMode === 'manual' && nextStageAction && <button className="console-next stage-next" onClick={() => changeScenario(nextStageAction)}>Continue to {scenarioDefinition(nextStageAction).label} <span aria-hidden="true">→</span></button>}
            {codeMode === 'manual' && progress.codePassed && <button className="console-next" onClick={() => navigate('tune')}>Continue to Tune <span aria-hidden="true">→</span></button>}
          </div>
        </div>
        <aside className="test-panel panel">
          <div className="panel-title"><div><p className="panel-label">Rapier bench 02-A</p><h3>Physical attitude test</h3></div><span className="test-id">8.0 SEC</span></div>
          <div className="code-gains"><div className="code-gains-head"><span>{codeMode === 'helpful' ? 'WIZARD-SELECTED PID VALUES' : 'PID VALUES'}</span>{codeMode === 'helpful' && <small>Editable for experimentation</small>}</div><div className="code-gain-grid"><GainSlider compact id="code-p" term="P" label="Proportional" value={gains.kp} max={MAX_GAIN} step={0.1} onChange={(value) => changeGain('kp', value)} /><GainSlider compact id="code-i" term="I" label="Integral" value={gains.ki} max={MAX_GAIN} step={0.02} onChange={(value) => changeGain('ki', value)} /><GainSlider compact id="code-d" term="D" label="Derivative" value={gains.kd} max={MAX_GAIN} step={0.05} onChange={(value) => changeGain('kd', value)} /></div></div>
          <div className="code-scenarios"><CodeScenarioProgress value={scenario} onChange={changeScenario} passes={scenarioPasses} /></div>
          <div className="code-visual-toolbar"><div><span>USER PID OUTPUT</span><b>{result.run ? 'Replay the physical test' : 'Run your code to begin'}</b></div><div role="tablist" aria-label="Bench visualization"><button className={benchView === 'both' ? 'active' : ''} onClick={() => selectBenchView('both')} role="tab" aria-selected={benchView === 'both'}>3D + graph</button><button className={benchView === 'three' ? 'active' : ''} onClick={() => selectBenchView('three')} role="tab" aria-selected={benchView === 'three'}>3D only</button><button className={benchView === 'graph' ? 'active' : ''} onClick={() => selectBenchView('graph')} role="tab" aria-selected={benchView === 'graph'}>Graph only</button></div></div>
          <div className={`code-visual-stage view-${benchView}`}>{benchView === 'both' ? <div className="code-visual-split"><div className="code-flight-pane">{flightReplay('code-flight-split')}</div>{responseGraph(true)}</div> : benchView === 'three' ? flightReplay() : responseGraph()}</div>
          <div className="metrics-row"><div><span>RMS error</span><b id="code-rms">{result.run ? result.run.rms.toFixed(1) : '—'}</b><small>degrees</small></div><div><span>Overshoot</span><b id="code-overshoot">{result.run ? Math.round(result.run.overshoot) : '—'}</b><small>percent</small></div><div><span>Control score</span><b id="code-score">{result.run?.score ?? '—'}</b><small>/ 100</small></div></div>
          {codeMode === 'manual' ? (
            <div className="pid-guide">
              <div className="pid-guide-head"><div><p className="panel-label">Build your controller</p><h4>{pidGuide[guideStep].title}</h4></div><span>EDIT → RUN → OBSERVE</span></div>
              <div className="pid-guide-tabs" role="tablist" aria-label="PID build steps">{pidGuide.map((step, index) => <button key={step.term} className={guideStep === index ? 'active' : ''} onClick={() => setGuideStep(index)} role="tab">{step.term}</button>)}</div>
              <p>{pidGuide[guideStep].body}</p>
              <pre><code>{pidGuide[guideStep][language]}</code></pre>
            </div>
          ) : (
            <div className="helpful-bench-note">
              <span aria-hidden="true">✦</span><p><b>The same real test</b>No code mode writes the controller, but it does not fake the result. Your generated code still flies the Rapier aircraft and must pass every angle.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function tuningAdvice(gains, run, scenario) {
  if (!run) return 'Stepping the flight rigid body and measuring its attitude response…';
  if (gains.kp < 0.5) return 'The response lacks authority. Raise P until the aircraft reaches its command quickly.';
  if (run.overshoot > 35) return 'The response is overshooting. Add D for damping, or back P down slightly.';
  if (scenario === 'payload' && run.steadyError > 2) return 'The payload leaves a constant bias. Add a little I to remove the remaining error.';
  if (run.settling > 5 && run.overshoot < 5) return 'The controller is heavily damped. Reduce D if the aircraft feels slow to react.';
  if (gains.ki > 0.85) return 'Integral is accumulating aggressively. Reduce I to avoid slow, swelling oscillation.';
  return `This is a stable response. Compare all ${SCENARIOS.length} scenarios before saving the tune.`;
}

function TuneView({ progress, updateProgress, toast, navigate }) {
  const [gains, setGains] = useState(progress.gains);
  const [scenario, setScenario] = useState(isScenario(progress.scenario) ? progress.scenario : DEFAULT_SCENARIO);
  const [simTime, setSimTime] = useState(0);
  const [combinedScore, setCombinedScore] = useState(null);
  const [run, setRun] = useState(null);
  const [simulating, setSimulating] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState(null);
  const controller = useMemo(() => {
    const language = progress.language || 'javascript';
    const source = progress.code?.[language];
    if (!source) return builtInController(gains);
    try {
      return compileController(language, source);
    } catch {
      return null;
    }
  }, [gains, progress.code, progress.language]);
  useEffect(() => {
    let cancelled = false;
    if (!controller) {
      setRun(null);
      setSimulating(false);
      return () => { cancelled = true; };
    }
    setSimulating(true);
    simulateRapierTuning(controller, scenario, gains)
      .then((result) => { if (!cancelled) setRun(result); })
      .catch(() => { if (!cancelled) setRun(null); })
      .finally(() => { if (!cancelled) setSimulating(false); });
    return () => { cancelled = true; };
  }, [controller, gains, scenario]);
  const selectScenario = (nextScenario) => {
    setScenario(nextScenario);
    setCombinedScore(null);
    updateProgress({ scenario: nextScenario });
  };
  const setGain = (key, value) => {
    const updated = { ...gains, [key]: value };
    setCombinedScore(null);
    setGains(updated);
    updateProgress({ gains: updated, tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const save = async () => {
    setSaving(true);
    try {
      if (!controller) throw new Error('Controller source is not valid.');
      const runs = await Promise.all(TUNE_CHECK_SCENARIOS.map((item) => simulateRapierTuning(controller, item, gains)));
      const score = Math.round(runs.reduce((sum, item) => sum + item.score, 0) / runs.length);
      setCombinedScore(score);
      const weakest = runs.reduce((lowest, item, index) => item.score < lowest.score
        ? { name: ['roll', 'yaw', 'gust', 'payload'][index], score: item.score }
        : lowest, { name: 'roll', score: runs[0].score });
      const needsWarning = score < TUNE_PASS_SCORE || weakest.score < TUNE_SCENARIO_FLOOR;
      updateProgress({
        gains,
        tunePassed: true,
        tuneRequirementVersion: TUNE_REQUIREMENT_VERSION,
        tuneScore: score,
        tuneWarning: needsWarning,
        tuneWeakest: weakest
      });
      if (!needsWarning) {
        toast(`Tune saved — ${score}/100 combined, weakest ${weakest.score}`);
      } else {
        setWarning({ score, weakest });
        toast(`Tune saved with warning — ${score}/100`);
      }
    } catch {
      updateProgress({ tunePassed: false });
      toast('Physics check failed — verify the controller and try again');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="view active" id="tune-view" aria-labelledby="tune-title">
      <div className="view-head compact-head"><div><p className="eyebrow"><span>Module 03</span> Tuning bay</p><h1 id="tune-title">Shape the <em>response.</em></h1><p className="lede">Compare the 10°, 20°, and 32° steps, then explore direction changes and disturbances across the full envelope. Reach {TUNE_PASS_SCORE} combined with every flight check above {TUNE_SCENARIO_FLOOR}.</p></div><ScenarioSelector value={scenario} onChange={selectScenario} /></div>
      <div className="tune-grid"><aside className="tuner-panel panel"><div className="panel-title"><div><p className="panel-label">Gain controls</p><h3>Attitude controller</h3></div><button className="ghost-btn small" onClick={() => { const reset = { kp: 1, ki: 0, kd: 0 }; setGains(reset); setCombinedScore(null); updateProgress({ gains: reset, tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null }); }}>Reset gains</button></div><GainSlider id="tune-p" term="P" label="Proportional" help="Immediate correction" value={gains.kp} max={MAX_GAIN} step={0.1} onChange={(value) => setGain('kp', value)} /><GainSlider id="tune-i" term="I" label="Integral" help="Removes steady error" value={gains.ki} max={MAX_GAIN} step={0.02} onChange={(value) => setGain('ki', value)} /><GainSlider id="tune-d" term="D" label="Derivative" help="Damps fast motion" value={gains.kd} max={MAX_GAIN} step={0.05} onChange={(value) => setGain('kd', value)} /><div className="tuning-tip"><span>COACH</span><p>{controller ? tuningAdvice(gains, run, scenario) : 'Fix the current Code tab controller before running this scenario.'}</p></div><button className="primary-btn full" id="save-tune" onClick={save} disabled={saving || !controller}>{!controller ? 'Fix controller in Code' : saving ? 'Running 4 physics checks…' : 'Save tune & run check'} <span>→</span></button>{progress.tunePassed && <button className="tune-practice-btn" id="go-practice" onClick={() => navigate('practice')}><span>TUNE SAVED · {progress.tuneScore}/100{progress.tuneWarning ? ' · WARNING' : ''}</span><b>Go to Practice flying <i>→</i></b></button>}</aside>
        <div className="sim-panel panel"><div className="sim-toolbar"><div><span className="live-dot">{simulating ? 'SOLVING' : 'RAPIER TRACE'}</span><b>{scenarioDefinition(scenario).headline}</b></div><div className="sim-clock"><span>RAPIER ATTITUDE</span><b>{simTime.toFixed(1).padStart(4, '0')} s</b></div></div><div className="tune-visual tune-response-graph"><ResponseChart run={run} showError animate onTime={setSimTime} id="tune-chart" /><ResponseLegend /><div className={`wind-callout ${scenario === 'gust' ? 'visible' : ''}`}>WIND GUST <span>→</span></div></div><div className="metrics-row tune-metrics"><div><span>Settling time</span><b>{run ? run.settling.toFixed(1) : '—'}</b><small>seconds</small></div><div><span>Peak overshoot</span><b>{run ? Math.round(run.overshoot) : '—'}</b><small>percent</small></div><div><span>Steady error</span><b>{run ? run.steadyError.toFixed(1) : '—'}</b><small>degrees</small></div><div className="score-metric"><span>Stability score</span><b id="tune-score">{combinedScore ?? run?.score ?? '—'}</b><small>/ 100</small></div></div></div>
      </div>
      {warning && <TuneWarningDialog score={warning.score} weakest={warning.weakest} onClose={() => setWarning(null)} onProceed={() => { setWarning(null); navigate('practice'); }} proceedLabel="Practice anyway →" />}
    </section>
  );
}

function ChallengeReadyDialog({ best, onStart, onPractice }) {
  return (
    <div className="race-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="challenge-ready-title">
      <div className="race-dialog">
        <span className="race-dialog-icon" aria-hidden="true">⚑</span>
        <p className="eyebrow"><span>Training complete</span> Challenge unlocked</p>
        <h2 id="challenge-ready-title">You’re ready for the Neon Gauntlet.</h2>
        <p>Twelve narrower gates, hard elevation changes, and real frame collisions. Follow the paired floor lights, turn into each gate, and race the clock.</p>
        <div className="race-dialog-stats">
          <span><b>{RACE_GATES.length}</b> gates</span>
          <span><b>{formatRaceTime(RACE_PAR_SECONDS)}</b> par</span>
          <span><b>{best ? formatRaceTime(best) : '—'}</b> personal best</span>
        </div>
        <div className="race-dialog-actions">
          <button className="ghost-btn" onClick={onPractice}>Keep practising</button>
          <button className="primary-btn" onClick={onStart} autoFocus>Open Race <span>→</span></button>
        </div>
      </div>
    </div>
  );
}

function RaceResultDialog({ result, best, onRestart, onTraining }) {
  const underPar = result.time <= RACE_PAR_SECONDS;
  return (
    <div className="race-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="race-result-title">
      <div className="race-dialog result-dialog">
        <span className="race-dialog-icon finish" aria-hidden="true">✓</span>
        <p className="eyebrow"><span>Challenge complete</span> All {RACE_GATES.length} gates cleared</p>
        <h2 id="race-result-title">{result.isBest ? 'New personal best.' : 'Finish line crossed.'}</h2>
        <div className="race-result-time">{formatRaceTime(result.time)}</div>
        <p>{underPar
          ? `You beat the ${formatRaceTime(RACE_PAR_SECONDS)} par time by ${formatRaceTime(RACE_PAR_SECONDS - result.time)}.`
          : `Clean run. Find ${formatRaceTime(result.time - RACE_PAR_SECONDS)} to beat the ${formatRaceTime(RACE_PAR_SECONDS)} par time.`}</p>
        <div className="race-dialog-stats result-stats">
          <span><b>{formatRaceTime(best)}</b> personal best</span>
          <span><b>{underPar ? 'PAR BEATEN' : 'FINISHED'}</b> result</span>
        </div>
        <div className="race-dialog-actions">
          <button className="ghost-btn" onClick={onTraining}>Training range</button>
          <button className="primary-btn" onClick={onRestart} autoFocus>Race again <span>→</span></button>
        </div>
      </div>
    </div>
  );
}

function FlightView({ mode, progress, updateProgress, navigate, toast }) {
  const [launched, setLaunched] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [telemetry, setTelemetry] = useState(() => initialFlightTelemetry(mode));
  const [warningOpen, setWarningOpen] = useState(false);
  const [challengeReady, setChallengeReady] = useState(false);
  const [raceCountdown, setRaceCountdown] = useState(null);
  const [raceResult, setRaceResult] = useState(null);
  const ready = mode === 'race' ? progress.practicePassed : progress.tunePassed;
  const controllerWarning = !progress.codePassed || !progress.validated?.source;
  const hasFlightWarning = progress.tuneWarning || controllerWarning;
  const gates = gatesForMode(mode);
  const checkpoint = telemetry.checkpoint;
  const countingDown = mode === 'race' && raceCountdown > 0;
  const flightActive = launched && !challengeReady && !raceResult && !countingDown;
  const controller = useMemo(() => {
    const language = progress.validated?.language || progress.language;
    const source = progress.validated?.source || progress.code?.[language];
    if (!source) return null;
    try { return compileController(language, source); } catch { return null; }
  }, [progress.code, progress.language, progress.validated]);
  useEffect(() => {
    if (!countingDown) return undefined;
    const timer = window.setTimeout(() => setRaceCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countingDown, raceCountdown]);
  useEffect(() => {
    if (mode === 'race' && raceCountdown === 0) toast('GO — challenge clock running');
  }, [mode, raceCountdown, toast]);
  useEffect(() => {
    if (mode === 'training'
      && launched
      && telemetry.checkpoint >= TRAINING_GATES.length
      && !challengeReady) {
      if (!progress.practicePassed) updateProgress({ practicePassed: true });
      setChallengeReady(true);
    }
  }, [challengeReady, launched, mode, progress.practicePassed, telemetry.checkpoint, updateProgress]);

  const arm = () => {
    setWarningOpen(false);
    setTelemetry(initialFlightTelemetry('training'));
    setLaunched(true);
    setResetSignal((value) => value + 1);
    toast('Three.js flight controller armed — use W A S D to move');
  };
  const launch = () => {
    if (!ready) return;
    if (hasFlightWarning) setWarningOpen(true);
    else arm();
  };
  const onCheckpoint = useCallback((nextCheckpoint, elapsed) => {
    const courseLength = mode === 'race' ? RACE_GATES.length : TRAINING_GATES.length;
    if (nextCheckpoint < courseLength) {
      toast(mode === 'race'
        ? `Gate ${nextCheckpoint} of ${courseLength} cleared`
        : `Checkpoint ${nextCheckpoint} cleared`);
      return;
    }
    if (mode === 'training') {
      updateProgress({ practicePassed: true });
      setChallengeReady(true);
      toast('Training complete — timed challenge unlocked');
      return;
    }
    const time = Math.max(0.1, elapsed);
    const isBest = !progress.raceBest || time < progress.raceBest;
    if (isBest) updateProgress({ raceBest: time });
    setRaceCountdown(null);
    setRaceResult({ time, isBest });
    toast(isBest ? 'Challenge complete — new personal best' : 'Challenge complete — finish time recorded');
  }, [mode, progress.raceBest, toast, updateProgress]);
  const onTelemetry = useCallback((data) => setTelemetry(data), []);
  const startRace = () => {
    setRaceResult(null);
    setRaceCountdown(3);
    setTelemetry(initialFlightTelemetry('race'));
    setLaunched(true);
    setResetSignal((value) => value + 1);
  };
  const keepPractising = () => {
    setChallengeReady(false);
    setTelemetry(initialFlightTelemetry('training'));
    setResetSignal((value) => value + 1);
    toast('Training range reset');
  };
  const restartRace = () => {
    setRaceResult(null);
    setRaceCountdown(3);
    setTelemetry(initialFlightTelemetry('race'));
    setResetSignal((value) => value + 1);
  };
  const returnToTraining = () => {
    navigate('practice');
  };
  const resetFlight = () => {
    setTelemetry(initialFlightTelemetry(mode));
    setResetSignal((value) => value + 1);
    if (mode === 'race') {
      setRaceResult(null);
      setRaceCountdown(3);
      toast('Race reset — clock starts after the countdown');
    } else {
      toast('Aircraft returned to launch position');
    }
  };
  const status = countingDown ? 'COUNTDOWN' : flightActive ? (mode === 'race' ? 'RACING' : 'ACTIVE') : launched ? 'PAUSED' : 'STANDBY';
  const bestTime = raceResult
    ? Math.min(progress.raceBest ?? Infinity, raceResult.time)
    : progress.raceBest;

  return (
    <section className="view active fly-view" id={`${mode === 'race' ? 'race' : 'practice'}-view`} aria-labelledby={`${mode === 'race' ? 'race' : 'practice'}-title`}>
      <div className={`flight-frame ${mode === 'race' ? 'race-mode' : ''}`}>
        <div className="flight-canvas-slot">
          <Suspense fallback={<div className="three-loading"><span>Loading Three.js flight world…</span></div>}>
            <FlightScene mode={mode} launched={flightActive} controller={controller} gains={progress.gains} resetSignal={resetSignal} onTelemetry={onTelemetry} onCheckpoint={onCheckpoint} />
          </Suspense>
        </div>
        <div className="flight-topbar"><div><p className="eyebrow"><span>Module {mode === 'race' ? '05' : '04'}</span> {mode === 'race' ? 'Timed championship course' : 'Practice range · Rapier 6-DOF flight'}</p><h1 id={`${mode === 'race' ? 'race' : 'practice'}-title`}>{mode === 'race' ? <>Neon Gauntlet <em>Race</em></> : <>Practice Range <em>Alpha</em></>}</h1></div><div className={`flight-status ${flightActive ? 'live' : ''}`}><span><i /> FLIGHT SYSTEMS</span><b>{status}</b></div></div>
        <div className="flight-hud left-hud"><div className="hud-block"><span>ALTITUDE</span><b>{telemetry.altitude.toFixed(1)}</b><small>METERS</small></div><div className="hud-block"><span>AIRSPEED</span><b>{telemetry.speed.toFixed(1)}</b><small>M / S</small></div><div className="hud-block"><span>ATTITUDE</span><b>{Math.round(telemetry.tilt)}°</b><small>{Math.round(telemetry.commandedTilt)}° COMMAND</small></div><div className="hud-block"><span>HEADING</span><b>{String(Math.round(telemetry.heading)).padStart(3, '0')}</b><small>DEGREES</small></div></div>
        <div className="flight-hud right-hud">
          <div className="battery"><span>BATTERY</span><b>{Math.round(telemetry.battery)}%</b><i><em style={{ width: `${telemetry.battery}%` }} /></i></div>
          <div className="controller-chip"><span>USER CONTROLLER · 4 AXES</span><b>{telemetry.controllerFault ? 'FALLBACK ACTIVE' : progress.validated ? `${progress.validated.language.toUpperCase()} PID` : `${progress.language.toUpperCase()} · UNVALIDATED`}</b></div>
          <div className="motor-mixer"><span>MOTOR THRUST · %</span><div>{telemetry.motors.map((motor, index) => <b key={index}>M{index + 1}<em>{motor}</em></b>)}</div></div>
          <div className="controller-chip render-chip"><span>PHYSICS / RENDERER</span><b>RAPIER · THREE.JS</b></div>
        </div>
        {mode === 'race' ? (
          <div className={`race-hud ${telemetry.elapsed > RACE_PAR_SECONDS ? 'over-par' : ''}`}>
            <span>TIMED CHALLENGE · PAR {formatRaceTime(RACE_PAR_SECONDS)}</span>
            <b>{formatRaceTime(raceResult?.time ?? telemetry.elapsed)}</b>
            <small>GATE {String(Math.min(checkpoint + 1, gates.length)).padStart(2, '0')} / {gates.length} · {telemetry.distance.toFixed(0)} M TO TARGET</small>
            <i><em style={{ width: `${Math.min(100, checkpoint / gates.length * 100)}%` }} /></i>
          </div>
        ) : (
          <div className="flight-message"><span>{checkpoint >= TRAINING_GATES.length ? 'COURSE COMPLETE' : `CHECKPOINT 0${checkpoint + 1}`}</span><b>{checkpoint >= TRAINING_GATES.length ? 'Control loop proven in flight' : 'Fly through the illuminated gate'}</b><small>{checkpoint >= TRAINING_GATES.length ? 'All checkpoints cleared' : `${telemetry.distance.toFixed(0)} m to target`}</small></div>
        )}
        <div className="flight-controls"><div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Tilt ·32° / speed</span></div><div><kbd>↑</kbd><kbd>↓</kbd><span>Altitude</span></div><div><kbd>←</kbd><kbd>→</kbd><span>Yaw</span></div><button onClick={resetFlight}>Reset {mode === 'race' ? 'race' : 'flight'}</button></div>
        {mode === 'race' ? (
          <div className={`launch-overlay ${launched ? 'hidden' : ''}`}>
            <div className="launch-card race-start-card">
              <span className="launch-icon race-launch-icon" aria-hidden="true">⚑</span>
              <p className="eyebrow"><span>Race unlocked</span> Neon Gauntlet</p>
              <h2>Thread every gate. Beat the clock.</h2>
              <p>The paired floor lights mark the racing line. Twelve narrow, collidable gates demand sharper turns and altitude control than Practice.</p>
              <div className="race-dialog-stats race-start-stats"><span><b>{RACE_GATES.length}</b> gates</span><span><b>{formatRaceTime(RACE_PAR_SECONDS)}</b> par</span><span><b>{progress.raceBest ? formatRaceTime(progress.raceBest) : '—'}</b> personal best</span></div>
              <button className="primary-btn full" id="launch-race" onClick={startRace}>Start race <span>→</span></button>
            </div>
          </div>
        ) : (
          <div className={`launch-overlay ${launched ? 'hidden' : ''}`}><div className="launch-card"><span className="launch-icon" aria-hidden="true">⌁</span><p className="eyebrow"><span>Pre-flight check</span></p><h2>Your controller earns the controls.</h2><p>Save a tune for the full 32° flight envelope. Low scores and unvalidated controllers remain flyable after a warning.</p><div className="checklist"><button onClick={() => navigate('code')}><i className={progress.codePassed ? 'done' : 'warning'}>{progress.codePassed ? '✓' : '!'}</i><span><b>Controller validation</b><small>{progress.codePassed ? 'Bench test passed' : 'Not validated · flight warning'}</small></span><em>Open code lab →</em></button><button onClick={() => navigate('tune')}><i className={progress.tunePassed ? (progress.tuneWarning ? 'warning' : 'done') : ''}>{progress.tunePassed ? (progress.tuneWarning ? '!' : '✓') : '○'}</i><span><b>Flight-envelope tune</b><small>{progress.tunePassed ? `${progress.tuneScore}/100 saved${progress.tuneWarning ? ' · stability warning' : ''}` : `Save any score · ${TUNE_PASS_SCORE}+ recommended`}</small></span><em>Open tuning bay →</em></button></div><button className="primary-btn full" id="launch-flight" onClick={launch} disabled={!ready}>Launch Practice <span>→</span></button></div></div>
        )}
        {mode === 'training' && warningOpen && <TuneWarningDialog score={progress.tuneScore} weakest={progress.tuneWeakest} controllerWarning={controllerWarning} onClose={() => { setWarningOpen(false); navigate(controllerWarning ? 'code' : 'tune'); }} onProceed={arm} proceedLabel="Practice anyway" />}
        {mode === 'training' && challengeReady && <ChallengeReadyDialog best={progress.raceBest} onStart={() => navigate('race')} onPractice={keepPractising} />}
        {countingDown && <div className="race-countdown" aria-live="assertive"><span>RACE STARTS IN</span><b key={raceCountdown}>{raceCountdown}</b><small>Follow the bright floor lights</small></div>}
        {raceResult && <RaceResultDialog result={raceResult} best={bestTime} onRestart={restartRace} onTraining={returnToTraining} />}
      </div>
    </section>
  );
}

export default function App() {
  const [progress, setProgress] = useState(loadProgress);
  const [view, setView] = useState(() => resolveView(location.hash.slice(1), progress));
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }, [progress]);
  useEffect(() => {
    const unlockProgress = {
      learned: progress.learned,
      codePassed: progress.codePassed,
      tunePassed: progress.tunePassed,
      practicePassed: progress.practicePassed
    };
    const hashChange = () => {
      const next = resolveView(location.hash.slice(1), unlockProgress);
      setView(next);
      if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
    };
    window.addEventListener('hashchange', hashChange);
    hashChange();
    return () => window.removeEventListener('hashchange', hashChange);
  }, [progress.learned, progress.codePassed, progress.tunePassed, progress.practicePassed]);
  const updateProgress = useCallback((patch) => setProgress((current) => ({ ...current, ...patch })), []);
  const toast = useCallback((message) => {
    setToastMessage(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(''), 2600);
  }, []);
  const navigate = useCallback((requested) => {
    const legacySafe = requested === 'fly' ? 'practice' : requested;
    const next = COURSE_NAVIGATION.some((item) => item.id === legacySafe) ? legacySafe : 'learn';
    setView(next); history.replaceState(null, '', `#${next}`); window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const completeLearn = () => { updateProgress({ learned: true }); toast('Foundations complete — welcome to the Code Lab'); navigate('code'); };

  return (
    <div className="app-shell">
      <Header view={view} navigate={navigate} progress={progress} />
      <main>
        {view === 'learn' && <LearnView onComplete={completeLearn} />}
        {view === 'code' && <CodeView progress={progress} updateProgress={updateProgress} toast={toast} navigate={navigate} />}
        {view === 'tune' && <TuneView progress={progress} updateProgress={updateProgress} toast={toast} navigate={navigate} />}
        {view === 'practice' && <FlightView key="practice" mode="training" progress={progress} updateProgress={updateProgress} navigate={navigate} toast={toast} />}
        {view === 'race' && <FlightView key="race" mode="race" progress={progress} updateProgress={updateProgress} navigate={navigate} toast={toast} />}
      </main>
      <footer><span>KAST MED LITEN DRÖNARE / HiQ</span><span>Course by Linus Thorsell &amp; Olof Åhren for HiQ</span><button onClick={() => { if (window.confirm('Reset all course progress, code, and saved gains?')) { localStorage.removeItem(STORAGE_KEY); setProgress(structuredClone(baseProgress)); setView('learn'); } }}>Reset course progress</button></footer>
      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status" aria-live="polite">{toastMessage}</div>
    </div>
  );
}
