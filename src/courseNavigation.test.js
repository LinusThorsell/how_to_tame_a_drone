import assert from 'node:assert/strict';
import test from 'node:test';
import { isViewUnlocked, latestUnlockedView, resolveView } from './courseNavigation.js';

test('course tabs unlock in strict sequence', () => {
  const newLearner = {};
  assert.equal(isViewUnlocked('learn', newLearner), true);
  assert.equal(isViewUnlocked('code', newLearner), false);
  assert.equal(isViewUnlocked('tune', newLearner), false);
  assert.equal(isViewUnlocked('practice', newLearner), false);
  assert.equal(isViewUnlocked('race', newLearner), false);

  assert.equal(latestUnlockedView({ learned: true }), 'code');
  assert.equal(latestUnlockedView({ learned: true, codePassed: true }), 'tune');
  assert.equal(latestUnlockedView({ learned: true, codePassed: true, tunePassed: true }), 'practice');
  assert.equal(latestUnlockedView({ learned: true, codePassed: true, tunePassed: true, practicePassed: true }), 'race');
});

test('locked and legacy routes resolve to an available stage', () => {
  assert.equal(resolveView('race', {}), 'learn');
  assert.equal(resolveView('practice', { learned: true }), 'code');
  assert.equal(resolveView('fly', { learned: true, codePassed: true, tunePassed: true }), 'practice');
  assert.equal(resolveView('race', { learned: true, codePassed: true, tunePassed: true, practicePassed: true }), 'race');
  assert.equal(resolveView('unknown', { learned: true }), 'learn');
});
