import { indentWithTab } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { lintGutter, linter, openLintPanel } from '@codemirror/lint';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { compileController } from './physics.js';

const hiqEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#180b18',
    color: '#f6e8f1',
    fontSize: '14px'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: '1.75',
    overflow: 'auto'
  },
  '.cm-content': {
    padding: '22px 0',
    caretColor: '#ff0096',
    minWidth: 'max-content'
  },
  '.cm-line': { padding: '0 20px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ff0096', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(255, 0, 150, .24)'
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 0, 150, .055)' },
  '.cm-gutters': {
    backgroundColor: '#200d21',
    color: '#826278',
    borderRight: '1px solid rgba(255, 160, 220, .18)'
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 0, 150, .1)', color: '#ff78c8' },
  '.cm-gutterElement': { padding: '0 10px 0 8px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-lint-marker-error': { content: '""', borderBottomColor: '#ff5f78' },
  '.cm-lint-marker-warning': { content: '""', borderBottomColor: '#ffc247' },
  '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px wavy #ff5f78' },
  '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '2px wavy #ffc247' },
  '.cm-panels': { backgroundColor: '#211020', color: '#f6e8f1' },
  '.cm-panel.cm-panel-lint': { borderTop: '1px solid rgba(255, 160, 220, .24)' },
  '.cm-panel-lint ul [aria-selected]': { backgroundColor: 'rgba(255, 0, 150, .14)' },
  '.cm-diagnostic': { padding: '7px 10px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  '.cm-diagnostic-error': { borderLeftColor: '#ff5f78' },
  '.cm-diagnostic-warning': { borderLeftColor: '#ffc247' },
  '.cm-tooltip': {
    backgroundColor: '#2b142b',
    color: '#f6e8f1',
    border: '1px solid rgba(255, 160, 220, .28)',
    borderRadius: '5px'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(255, 0, 150, .2)' },
  '.cm-matchingBracket': { color: '#fff7fc', backgroundColor: 'rgba(191, 74, 255, .25)', outline: '1px solid #bd4aff' }
}, { dark: true });

const hiqHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#9d718e', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: '#ff4aaf', fontWeight: '650' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#d98cff' },
  { tag: tags.variableName, color: '#f4dcea' },
  { tag: [tags.propertyName, tags.attributeName], color: '#e9a5ff' },
  { tag: [tags.string, tags.character, tags.attributeValue], color: '#ffc866' },
  { tag: [tags.number, tags.integer, tags.float], color: '#7ee4ac' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#b77aff' },
  { tag: [tags.operator, tags.operatorKeyword, tags.arithmeticOperator], color: '#ff83ca' },
  { tag: [tags.punctuation, tags.bracket], color: '#bfa3b6' },
  { tag: tags.invalid, color: '#ff5f78', textDecoration: 'underline wavy' }
]);

function rangeForLine(source, lineNumber) {
  const lines = source.split('\n');
  const safeLine = Math.max(1, Math.min(lineNumber || 1, lines.length));
  const from = lines.slice(0, safeLine - 1).reduce((total, line) => total + line.length + 1, 0);
  return { from, to: Math.min(source.length, from + Math.max(1, lines[safeLine - 1].length)) };
}

function lineForMatch(source, pattern) {
  const match = source.match(pattern);
  if (!match || match.index == null) return 1;
  return source.slice(0, match.index).split('\n').length;
}

function parseDiagnostics(language, source, tree) {
  const diagnostics = [];
  tree.iterate({
    enter(node) {
      if (!node.type.isError) return;
      diagnostics.push({
        from: node.from,
        to: Math.min(source.length, Math.max(node.to, node.from + 1)),
        severity: 'error',
        source: language === 'python' ? 'Python' : 'JavaScript',
        message: `${language === 'python' ? 'Python' : 'JavaScript'} syntax error.`
      });
    }
  });
  return diagnostics;
}

