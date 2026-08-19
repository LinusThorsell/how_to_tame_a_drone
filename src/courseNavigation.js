export const COURSE_NAVIGATION = Object.freeze([
  Object.freeze({ id: 'learn', label: 'Learn' }),
  Object.freeze({ id: 'code', label: 'Code' }),
  Object.freeze({ id: 'tune', label: 'Tune' }),
  Object.freeze({ id: 'practice', label: 'Practice' }),
  Object.freeze({ id: 'race', label: 'Race' })
]);

const unlockRequirements = Object.freeze({
  learn: () => true,
  code: (progress) => Boolean(progress.learned),
  tune: (progress) => Boolean(progress.learned && progress.codePassed),
  practice: (progress) => Boolean(progress.learned && progress.codePassed && progress.tunePassed),
  race: (progress) => Boolean(progress.learned && progress.codePassed && progress.tunePassed && progress.practicePassed)
});

export function isViewUnlocked(view, progress = {}) {
  return Boolean(unlockRequirements[view]?.(progress));
}

export function latestUnlockedView(progress = {}) {
  return COURSE_NAVIGATION.reduce((latest, item) => (
    isViewUnlocked(item.id, progress) ? item.id : latest
  ), 'learn');
}

export function resolveView(hash, progress = {}) {
  const requested = hash === 'fly' ? 'practice' : hash;
  if (!COURSE_NAVIGATION.some((item) => item.id === requested)) return 'learn';
  return isViewUnlocked(requested, progress) ? requested : latestUnlockedView(progress);
}
