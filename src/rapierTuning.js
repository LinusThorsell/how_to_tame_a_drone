import * as THREE from 'three';
import {
  clamp,
  createMemory,
  deg,
  rad,
  scoreSimulation
} from './physics.js';
import {
  ANGULAR_DAMPING,
  BODY_HALF_EXTENTS,
  createMotorThrusts,
  GRAVITY,
  INERTIA,
  LINEAR_DAMPING,
  LINEAR_DRAG,
  MASS,
  motorBodyTorque,
  stepMotorModel
} from './dronePhysics.js';
import { targetDegreesForScenario } from './scenarios.js';

const STEP = 1 / 60;
const DURATION = 8;
const ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
let rapierReady;

async function loadRapier() {
  const module = await import('@dimforge/rapier3d-compat');
  const RAPIER = module.default;
  if (!rapierReady) rapierReady = RAPIER.init({});
  await rapierReady;
  return RAPIER;
}

function targetForScenario(scenario, time) {
  return rad(targetDegreesForScenario(scenario, time));
}

export async function simulateRapierTuning(controller, scenario, gains) {
  const RAPIER = await loadRapier();
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = STEP;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 2.2, 0)
      .setLinearDamping(LINEAR_DAMPING)
      .setAngularDamping(ANGULAR_DAMPING)
      .setCanSleep(false)
      .setCcdEnabled(true)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(BODY_HALF_EXTENTS.x, BODY_HALF_EXTENTS.y, BODY_HALF_EXTENTS.z)
      .setFriction(0.7)
      .setRestitution(0.12)
      .setMassProperties(MASS, ZERO, INERTIA, IDENTITY),
    body
  );

  const motors = createMotorThrusts();
  const memories = {
    pitch: createMemory(),
    roll: createMemory(),
    yaw: createMemory(),
    altitude: createMemory()
  };
  const points = [];
  const orientation = new THREE.Quaternion();
  const inverseOrientation = new THREE.Quaternion();
  const attitude = new THREE.Euler(0, 0, 0, 'YXZ');
  const bodyUp = new THREE.Vector3();
  const bodyAngularVelocity = new THREE.Vector3();
  const bodyTorque = new THREE.Vector3();
  const worldTorque = new THREE.Vector3();
  const force = new THREE.Vector3();
  const relativeAir = new THREE.Vector3();
  const gustPoint = new THREE.Vector3();
  let controlEnergy = 0;
  let invalidOutput = false;
  let physicsDiverged = false;

  try {
    for (let index = 0; index <= DURATION / STEP; index += 1) {
      const time = index * STEP;
      const translation = body.translation();
      const rotation = body.rotation();
      const linearVelocity = body.linvel();
      const angularVelocity = body.angvel();
      orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      inverseOrientation.copy(orientation).invert();
      attitude.setFromQuaternion(orientation, 'YXZ');
      bodyAngularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z).applyQuaternion(inverseOrientation);
      bodyUp.set(0, 1, 0).applyQuaternion(orientation);
      const target = targetForScenario(scenario, time);
      const yawTest = scenario === 'yaw';

      const control = (error, memory) => {
        if (!Number.isFinite(error)) {
          physicsDiverged = true;
          return 0;
        }
        let output;
        try {
          output = Number(controller(error, STEP, memory, gains));
        } catch (errorThrown) {
          errorThrown.simulationTime = time;
          throw errorThrown;
        }
        if (!Number.isFinite(output)) {
          invalidOutput = true;
          return 0;
        }
        return clamp(output, -2.5, 2.5);
      };
      const pitchOutput = control(-attitude.x, memories.pitch);
      const rollOutput = control((yawTest ? 0 : target) - attitude.z, memories.roll);
      const yawOutput = control((yawTest ? target : 0) - attitude.y, memories.yaw);
      const altitudeOutput = control(2.2 - translation.y, memories.altitude);
      const actualThrust = stepMotorModel({
        motors,
        pitchOutput,
        rollOutput,
        yawOutput,
        altitudeOutput,
        bodyUpY: bodyUp.y,
        delta: STEP
      });
      const torque = motorBodyTorque(motors, bodyAngularVelocity.y);
      bodyTorque.set(torque.x, torque.y, torque.z);
      worldTorque.copy(bodyTorque).applyQuaternion(orientation);

      relativeAir.set(linearVelocity.x, linearVelocity.y, linearVelocity.z);
      force.copy(bodyUp).multiplyScalar(actualThrust * (1 + 0.1 * Math.exp(-translation.y / 0.45)));
      force.addScaledVector(relativeAir, -LINEAR_DRAG * relativeAir.length());
      force.addScaledVector(relativeAir, -0.08);
      body.resetForces(true);
      body.resetTorques(true);
      body.addForce(force, true);
      body.addTorque(worldTorque, true);

      // Scenario loads are applied to the Rapier body at real positions. The
      // gust produces a moment above the center of mass; the offset payload
      // adds a small persistent downward force on the right arm.
      const gustActive = scenario === 'gust' && time > 1.6 && time < 2;
      if (gustActive) {
        gustPoint.set(translation.x, translation.y + 0.25, translation.z);
        body.addForceAtPoint({ x: 0.35, y: 0, z: 0 }, gustPoint, true);
      }
      if (scenario === 'payload' && time > 2.1) {
        gustPoint.set(translation.x + 0.12, translation.y, translation.z);
        body.addForceAtPoint({ x: 0, y: -0.04, z: 0 }, gustPoint, true);
      }

      world.step();
      const measuredRotation = body.rotation();
      orientation.set(measuredRotation.x, measuredRotation.y, measuredRotation.z, measuredRotation.w);
      attitude.setFromQuaternion(orientation, 'YXZ');
      const actual = deg(yawTest ? attitude.y : attitude.z);
      points.push({
        time,
        target: deg(target),
        actual,
        error: deg(target) - actual,
        output: yawTest ? yawOutput : rollOutput
      });
      controlEnergy += Math.abs(yawTest ? yawOutput : rollOutput) * STEP;
    }
  } finally {
    world.free();
  }

  return { ...scoreSimulation(points, controlEnergy, invalidOutput, scenario), physicsDiverged };
}
