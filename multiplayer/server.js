import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

export const MULTIPLAYER_PATH = '/multiplayer/socket.io';
export const RACE_ROOM = 'neon-gauntlet';

export function createRaceRelay() {
  let io;
  const httpServer = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, players: io?.sockets.sockets.size || 0 }));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found\n');
  });

  io = new Server(httpServer, {
    path: MULTIPLAYER_PATH,
    transports: ['websocket'],
    serveClient: false
  });

  const broadcastPresence = () => {
    const players = io.sockets.adapter.rooms.get(RACE_ROOM)?.size || 0;
    io.to(RACE_ROOM).emit('race:presence', { players });
  };

  io.on('connection', (socket) => {
    socket.join(RACE_ROOM);
    broadcastPresence();

    socket.on('race:pose', (pose) => {
      socket.volatile.to(RACE_ROOM).emit('race:pose', { id: socket.id, pose });
    });

    socket.on('disconnect', () => {
      socket.to(RACE_ROOM).emit('race:left', { id: socket.id });
      broadcastPresence();
    });
  });

  return { httpServer, io };
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  const port = Number(process.env.PORT) || 3001;
  const { httpServer } = createRaceRelay();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Race ghost relay listening on :${port}${MULTIPLAYER_PATH}`);
  });
}
