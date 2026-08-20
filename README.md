# Kast med liten drönare

A HiQ-branded interactive React course for learning PID control, writing a PID loop, tuning a simulated quadcopter, and flying the resulting controller in a Three.js training range.

The interface uses HiQ's current pink/purple visual direction, curly-brace motif, and official HiQ logo geometry. The locally served logo asset comes from HiQ's public brand site.

## Stack

- React 19 and Vite for the course UI and state
- Three.js through React Three Fiber for the WebGL flight simulator
- Rapier through `@react-three/rapier` for fixed-step 6-DOF rigid-body physics, collision, mass, inertia, gravity, and contact response
- Socket.IO through a separate stateless relay container for live Race ghosts
- Browser-local deterministic physics and progress storage
- Unprivileged Nginx production image built with Docker Compose

For local frontend development:

```bash
npm install
npm run dev
```

## Develop with Docker Compose

```bash
docker compose up --build
```

Open <http://localhost:8080>. To use another host port:

```bash
ROTOR_LAB_PORT=3000 docker compose up --build
```

Compose runs Vite's development server plus the Socket.IO multiplayer relay. Vite proxies `/multiplayer/socket.io/` to the relay, and the source tree is bind-mounted so app edits hot reload in the browser. Dependencies live in a Docker volume instead of the host bind mount. Rebuild the relevant image after changing either package lock.

The app is available on port `8080`; the relay is also exposed directly on port `3001` for standalone frontend development. Both run as non-root users with read-only filesystems and all Linux capabilities dropped. Building the main Dockerfile without a target still produces the production Nginx image with its `/healthz` endpoint.

## Race ghosts

Starting a Race connects the browser to one global Socket.IO room. Each client sends only its drone position and quaternion as a volatile event at 15 Hz. The relay stamps the Socket.IO connection ID and broadcasts the packet to everyone else; it stores nothing and deliberately performs no gameplay validation. Remote drones are rendered as translucent, smoothly interpolated ghosts and disappear on disconnect or after three seconds without an update. If the relay is unavailable, Race continues normally in solo mode.

Run the relay without Compose with `npm --prefix multiplayer start`; the normal Vite server proxies to `http://localhost:3001` by default.

## Deployment

Pushes to `main` build both `ghcr.io/linusthorsell/how_to_tame_a_drone` and
`ghcr.io/linusthorsell/how_to_tame_a_drone-multiplayer`. Kubernetes resources live
in the separate [`LinusThorsell/kubes`](https://github.com/LinusThorsell/kubes)
repository; the workflow only updates both commit-pinned image tags there. Argo CD
then deploys the app and relay to <https://drone.linus.solutions>.

## Course flow

1. Work through five short PID lessons and manipulate the response plot.
2. Begin with the P-only JavaScript or Python starter, then use the Code Lab guide to add integral memory, derivative damping, and output limiting. Code validation runs the same Rapier rigid-body and motor loop used by Tune, Practice, and Race.
3. Tune P, I, and D against a full-envelope 32° roll, yaw-step, gust, and offset-payload scenarios. The graph is measured from a Rapier rigid body using Three.js attitude math, the shared flight motor model, and the validated controller. Scores of 75+ overall and 60+ in every scenario are recommended; lower-scoring tunes can still be saved and flown after a stability warning.
4. Practice with four independent roll, pitch, yaw, and altitude loops. Their outputs pass through a four-motor mixer into the Rapier flight simulator. Pilot input can command up to 32° of total tilt, and the resulting horizontal thrust physically increases speed. A saved tune unlocks Practice; an unvalidated controller can still fly after a warning and falls back safely if it throws at runtime.
5. Clear the three Practice gates to unlock the separate Race tab and timed Neon Gauntlet: a 12-gate course with narrower collidable frames, sharp line and altitude changes, illuminated floor guidance, a par time, a saved personal best, and live non-colliding ghosts of other racers.

Progress, code, timing, and physics stay in the learner's browser via `localStorage`; the multiplayer relay is ephemeral and has no database or authoritative game state.
