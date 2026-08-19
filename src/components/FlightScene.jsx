import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  CuboidCollider,
  Physics,
  RigidBody,
  useBeforePhysicsStep
} from '@react-three/rapier';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  builtInController,
  clamp,
  createMemory,
  deg,
  rad,
  readFlightInputs
} from '../physics';
import {
  ANGULAR_DAMPING,
  BODY_HALF_EXTENTS,
  createMotorThrusts,
  GRAVITY,
  INERTIA,
  LINEAR_DAMPING,
  LINEAR_DRAG,
  MASS,
  MAX_FLIGHT_TILT_DEGREES,
  MAX_MOTOR_THRUST,
  motorBodyTorque,
  stepMotorModel
} from '../dronePhysics';
import { FLIGHT_START, gatesForMode, isGateCleared } from '../flightCourse';

const ZERO = { x: 0, y: 0, z: 0 };
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

function useFlightKeys(enabled) {
  const keys = useRef(new Set());
  useEffect(() => {
    if (!enabled) return undefined;
    const down = (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      keys.current.add(event.code);
    };
    const up = (event) => keys.current.delete(event.code);
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, [enabled]);
  return keys;
}

function Rotor({ position, motorIndex, motorsRef, accent = '#ff0096' }) {
  const rotor = useRef();
  useFrame((_, delta) => {
    if (!rotor.current) return;
    const thrust = motorsRef.current[motorIndex] || 0;
    const direction = motorIndex === 0 || motorIndex === 3 ? -1 : 1;
    rotor.current.rotation.y += direction * delta * (12 + thrust * 6);
  });
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.1, 0.13, 0.18, 16]} />
        <meshStandardMaterial color="#3a123f" metalness={0.75} roughness={0.25} />
      </mesh>
      <group ref={rotor} position={[0, 0.11, 0]}>
        <mesh>
          <boxGeometry args={[1.45, 0.025, 0.08]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.65} transparent opacity={0.72} />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[1.45, 0.02, 0.06]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.45} transparent opacity={0.45} />
        </mesh>
      </group>
    </group>
  );
}

function Drone({ motorsRef }) {
  return (
    <group scale={0.28}>
      <mesh castShadow>
        <boxGeometry args={[1.15, 0.32, 1.45]} />
        <meshStandardMaterial color="#3b1249" metalness={0.75} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0.16, 0.1]} castShadow>
        <boxGeometry args={[0.75, 0.17, 0.82]} />
        <meshStandardMaterial color="#762277" emissive="#3c0b47" emissiveIntensity={0.45} metalness={0.6} roughness={0.2} />
      </mesh>
      <mesh rotation={[0, Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[3.2, 0.12, 0.14]} />
        <meshStandardMaterial color="#a7bdc7" metalness={0.75} roughness={0.2} />
      </mesh>
      <mesh rotation={[0, -Math.PI / 4, 0]} castShadow>
        <boxGeometry args={[3.2, 0.12, 0.14]} />
        <meshStandardMaterial color="#a7bdc7" metalness={0.75} roughness={0.2} />
      </mesh>
      <Rotor position={[-1.12, 0.07, -1.12]} motorIndex={2} motorsRef={motorsRef} />
      <Rotor position={[1.12, 0.07, 1.12]} motorIndex={1} motorsRef={motorsRef} />
      <Rotor position={[1.12, 0.07, -1.12]} motorIndex={3} motorsRef={motorsRef} accent="#9b51e0" />
      <Rotor position={[-1.12, 0.07, 1.12]} motorIndex={0} motorsRef={motorsRef} accent="#9b51e0" />
      <mesh position={[0, -0.02, 0.78]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#ff6b6b" toneMapped={false} />
      </mesh>
    </group>
  );
}