function compilerDiagnostic(language, source) {
  try {
    compileController(language, source);
    return null;
  } catch (error) {
    let line = 1;
    const unsupported = error.message.match(/^Unsupported Python statement: (.+)$/)?.[1];
    const subsetKeyword = error.message.match(/does not support “([^”]+)”/)?.[1];
    if (unsupported) line = lineForMatch(source, new RegExp(unsupported.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    else if (subsetKeyword) line = lineForMatch(source, new RegExp(`^\\s*${subsetKeyword}\\b`, 'm'));
    return { ...rangeForLine(source, line), severity: 'error', source: 'Flight compiler', message: error.message };
  }
}

function warningAt(source, pattern, message) {
  const match = source.match(pattern);
  if (!match || match.index == null) return null;
  return {
    from: match.index,
    to: Math.min(source.length, match.index + Math.max(1, match[0].length)),
    severity: 'warning',
    source: 'PID safety',
    message
  };
}

export function getControllerDiagnostics(language, source, parsedTree = null) {
  if (!source.trim()) return [{ from: 0, to: 0, severity: 'error', source: 'Flight compiler', message: 'Write a pid controller before running the test.' }];
  const parser = language === 'python' ? pythonLanguage.parser : javascriptLanguage.parser;
  const diagnostics = parseDiagnostics(language, source, parsedTree || parser.parse(source));
  if (!diagnostics.length) {
    const compilerError = compilerDiagnostic(language, source);
    if (compilerError) diagnostics.push(compilerError);
  }

  if (!/\breturn\b/.test(source) && !diagnostics.some((item) => /return/.test(item.message))) {
    diagnostics.push({ ...rangeForLine(source, 1), severity: 'error', source: 'PID safety', message: 'pid() must return a motor command.' });
  }

  const integralPattern = /state(?:\.integral|\s*\[\s*["']integral["']\s*\])/;
  const integralClamp = source.split('\n').some((line) => /integral/.test(line) && /(?:Math\.)?(?:min|max)\s*\(/.test(line));
  if (integralPattern.test(source) && !integralClamp) {
    diagnostics.push(warningAt(source, integralPattern, 'Integral memory is not clamped. Add anti-windup before increasing I.'));
  }

  const derivativePattern = /\/\s*dt\b/;
  const previousErrorUpdated = /state(?:\.previousError|\s*\[\s*["']previousError["']\s*\])\s*=\s*error/.test(source);
  if (derivativePattern.test(source) && !previousErrorUpdated) {
    diagnostics.push(warningAt(source, derivativePattern, 'Save error to state.previousError after calculating the derivative.'));
  }

  const returnPattern = /\breturn\b[^\n]*/;
  const returned = source.match(returnPattern)?.[0] || '';
  if (returned && !/(?:Math\.)?(?:min|max)\s*\(/.test(returned)) {
    diagnostics.push(warningAt(source, returnPattern, 'Clamp the returned motor command to keep it inside the aircraft limit.'));
  }

  const loopWarning = warningAt(source, /^\s*(?:for|while)\b/m, 'Loops can stall the 60 Hz flight controller. Use direct calculations each step.');
  if (language === 'javascript' && loopWarning) diagnostics.push(loopWarning);
  return diagnostics.filter(Boolean);
}

export function controllerEditorExtensions(language) {
  const languageExtension = language === 'python' ? python() : javascript();
  return [
    languageExtension,
    hiqEditorTheme,
    syntaxHighlighting(hiqHighlightStyle),
    linter((view) => getControllerDiagnostics(language, view.state.doc.toString(), syntaxTree(view.state)), { delay: 300 }),
    lintGutter(),
    keymap.of([indentWithTab]),
    EditorView.contentAttributes.of({ 'aria-label': 'PID controller code', spellcheck: 'false' })
  ];
}

export function showControllerDiagnostics(editorRef) {
  const view = editorRef.current?.view;
  if (view) openLintPanel(view);
}
