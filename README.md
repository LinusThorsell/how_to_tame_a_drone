# Kast med liten drönare

A HiQ-branded interactive React course for learning PID control, writing a PID loop, tuning a simulated quadcopter, and flying the resulting controller in a Three.js training range.

The interface uses HiQ's current pink/purple visual direction, curly-brace motif, and official HiQ logo geometry. The locally served logo asset comes from HiQ's public brand site.

## Stack

- React 19 and Vite for the course UI and state
- Three.js through React Three Fiber for the WebGL flight simulator
- Rapier through `@react-three/rapier` for fixed-step 6-DOF rigid-body physics, collision, mass, inertia, gravity, and contact response
- Browser-local deterministic physics and progress storage
- Unprivileged Nginx production image built with Docker Compose

For local frontend development:

```bash
npm install
npm run dev
```

## Run with Docker Compose

```bash
docker compose up --build
```

Open <http://localhost:8080>. To use another host port:

```bash
ROTOR_LAB_PORT=3000 docker compose up --build
```

The container serves the app on port `8080` and exposes `/healthz` for readiness and liveness checks. It runs as a non-root user with a read-only filesystem and all Linux capabilities dropped.

## Kubernetes

Build and push the same image, replace `YOUR_REGISTRY/rotor-lab:VERSION` in `deploy/kubernetes.example.yaml`, then apply the manifest:

```bash
docker build -t YOUR_REGISTRY/rotor-lab:VERSION .
docker push YOUR_REGISTRY/rotor-lab:VERSION
kubectl apply -f deploy/kubernetes.example.yaml
```

The example includes two replicas, resource bounds, non-root security settings, a service, and health probes. Add an Ingress or Gateway appropriate for your cluster.

## Course flow

1. Work through five short PID lessons and manipulate the response plot.
2. Begin with the P-only JavaScript or Python starter, then use the Code Lab guide to add integral memory, derivative damping, and output limiting. Code validation runs the same Rapier rigid-body and motor loop used by Tune and Fly.
3. Tune P, I, and D against a full-envelope 32° roll, yaw-step, gust, and offset-payload scenarios. The graph is measured from a Rapier rigid body using Three.js attitude math, the shared flight motor model, and the validated controller. Scores of 75+ overall and 60+ in every scenario are recommended; lower-scoring tunes can still be saved and flown after a stability warning.
4. Load the controller into four independent roll, pitch, yaw, and altitude loops. Their outputs pass through a four-motor mixer into the Rapier flight simulator. Pilot input can command up to 32° of total tilt, and the resulting horizontal thrust physically increases speed. A saved tune unlocks the simulator; an unvalidated controller can still fly after a warning and falls back safely if it throws at runtime.

Progress and code stay in the learner's browser via `localStorage`; there is no server-side data or external dependency.
