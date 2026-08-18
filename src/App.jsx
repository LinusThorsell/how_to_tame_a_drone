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

const FlightScene = lazy(() => import('./components/FlightScene'));
const LearnFlightDemo = lazy(() => import('./components/LearnFlightDemo'));
const CHECKPOINTS = [
  { x: 0, y: 2.7, z: 16 },
  { x: 7, y: 3.8, z: 36 },
  { x: -5, y: 2.2, z: 56 }
];

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
  validated: null,
  code: { ...defaultCode },
  gains: { kp: 1, ki: 0, kd: 0 }
};

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
      scenario: isScenario(stored.scenario) ? stored.scenario : DEFAULT_SCENARIO,
      code,
      validated,
      gains: resetExercise ? { ...baseProgress.gains } : gains,
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

function Header({ view, navigate, progress }) {
  const completed = [progress.learned, progress.codePassed, progress.tunePassed].filter(Boolean).length;
  const percentage = Math.round(completed / 3 * 100);
  return (
    <header className="topbar">
      <Brand />
      <nav className="course-nav" aria-label="Course modules">
        {['learn', 'code', 'tune', 'fly'].map((item, index) => (
          <button key={item} className={`nav-item ${view === item ? 'active' : ''}`} onClick={() => navigate(item)} data-view={item}>
            <span>0{index + 1}</span> {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <div className="course-progress" aria-label="Course progress">
        <div><span>{percentage}% complete</span><b id="progress-count">{completed}/3</b></div>
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

function CodeView({ progress, updateProgress, toast, navigate }) {
  const scenarioPasses = progress.codeScenarioPasses || emptyCodeScenarioPasses();
  const passedStageCount = CODE_SCENARIOS.filter((item) => hasPassedCodeScenario(scenarioPasses, item.id)).length;
  const requiredScenario = nextCodeScenarioId(scenarioPasses);
  const [language, setLanguage] = useState(progress.language);
  const [code, setCode] = useState(progress.code);
  const [gains, setGains] = useState(progress.gains);
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
    setLanguage(nextLanguage);
    setScenario(DEFAULT_SCENARIO);
    setBenchTime(0);
    setResult({ status: 'idle', message: 'Language changed. Start the validation path again with Easy 10°.', run: null });
    updateProgress({ language: nextLanguage, code, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const changeCode = (value) => {
    const updated = { ...code, [language]: value };
    setCode(updated);
    setScenario(DEFAULT_SCENARIO);
    setResult({ status: 'idle', message: 'Controller changed. Validation reset — begin again with Easy 10°.', run: null });
    setBenchTime(0);
    updateProgress({ code: updated, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
  };
  const changeGain = (key, value) => {
    const updated = { ...gains, [key]: value };
    setGains(updated);
    setScenario(DEFAULT_SCENARIO);
    setResult({ status: 'idle', message: 'PID gains changed. Validation reset — begin again with Easy 10°.', run: null });
    setBenchTime(0);
    updateProgress({ gains: updated, ...clearCodeValidation(), tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null });
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
      <div className="view-head compact-head"><div><p className="eyebrow"><span>Module 02</span> Controller workshop</p><h1 id="code-title">Build the <em>flight brain.</em></h1><p className="lede">Begin with proportional control, then add memory and damping one piece at a time. Every run steps the same Rapier aircraft used in Tune and Fly.</p></div><div className={`module-status ${progress.codePassed ? 'passed' : ''}`}><i /><span>{progress.codePassed ? 'Controller validated' : 'Validation pending'}</span></div></div>
      <div className="code-workspace">
        <div className="editor-panel panel">
          <div className="editor-toolbar">
            <div className="language-tabs" role="tablist" aria-label="Programming language">
              {['javascript', 'python'].map((item) => <button key={item} className={language === item ? 'active' : ''} onClick={() => changeLanguage(item)} role="tab">{item === 'javascript' ? 'JavaScript' : 'Python'}</button>)}
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
          <div className={`console ${result.status}`} aria-live="polite">
            <span className="console-prompt">{result.status === 'success' ? '✓' : result.status === 'error' ? '×' : '›'}</span>
            <span className="console-message">{result.message}</span>
            {nextStageAction && <button className="console-next stage-next" onClick={() => changeScenario(nextStageAction)}>Continue to {scenarioDefinition(nextStageAction).label} <span aria-hidden="true">→</span></button>}
            {progress.codePassed && <button className="console-next" onClick={() => navigate('tune')}>Continue to Tune <span aria-hidden="true">→</span></button>}
          </div>
        </div>
        <aside className="test-panel panel">
          <div className="panel-title"><div><p className="panel-label">Rapier bench 02-A</p><h3>Physical attitude test</h3></div><span className="test-id">8.0 SEC</span></div>
          <div className="code-gains"><div className="code-gains-head"><span>PID VALUES</span></div><div className="code-gain-grid"><GainSlider compact id="code-p" term="P" label="Proportional" value={gains.kp} max={MAX_GAIN} step={0.1} onChange={(value) => changeGain('kp', value)} /><GainSlider compact id="code-i" term="I" label="Integral" value={gains.ki} max={MAX_GAIN} step={0.02} onChange={(value) => changeGain('ki', value)} /><GainSlider compact id="code-d" term="D" label="Derivative" value={gains.kd} max={MAX_GAIN} step={0.05} onChange={(value) => changeGain('kd', value)} /></div></div>
          <div className="code-scenarios"><CodeScenarioProgress value={scenario} onChange={changeScenario} passes={scenarioPasses} /></div>
          <div className="code-visual-toolbar"><div><span>USER PID OUTPUT</span><b>{result.run ? 'Replay the physical test' : 'Run your code to begin'}</b></div><div role="tablist" aria-label="Bench visualization"><button className={benchView === 'both' ? 'active' : ''} onClick={() => selectBenchView('both')} role="tab" aria-selected={benchView === 'both'}>3D + graph</button><button className={benchView === 'three' ? 'active' : ''} onClick={() => selectBenchView('three')} role="tab" aria-selected={benchView === 'three'}>3D only</button><button className={benchView === 'graph' ? 'active' : ''} onClick={() => selectBenchView('graph')} role="tab" aria-selected={benchView === 'graph'}>Graph only</button></div></div>
          <div className={`code-visual-stage view-${benchView}`}>{benchView === 'both' ? <div className="code-visual-split"><div className="code-flight-pane">{flightReplay('code-flight-split')}</div>{responseGraph(true)}</div> : benchView === 'three' ? flightReplay() : responseGraph()}</div>
          <div className="metrics-row"><div><span>RMS error</span><b id="code-rms">{result.run ? result.run.rms.toFixed(1) : '—'}</b><small>degrees</small></div><div><span>Overshoot</span><b id="code-overshoot">{result.run ? Math.round(result.run.overshoot) : '—'}</b><small>percent</small></div><div><span>Control score</span><b id="code-score">{result.run?.score ?? '—'}</b><small>/ 100</small></div></div>
          <div className="pid-guide">
            <div className="pid-guide-head"><div><p className="panel-label">Build your controller</p><h4>{pidGuide[guideStep].title}</h4></div><span>EDIT → RUN → OBSERVE</span></div>
            <div className="pid-guide-tabs" role="tablist" aria-label="PID build steps">{pidGuide.map((step, index) => <button key={step.term} className={guideStep === index ? 'active' : ''} onClick={() => setGuideStep(index)} role="tab">{step.term}</button>)}</div>
            <p>{pidGuide[guideStep].body}</p>
            <pre><code>{pidGuide[guideStep][language]}</code></pre>
          </div>
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
      <div className="tune-grid"><aside className="tuner-panel panel"><div className="panel-title"><div><p className="panel-label">Gain controls</p><h3>Attitude controller</h3></div><button className="ghost-btn small" onClick={() => { const reset = { kp: 1, ki: 0, kd: 0 }; setGains(reset); setCombinedScore(null); updateProgress({ gains: reset, tunePassed: false, tuneWarning: false, tuneScore: null, tuneWeakest: null }); }}>Reset gains</button></div><GainSlider id="tune-p" term="P" label="Proportional" help="Immediate correction" value={gains.kp} max={MAX_GAIN} step={0.1} onChange={(value) => setGain('kp', value)} /><GainSlider id="tune-i" term="I" label="Integral" help="Removes steady error" value={gains.ki} max={MAX_GAIN} step={0.02} onChange={(value) => setGain('ki', value)} /><GainSlider id="tune-d" term="D" label="Derivative" help="Damps fast motion" value={gains.kd} max={MAX_GAIN} step={0.05} onChange={(value) => setGain('kd', value)} /><div className="tuning-tip"><span>COACH</span><p>{controller ? tuningAdvice(gains, run, scenario) : 'Fix the current Code tab controller before running this scenario.'}</p></div><button className="primary-btn full" id="save-tune" onClick={save} disabled={saving || !controller}>{!controller ? 'Fix controller in Code' : saving ? 'Running 4 physics checks…' : 'Save tune & run check'} <span>→</span></button></aside>
        <div className="sim-panel panel"><div className="sim-toolbar"><div><span className="live-dot">{simulating ? 'SOLVING' : 'RAPIER TRACE'}</span><b>{scenarioDefinition(scenario).headline}</b></div><div className="sim-clock"><span>RAPIER ATTITUDE</span><b>{simTime.toFixed(1).padStart(4, '0')} s</b></div></div><div className="tune-visual tune-response-graph"><ResponseChart run={run} showError animate onTime={setSimTime} id="tune-chart" /><ResponseLegend /><div className={`wind-callout ${scenario === 'gust' ? 'visible' : ''}`}>WIND GUST <span>→</span></div></div><div className="metrics-row tune-metrics"><div><span>Settling time</span><b>{run ? run.settling.toFixed(1) : '—'}</b><small>seconds</small></div><div><span>Peak overshoot</span><b>{run ? Math.round(run.overshoot) : '—'}</b><small>percent</small></div><div><span>Steady error</span><b>{run ? run.steadyError.toFixed(1) : '—'}</b><small>degrees</small></div><div className="score-metric"><span>Stability score</span><b id="tune-score">{combinedScore ?? run?.score ?? '—'}</b><small>/ 100</small></div></div></div>
      </div>
      {warning && <TuneWarningDialog score={warning.score} weakest={warning.weakest} onClose={() => setWarning(null)} onProceed={() => { setWarning(null); navigate('fly'); }} proceedLabel="Fly anyway →" />}
    </section>
  );
}

function FlyView({ progress, navigate, toast }) {
  const [launched, setLaunched] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [telemetry, setTelemetry] = useState({ altitude: 0, speed: 0, tilt: 0, commandedTilt: 0, heading: 0, battery: 100, checkpoint: 0, distance: CHECKPOINTS[0].z, motors: [43, 43, 43, 43], controllerFault: false });
  const [warningOpen, setWarningOpen] = useState(false);
  const ready = progress.tunePassed;
  const controllerWarning = !progress.codePassed || !progress.validated?.source;
  const hasFlightWarning = progress.tuneWarning || controllerWarning;
  const controller = useMemo(() => {
    const language = progress.validated?.language || progress.language;
    const source = progress.validated?.source || progress.code?.[language];
    if (!source) return null;
    try { return compileController(language, source); } catch { return null; }
  }, [progress.code, progress.language, progress.validated]);
  const arm = () => { setWarningOpen(false); setLaunched(true); setResetSignal((value) => value + 1); toast('Three.js flight controller armed — use W A S D to move'); };
  const launch = () => {
    if (!ready) return;
    if (hasFlightWarning) setWarningOpen(true);
    else arm();
  };
  const checkpoint = telemetry.checkpoint;
  const onCheckpoint = useCallback((nextCheckpoint) => {
    if (nextCheckpoint < CHECKPOINTS.length) toast(`Checkpoint ${nextCheckpoint} cleared`);
    else toast('Training range complete — excellent flying');
  }, [toast]);
  const onTelemetry = useCallback((data) => setTelemetry(data), []);

  return (
    <section className="view active fly-view" id="fly-view" aria-labelledby="fly-title">
      <div className="flight-frame">
        <Suspense fallback={<div className="three-loading"><span>Loading Three.js flight world…</span></div>}>
          <FlightScene launched={launched} controller={controller} gains={progress.gains} resetSignal={resetSignal} onTelemetry={onTelemetry} onCheckpoint={onCheckpoint} />
        </Suspense>
        <div className="flight-topbar"><div><p className="eyebrow"><span>Module 04</span> Rapier 6-DOF flight</p><h1 id="fly-title">Training Range <em>Alpha</em></h1></div><div className={`flight-status ${launched ? 'live' : ''}`}><span><i /> FLIGHT SYSTEMS</span><b>{launched ? 'ACTIVE' : 'STANDBY'}</b></div></div>
        <div className="flight-hud left-hud"><div className="hud-block"><span>ALTITUDE</span><b>{telemetry.altitude.toFixed(1)}</b><small>METERS</small></div><div className="hud-block"><span>AIRSPEED</span><b>{telemetry.speed.toFixed(1)}</b><small>M / S</small></div><div className="hud-block"><span>ATTITUDE</span><b>{Math.round(telemetry.tilt)}°</b><small>{Math.round(telemetry.commandedTilt)}° COMMAND</small></div><div className="hud-block"><span>HEADING</span><b>{String(Math.round(telemetry.heading)).padStart(3, '0')}</b><small>DEGREES</small></div></div>
        <div className="flight-hud right-hud">
          <div className="battery"><span>BATTERY</span><b>{Math.round(telemetry.battery)}%</b><i><em style={{ width: `${telemetry.battery}%` }} /></i></div>
          <div className="controller-chip"><span>USER CONTROLLER · 4 AXES</span><b>{telemetry.controllerFault ? 'FALLBACK ACTIVE' : progress.validated ? `${progress.validated.language.toUpperCase()} PID` : `${progress.language.toUpperCase()} · UNVALIDATED`}</b></div>
          <div className="motor-mixer"><span>MOTOR THRUST · %</span><div>{telemetry.motors.map((motor, index) => <b key={index}>M{index + 1}<em>{motor}</em></b>)}</div></div>
          <div className="controller-chip render-chip"><span>PHYSICS / RENDERER</span><b>RAPIER · THREE.JS</b></div>
        </div>
        <div className="flight-message"><span>{checkpoint >= CHECKPOINTS.length ? 'COURSE COMPLETE' : `CHECKPOINT 0${checkpoint + 1}`}</span><b>{checkpoint >= CHECKPOINTS.length ? 'Control loop proven in flight' : 'Fly through the illuminated gate'}</b><small>{checkpoint >= CHECKPOINTS.length ? 'All checkpoints cleared' : `${telemetry.distance.toFixed(0)} m to target`}</small></div>
        <div className="flight-controls"><div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Tilt ·32° / speed</span></div><div><kbd>↑</kbd><kbd>↓</kbd><span>Altitude</span></div><div><kbd>←</kbd><kbd>→</kbd><span>Yaw</span></div><button onClick={() => { setResetSignal((value) => value + 1); setTelemetry({ altitude: 2.2, speed: 0, tilt: 0, commandedTilt: 0, heading: 0, battery: 100, checkpoint: 0, distance: CHECKPOINTS[0].z, motors: [43, 43, 43, 43], controllerFault: false }); toast('Aircraft returned to launch position'); }}>Reset flight</button></div>
        <div className={`launch-overlay ${launched ? 'hidden' : ''}`}><div className="launch-card"><span className="launch-icon" aria-hidden="true">⌁</span><p className="eyebrow"><span>Pre-flight check</span></p><h2>Your controller earns the controls.</h2><p>Save a tune for the full 32° flight envelope. Low scores and unvalidated controllers remain flyable after a warning.</p><div className="checklist"><button onClick={() => navigate('code')}><i className={progress.codePassed ? 'done' : 'warning'}>{progress.codePassed ? '✓' : '!'}</i><span><b>Controller validation</b><small>{progress.codePassed ? 'Bench test passed' : 'Not validated · flight warning'}</small></span><em>Open code lab →</em></button><button onClick={() => navigate('tune')}><i className={progress.tunePassed ? (progress.tuneWarning ? 'warning' : 'done') : ''}>{progress.tunePassed ? (progress.tuneWarning ? '!' : '✓') : '○'}</i><span><b>Flight-envelope tune</b><small>{progress.tunePassed ? `${progress.tuneScore}/100 saved${progress.tuneWarning ? ' · stability warning' : ''}` : `Save any score · ${TUNE_PASS_SCORE}+ recommended`}</small></span><em>Open tuning bay →</em></button></div><button className="primary-btn full" id="launch-flight" onClick={launch} disabled={!ready}>Launch simulator <span>→</span></button></div></div>
        {warningOpen && <TuneWarningDialog score={progress.tuneScore} weakest={progress.tuneWeakest} controllerWarning={controllerWarning} onClose={() => { setWarningOpen(false); navigate(controllerWarning ? 'code' : 'tune'); }} onProceed={arm} proceedLabel="Arm and fly anyway" />}
      </div>
    </section>
  );
}

export default function App() {
  const [progress, setProgress] = useState(loadProgress);
  const [view, setView] = useState(() => ['learn', 'code', 'tune', 'fly'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'learn');
  const [toastMessage, setToastMessage] = useState('');
  const toastTimer = useRef();
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }, [progress]);
  useEffect(() => {
    const hashChange = () => { const next = location.hash.slice(1); if (['learn', 'code', 'tune', 'fly'].includes(next)) setView(next); };
    window.addEventListener('hashchange', hashChange);
    return () => window.removeEventListener('hashchange', hashChange);
  }, []);
  const updateProgress = useCallback((patch) => setProgress((current) => ({ ...current, ...patch })), []);
  const toast = useCallback((message) => {
    setToastMessage(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(''), 2600);
  }, []);
  const navigate = useCallback((next) => {
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
        {view === 'fly' && <FlyView progress={progress} navigate={navigate} toast={toast} />}
      </main>
      <footer><span>KAST MED LITEN DRÖNARE / HiQ</span><span>Course by Linus Thorsell &amp; Olof Åhren for HiQ</span><button onClick={() => { if (window.confirm('Reset all course progress, code, and saved gains?')) { localStorage.removeItem(STORAGE_KEY); setProgress(structuredClone(baseProgress)); setView('learn'); } }}>Reset course progress</button></footer>
      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status" aria-live="polite">{toastMessage}</div>
    </div>
  );
}