function GateFrame({ width, height, bar, color, intensity, active, challenge }) {
  return (
    <>
      <mesh position={[-width / 2, 0, 0]} castShadow><boxGeometry args={[bar, height, bar * 1.2]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} /></mesh>
      <mesh position={[width / 2, 0, 0]} castShadow><boxGeometry args={[bar, height, bar * 1.2]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} /></mesh>
      <mesh position={[0, height / 2, 0]} castShadow><boxGeometry args={[width + bar, bar, bar * 1.2]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} /></mesh>
      <mesh position={[0, -height / 2, 0]} castShadow><boxGeometry args={[width + bar, bar, bar * 1.2]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} /></mesh>
      {challenge && <mesh position={[0, height / 2 + 0.22, 0]}><boxGeometry args={[1.25, 0.08, 0.32]} /><meshBasicMaterial color={active ? '#ffd45e' : color} toneMapped={false} /></mesh>}
      {active && <pointLight color={challenge ? '#ff36b8' : '#ff0096'} intensity={challenge ? 22 : 16} distance={challenge ? 14 : 11} decay={2} />}
    </>
  );
}

function Gate({ position, active, passed, challenge }) {
  const width = challenge ? 4.05 : 5.15;
  const height = challenge ? 3.6 : 4.8;
  const bar = challenge ? 0.2 : 0.16;
  const color = active ? '#ff0096' : passed ? '#6ee7a8' : '#58305f';
  const intensity = active ? (challenge ? 4.4 : 3.2) : passed ? 1.2 : 0.15;
  const frame = <GateFrame width={width} height={height} bar={bar} color={color} intensity={intensity} active={active} challenge={challenge} />;
  if (challenge) {
    return (
      <RigidBody type="fixed" colliders={false} position={[position.x, position.y, position.z]} rotation={[0, position.yaw, 0]}>
        <CuboidCollider args={[bar / 2, height / 2, bar * 0.6]} position={[-width / 2, 0, 0]} friction={0.75} restitution={0.1} />
        <CuboidCollider args={[bar / 2, height / 2, bar * 0.6]} position={[width / 2, 0, 0]} friction={0.75} restitution={0.1} />
        <CuboidCollider args={[(width + bar) / 2, bar / 2, bar * 0.6]} position={[0, height / 2, 0]} friction={0.75} restitution={0.1} />
        <CuboidCollider args={[(width + bar) / 2, bar / 2, bar * 0.6]} position={[0, -height / 2, 0]} friction={0.75} restitution={0.1} />
        {frame}
      </RigidBody>
    );
  }
  return (
    <group position={[position.x, position.y, position.z]} rotation={[0, position.yaw, 0]}>{frame}</group>
  );
}

function CourseLights({ gates, checkpoint }) {
  const markers = useMemo(() => gates.flatMap((gate, segment) => {
    const previous = segment === 0 ? FLIGHT_START : gates[segment - 1];
    const dx = gate.x - previous.x;
    const dz = gate.z - previous.z;
    const length = Math.hypot(dx, dz);
    const markerCount = Math.max(3, Math.ceil(length / 3.2));
    return Array.from({ length: markerCount }, (_, index) => {
      const progress = (index + 0.5) / markerCount;
      return {
        segment,
        order: index,
        x: previous.x + dx * progress,
        z: previous.z + dz * progress,
        yaw: Math.atan2(dx, dz)
      };
    });
  }), [gates]);

  return markers.map((marker) => {
    const passed = marker.segment < checkpoint;
    const active = marker.segment === checkpoint;
    const leftColor = passed ? '#55eaa2' : active ? '#ff0096' : '#4b214f';
    const rightColor = passed ? '#55eaa2' : active ? '#9c6cff' : '#34203f';
    return (
      <group key={`${marker.segment}-${marker.order}`} position={[marker.x, 0.14, marker.z]} rotation={[0, marker.yaw, 0]}>
        <mesh position={[-2.45, 0, 0]}><boxGeometry args={[0.2, 0.06, 1.15]} /><meshBasicMaterial color={leftColor} toneMapped={false} /></mesh>
        <mesh position={[2.45, 0, 0]}><boxGeometry args={[0.2, 0.06, 1.15]} /><meshBasicMaterial color={rightColor} toneMapped={false} /></mesh>
        {active && marker.order % 2 === 0 && <pointLight position={[0, 0.2, 0]} color="#cf3cff" intensity={3.5} distance={6} decay={2} />}
      </group>
    );
  });
}

