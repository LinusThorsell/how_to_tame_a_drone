export const FLIGHT_START = Object.freeze({ x: 0, y: 2.2, z: 0 });

const withApproachAngles = (gates) => gates.map((gate, index) => {
  const previous = index === 0 ? FLIGHT_START : gates[index - 1];
  return Object.freeze({
    ...gate,
    yaw: Math.atan2(gate.x - previous.x, gate.z - previous.z)
  });
});

export const TRAINING_GATES = Object.freeze(withApproachAngles([
  { x: 0, y: 2.7, z: 16 },
  { x: 7, y: 3.8, z: 36 },
  { x: -5, y: 2.2, z: 56 }
]));

// A longer, narrower course with repeated line, altitude, and heading changes.
// Gates are angled toward the preceding leg so the pilot has to yaw into turns.
export const RACE_GATES = Object.freeze(withApproachAngles([
  { x: 0, y: 2.5, z: 14 },
  { x: 7, y: 4.4, z: 26 },
  { x: -6, y: 2.2, z: 39 },
  { x: 10, y: 5.7, z: 52 },
  { x: -2, y: 3.1, z: 66 },
  { x: -12, y: 6.2, z: 79 },
  { x: 1, y: 2.3, z: 92 },
  { x: 14, y: 4.8, z: 106 },
  { x: 4, y: 7.2, z: 120 },
  { x: -13, y: 3.5, z: 134 },
  { x: -3, y: 2.1, z: 148 },
  { x: 12, y: 5.4, z: 161 }
]));

export const RACE_PAR_SECONDS = 75;

export function gatesForMode(mode) {
  return mode === 'race' ? RACE_GATES : TRAINING_GATES;
}

export function distanceToFirstGate(mode) {
  const gate = gatesForMode(mode)[0];
  return Math.hypot(
    gate.x - FLIGHT_START.x,
    gate.y - FLIGHT_START.y,
    gate.z - FLIGHT_START.z
  );
}

export function isGateCleared(position, gate, mode) {
  if (!gate) return false;
  const dx = position.x - gate.x;
  const dy = position.y - gate.y;
  const dz = position.z - gate.z;
  if (mode !== 'race') return Math.hypot(dx, dy, dz) < 3.1;

  const cosine = Math.cos(gate.yaw);
  const sine = Math.sin(gate.yaw);
  const localX = cosine * dx - sine * dz;
  const localZ = sine * dx + cosine * dz;
  return Math.abs(localX) < 1.78
    && Math.abs(dy) < 1.55
    && Math.abs(localZ) < 1.15;
}

export function formatRaceTime(seconds = 0) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}
