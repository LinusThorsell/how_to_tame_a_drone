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

## Flight modes

Practice and Race can switch between Angle and Acro before launch or while airborne. Angle keeps the course's self-leveling 32° attitude envelope and altitude hold. Acro instead maps roll, pitch, and yaw input to gyro body-rate targets with strong expo around center stick, reaching 600°/s on roll/pitch and 1000°/s on yaw. Acro yaw also receives a larger motor-control ceiling and lighter rate damping for materially stronger authority. Centered attitude sticks stop rotation without leveling the aircraft, attitude is unrestricted, and the throttle follows the current stick position directly with 50% close to hover and no automatic tilt compensation.

Standard browser gamepads are supported alongside keyboard and touch controls. The right stick controls pitch/roll, the left stick controls altitude-or-throttle/yaw, A/Cross launches or confirms, Y/Triangle switches Angle/Acro, and Menu/Options resets the flight. Analog sticks use a radial deadzone plus a small per-axis drift filter. Non-standard wireless controllers automatically detect common four- and six-axis layouts so analog trigger axes are not mistaken for a stick; their buttons remain device-specific.

The camera can be switched independently between the default stabilized chase view and a wide-angle, nose-mounted FPV view that follows the aircraft's full pitch, roll, and yaw attitude. Camera selection is available before launch and while airborne.

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
4. Practice with four independent roll, pitch, yaw, and altitude loops in Angle mode, or switch to the dedicated gyro-rate PID and direct throttle in Acro. Both paths pass through the same four-motor mixer and Rapier rigid-body simulator. A saved tune unlocks Practice; an unvalidated controller can still fly after a warning and falls back safely if it throws at runtime.
5. Clear the three Practice gates to unlock the separate Race tab and timed Neon Gauntlet: a 12-gate course with narrower collidable frames, sharp line and altitude changes, illuminated floor guidance, a par time, a saved personal best, and live non-colliding ghosts of other racers.

Progress, code, timing, and physics stay in the learner's browser via `localStorage`; the multiplayer relay is ephemeral and has no database or authoritative game state.