function RangeObjects({ challenge }) {
  const markers = useMemo(() => Array.from({ length: challenge ? 46 : 30 }, (_, index) => ({
    x: (index % 2 ? 1 : -1) * (10 + (index * 7) % 30),
    z: 6 + index * 4.3,
    height: 0.8 + (index % 4) * 0.55
  })), [challenge]);
  return markers.map((marker, index) => (
    <group key={index} position={[marker.x, marker.height / 2, marker.z]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.55, marker.height, 0.55]} />
        <meshStandardMaterial color="#2d152f" roughness={0.9} />
      </mesh>
      <mesh position={[0, marker.height / 2 + 0.06, 0]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshBasicMaterial color={index % 3 ? '#8b2ca1' : '#ff0096'} />
      </mesh>
    </group>
  ));
}

function Ground({ challenge }) {
  const size = challenge ? 320 : 220;
  const center = challenge ? 95 : 70;
  return (
    <RigidBody type="fixed" colliders={false} position={[0, -0.08, center]}>
      <CuboidCollider args={[size / 2, 0.08, size / 2]} friction={0.85} restitution={0.05} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.08, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#211024" roughness={0.95} metalness={0.05} />
      </mesh>
      <gridHelper args={[size, challenge ? 160 : 110, '#a02a9e', '#4a184f']} position={[0, 0.09, 0]} />
    </RigidBody>
  );
}

function createFlightState(motors) {
  motors.splice(0, motors.length, ...createMotorThrusts());
  return {
    motors,
    altitudeTarget: 2.2,
    yawTarget: 0,
    battery: 100,
    checkpoint: 0,
    elapsed: 0,
    controllerFault: false,
    desiredPitch: 0,
    desiredRoll: 0,
    memories: {
      pitch: createMemory(),
      roll: createMemory(),
      yaw: createMemory(),
      altitude: createMemory()
    }
  };
}

