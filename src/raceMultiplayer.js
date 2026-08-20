import { io } from 'socket.io-client';

export const MULTIPLAYER_PATH = '/multiplayer/socket.io';
export const GHOST_STALE_MS = 3000;

export function safeGhostPose(value) {
  const position = value?.p;
  const quaternion = value?.q;
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return null;
  if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) return null;
  const quaternionLength = Math.hypot(...quaternion);
  if (quaternionLength < 0.0001) return null;
  return {
    p: position.slice(),
    q: quaternion.map((component) => component / quaternionLength)
  };
}

export function createRaceMultiplayer({ onPose, onLeave, onPresence, onStatus }) {
  const socket = io({
    path: MULTIPLAYER_PATH,
    transports: ['websocket'],
    autoConnect: false
  });

  socket.on('connect', () => onStatus?.('connected'));
  socket.on('disconnect', () => onStatus?.('offline'));
  socket.on('connect_error', () => onStatus?.('offline'));
  socket.io.on('reconnect_attempt', () => onStatus?.('connecting'));
  socket.on('race:presence', ({ players } = {}) => {
    if (Number.isInteger(players) && players >= 0) onPresence?.(players);
  });
  socket.on('race:left', ({ id } = {}) => {
    if (typeof id === 'string') onLeave?.(id);
  });
  socket.on('race:pose', ({ id, pose } = {}) => {
    const safePose = safeGhostPose(pose);
    if (typeof id === 'string' && safePose) onPose?.(id, safePose);
  });

  return {
    connect() {
      onStatus?.('connecting');
      socket.connect();
    },
    publishPose(pose) {
      if (socket.connected) socket.volatile.emit('race:pose', pose);
    },
    close() {
      socket.disconnect();
    }
  };
}
