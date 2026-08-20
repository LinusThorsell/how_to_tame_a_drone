import test from 'node:test';
import assert from 'node:assert/strict';
import { io as createClient } from 'socket.io-client';
import { createRaceRelay, MULTIPLAYER_PATH } from './server.js';

const once = (target, event) => new Promise((resolve) => target.once(event, resolve));

test('the relay broadcasts poses and removes disconnected racers', async (context) => {
  const { httpServer, io } = createRaceRelay();
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const options = { path: MULTIPLAYER_PATH, transports: ['websocket'], forceNew: true };
  const first = createClient(`http://127.0.0.1:${port}`, options);
  const second = createClient(`http://127.0.0.1:${port}`, options);
  context.after(async () => {
    first.disconnect();
    second.disconnect();
    await new Promise((resolve) => io.close(resolve));
  });

  await Promise.all([once(first, 'connect'), once(second, 'connect')]);
  const firstId = first.id;
  const poseReceived = once(second, 'race:pose');
  first.emit('race:pose', { p: [1, 2, 3], q: [0, 0, 0, 1] });
  assert.deepEqual(await poseReceived, {
    id: firstId,
    pose: { p: [1, 2, 3], q: [0, 0, 0, 1] }
  });

  const left = once(second, 'race:left');
  first.disconnect();
  assert.deepEqual(await left, { id: firstId });
});