function Simulator({ launched, mode = 'training', controller, gains, resetSignal, onTelemetry, onCheckpoint }) {
  const gates = gatesForMode(mode);
  const challenge = mode === 'race';
  const { camera } = useThree();
  const keys = useFlightKeys(launched);
  const bodyRef = useRef();
  const motorsVisual = useRef(createMotorThrusts());
  const flightState = useRef(createFlightState(motorsVisual.current));
  const telemetryTime = useRef(0);
  const onTelemetryRef = useRef(onTelemetry);
  const onCheckpointRef = useRef(onCheckpoint);
  const controllerRef = useRef(controller);
  const fallbackRef = useRef(builtInController(gains));
  const scratch = useMemo(() => ({
    attitude: new THREE.Euler(0, 0, 0, 'YXZ'),
    orientation: new THREE.Quaternion(),
    inverseOrientation: new THREE.Quaternion(),
    bodyUp: new THREE.Vector3(),
    force: new THREE.Vector3(),
    bodyTorque: new THREE.Vector3(),
    worldTorque: new THREE.Vector3(),
    relativeAir: new THREE.Vector3(),
    wind: new THREE.Vector3(),
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    bodyAngularVelocity: new THREE.Vector3(),
    cameraTarget: new THREE.Vector3(),
    cameraLook: new THREE.Vector3()
  }), []);

  onTelemetryRef.current = onTelemetry;
  onCheckpointRef.current = onCheckpoint;
  controllerRef.current = controller;
  fallbackRef.current = builtInController(gains);

  const resetPhysics = useCallback(() => {
    flightState.current = createFlightState(motorsVisual.current);
    const body = bodyRef.current;
    if (body) {
      body.setTranslation(FLIGHT_START, true);
      body.setRotation(IDENTITY_ROTATION, true);
      body.setLinvel(ZERO, true);
      body.setAngvel(ZERO, true);
      body.resetForces(true);
      body.resetTorques(true);
    }
    camera.position.set(0, 4.6, -5);
  }, [camera]);
  useEffect(() => { resetPhysics(); }, [resetSignal, launched, mode, resetPhysics]);

  useBeforePhysicsStep((world) => {
    if (!launched || !bodyRef.current) return;
    const delta = world.timestep;
    const body = bodyRef.current;
    const flight = flightState.current;
    const { attitude, orientation, inverseOrientation, bodyUp, force, bodyTorque, worldTorque, relativeAir, wind, position, velocity, bodyAngularVelocity } = scratch;
    const translation = body.translation();
    const rotation = body.rotation();
    const linearVelocity = body.linvel();
    const angularVelocity = body.angvel();
    position.set(translation.x, translation.y, translation.z);
    velocity.set(linearVelocity.x, linearVelocity.y, linearVelocity.z);
    orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    inverseOrientation.copy(orientation).invert();
    bodyAngularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z).applyQuaternion(inverseOrientation);
    attitude.setFromQuaternion(orientation, 'YXZ');

    flight.elapsed += delta;
    const { forwardInput, rightInput, upInput, yawInput } = readFlightInputs(keys.current);
    flight.altitudeTarget = clamp(flight.altitudeTarget + upInput * delta * 2.2, 0.45, 10);
    flight.yawTarget = wrapAngle(flight.yawTarget + yawInput * delta * 1.1);
    // Keep diagonal input inside the same circular attitude envelope as a
    // single-axis command. Speed then comes from the real tilted thrust vector.
    const inputMagnitude = Math.hypot(forwardInput, rightInput);
    const inputScale = inputMagnitude > 1 ? 1 / inputMagnitude : 1;
    const desiredPitch = forwardInput * inputScale * rad(MAX_FLIGHT_TILT_DEGREES);
    const desiredRoll = rightInput * inputScale * rad(MAX_FLIGHT_TILT_DEGREES);
    flight.desiredPitch = desiredPitch;
    flight.desiredRoll = desiredRoll;
    const activeController = controllerRef.current || fallbackRef.current;
    const control = (error, memory) => {
      try {
        const output = Number(activeController(error, delta, memory, gains));
        if (!Number.isFinite(output)) throw new Error('Non-finite PID output');
        return clamp(output, -2.5, 2.5);
      } catch {
        flight.controllerFault = true;
        return clamp(fallbackRef.current(error, delta, memory), -2.5, 2.5);
      }
    };

    // One validated learner function, four independent PID memories. Outputs
    // become requested torques/collective acceleration, then the motor mixer
    // and Rapier—not hand-authored position code—determine the actual motion.
    const pitchOutput = control(wrapAngle(desiredPitch - attitude.x), flight.memories.pitch);
    const rollOutput = control(wrapAngle(desiredRoll - attitude.z), flight.memories.roll);
    const yawOutput = control(wrapAngle(flight.yawTarget - attitude.y), flight.memories.yaw);
    const altitudeOutput = control(flight.altitudeTarget - position.y, flight.memories.altitude);

    bodyUp.set(0, 1, 0).applyQuaternion(orientation);
    const actualThrust = stepMotorModel({
      motors: flight.motors,
      pitchOutput,
      rollOutput,
      yawOutput,
      altitudeOutput,
      bodyUpY: bodyUp.y,
      delta,
      battery: flight.battery
    });
    const torque = motorBodyTorque(flight.motors, bodyAngularVelocity.y);
    bodyTorque.set(torque.x, torque.y, torque.z);
    worldTorque.copy(bodyTorque).applyQuaternion(orientation);

    // Rapier integrates the rigid body's mass, inertia tensor, gyroscopic motion,
    // gravity, collision response, restitution, friction, and fixed time step.
    const groundEffect = 1 + 0.1 * Math.exp(-position.y / 0.45);
    wind.set(Math.sin(flight.elapsed * 0.37) * 0.7, 0, Math.cos(flight.elapsed * 0.21) * 0.25);
    relativeAir.copy(velocity).sub(wind);
    force.copy(bodyUp).multiplyScalar(actualThrust * groundEffect);
    force.addScaledVector(relativeAir, -LINEAR_DRAG * relativeAir.length());
    force.addScaledVector(relativeAir, -0.08);
    body.resetForces(true);
    body.resetTorques(true);
    body.addForce(force, true);
    body.addTorque(worldTorque, true);
    flight.battery = Math.max(0, flight.battery - delta * (0.08 + actualThrust / (MAX_MOTOR_THRUST * 4) * 0.18));

    const target = gates[flight.checkpoint];
    if (isGateCleared(position, target, mode)) {
      flight.checkpoint += 1;
      onCheckpointRef.current?.(flight.checkpoint, flight.elapsed);
    }
  });

  useFrame((_, rawDelta) => {
    if (!bodyRef.current) return;
    const delta = clamp(rawDelta, 0, 0.033);
    const body = bodyRef.current;
    const flight = flightState.current;
    const { attitude, orientation, position, velocity, cameraTarget, cameraLook } = scratch;
    const translation = body.translation();
    const rotation = body.rotation();
    const linearVelocity = body.linvel();
    position.set(translation.x, translation.y, translation.z);
    velocity.set(linearVelocity.x, linearVelocity.y, linearVelocity.z);
    orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    attitude.setFromQuaternion(orientation, 'YXZ');
    const yaw = attitude.y;

    cameraTarget.set(position.x - Math.sin(yaw) * 5, position.y + 2.5, position.z - Math.cos(yaw) * 5);
    camera.position.lerp(cameraTarget, 1 - Math.pow(0.001, delta));
    cameraLook.set(position.x + Math.sin(yaw) * 5, position.y + 0.15, position.z + Math.cos(yaw) * 5);
    camera.lookAt(cameraLook);

    telemetryTime.current += delta;
    if (telemetryTime.current > 0.08) {
      telemetryTime.current = 0;
      const target = gates[flight.checkpoint];
      onTelemetryRef.current?.({
        altitude: position.y,
        speed: velocity.length(),
        tilt: Math.hypot(deg(attitude.x), deg(attitude.z)),
        commandedTilt: Math.hypot(deg(flight.desiredPitch), deg(flight.desiredRoll)),
        heading: ((-deg(yaw) % 360) + 360) % 360,
        battery: flight.battery,
        elapsed: flight.elapsed,
        checkpoint: flight.checkpoint,
        distance: target ? Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z) : 0,
        motors: flight.motors.map((thrust) => Math.round(thrust / MAX_MOTOR_THRUST * 100)),
        controllerFault: flight.controllerFault
      });
    }
  });

  const checkpoint = flightState.current.checkpoint;
  return (
    <>
      <RigidBody
        ref={bodyRef}
        position={[FLIGHT_START.x, FLIGHT_START.y, FLIGHT_START.z]}
        colliders={false}
        canSleep={false}
        ccd
        linearDamping={LINEAR_DAMPING}
        angularDamping={ANGULAR_DAMPING}
      >
        <CuboidCollider
          args={[BODY_HALF_EXTENTS.x, BODY_HALF_EXTENTS.y, BODY_HALF_EXTENTS.z]}
          friction={0.7}
          restitution={0.12}
          massProperties={{
            mass: MASS,
            centerOfMass: ZERO,
            principalAngularInertia: INERTIA,
            angularInertiaLocalFrame: IDENTITY_ROTATION
          }}
        />
        <Drone motorsRef={motorsVisual} />
      </RigidBody>
      {gates.map((position, index) => <Gate key={index} position={position} challenge={challenge} active={index === checkpoint} passed={index < checkpoint} />)}
      {challenge && <CourseLights gates={gates} checkpoint={checkpoint} />}
      <RangeObjects challenge={challenge} />
    </>
  );
}

export default function FlightScene(props) {
  const challenge = props.mode === 'race';
  return (
    <Canvas
      className="three-flight-canvas"
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [0, 4.6, -5], fov: 55, near: 0.1, far: 320 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#160313']} />
      <fog attach="fog" args={['#160313', challenge ? 48 : 35, challenge ? 220 : 125]} />
      <hemisphereLight args={['#efb2ff', '#200a21', 1.65]} />
      <directionalLight castShadow position={[10, 18, -6]} intensity={2.1} color="#ffe8fa" shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <Physics gravity={[0, -GRAVITY, 0]} timeStep={1 / 60} interpolate paused={!props.launched}>
          <Ground challenge={challenge} />
          <Simulator {...props} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
