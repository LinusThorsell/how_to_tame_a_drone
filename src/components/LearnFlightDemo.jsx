import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { REPLAY_DURATION_SECONDS } from '../scenarios';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function Rotor({ position, ghost = false }) {
  const blades = useRef(null);

  useFrame((_, delta) => {
    if (blades.current && !ghost) blades.current.rotation.y += delta * 24;
  });

  return (
    <group position={position}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.3, 0.024, 8, 32]} />
        <meshBasicMaterial color={ghost ? '#fbd6ec' : '#ff159f'} transparent opacity={ghost ? 0.16 : 0.82} />
      </mesh>
      {!ghost && (
        <group ref={blades}>
          <mesh>
            <boxGeometry args={[0.66, 0.018, 0.045]} />
            <meshStandardMaterial color="#ff83c8" emissive="#ff0096" emissiveIntensity={1.1} />
          </mesh>
          <mesh rotation-y={Math.PI / 2}>
            <boxGeometry args={[0.66, 0.018, 0.045]} />
            <meshStandardMaterial color="#b96cff" emissive="#8e32d5" emissiveIntensity={0.8} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function DroneBody({ ghost = false }) {
  const material = ghost
    ? <meshBasicMaterial color="#fbd6ec" wireframe transparent opacity={0.14} />
    : <meshStandardMaterial color="#35123e" metalness={0.68} roughness={0.28} emissive="#7d175c" emissiveIntensity={0.45} />;

  return (
    <group>
      <mesh rotation-y={Math.PI / 4}>
        <boxGeometry args={[2.1, 0.075, 0.075]} />
        {material}
      </mesh>
      <mesh rotation-y={-Math.PI / 4}>
        <boxGeometry args={[2.1, 0.075, 0.075]} />
        {ghost
          ? <meshBasicMaterial color="#fbd6ec" wireframe transparent opacity={0.14} />
          : <meshStandardMaterial color="#35123e" metalness={0.68} roughness={0.28} emissive="#7d175c" emissiveIntensity={0.45} />}
      </mesh>
      <mesh>
        <boxGeometry args={[0.72, 0.28, 0.5]} />
        {ghost
          ? <meshBasicMaterial color="#fbd6ec" wireframe transparent opacity={0.18} />
          : <meshStandardMaterial color="#21091f" metalness={0.76} roughness={0.22} emissive="#ff0096" emissiveIntensity={0.32} />}
      </mesh>
      {!ghost && (
        <mesh position={[0, 0.03, 0.31]} rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.09, 0.22, 3]} />
          <meshBasicMaterial color="#ffc247" />
        </mesh>
      )}
      <Rotor position={[0.74, 0, 0.74]} ghost={ghost} />
      <Rotor position={[-0.74, 0, 0.74]} ghost={ghost} />
      <Rotor position={[0.74, 0, -0.74]} ghost={ghost} />
      <Rotor position={[-0.74, 0, -0.74]} ghost={ghost} />
    </group>
  );
}

function TeachingScene({ run, mode, actualRef, errorRef, leftMotorRef, rightMotorRef, onTimeRef }) {
  const drone = useRef(null);
  const target = useRef(null);
  const phase = useRef(0);
  const reportFrame = useRef(0);

  useEffect(() => {
    phase.current = 0;
    onTimeRef.current?.(0);
  }, [run, onTimeRef]);

  useFrame((_, delta) => {
    if (!drone.current || !target.current) return;
    if (!run?.points?.length) {
      drone.current.rotation.z = THREE.MathUtils.lerp(drone.current.rotation.z, 0, 0.12);
      target.current.rotation.z = THREE.MathUtils.lerp(target.current.rotation.z, 0, 0.12);
      return;
    }
    phase.current = (phase.current + delta / REPLAY_DURATION_SECONDS) % 1;
    const point = run.points[Math.min(run.points.length - 1, Math.floor(phase.current * run.points.length))];
    const actual = point.actual;
    const targetAngle = point.target;
    const error = clamp(point.error, -45, 45);
    const output = clamp(point.output || 0, -2.5, 2.5);
    const wobble = mode === 'high' ? Math.sin(phase.current * Math.PI * 18) * 0.035 : 0;

    drone.current.rotation.z = -THREE.MathUtils.degToRad(actual);
    drone.current.position.y = THREE.MathUtils.lerp(drone.current.position.y, error * 0.012 + Math.sin(phase.current * Math.PI * 4) * 0.035, 0.12);
    drone.current.position.x = THREE.MathUtils.lerp(drone.current.position.x, wobble + clamp(error * 0.008, -0.34, 0.34), 0.12);
    target.current.rotation.z = -THREE.MathUtils.degToRad(targetAngle);

    reportFrame.current += 1;
    if (reportFrame.current % 4 === 0) {
      if (actualRef.current) actualRef.current.textContent = `${actual.toFixed(1)}°`;
      if (errorRef.current) errorRef.current.textContent = `${Math.abs(error).toFixed(1)}° error`;
      if (leftMotorRef.current) leftMotorRef.current.style.transform = `scaleY(${0.36 + clamp((output + 2.5) / 5, 0, 1) * 0.64})`;
      if (rightMotorRef.current) rightMotorRef.current.style.transform = `scaleY(${0.36 + clamp((-output + 2.5) / 5, 0, 1) * 0.64})`;
      onTimeRef.current?.(point.time);
    }
  });

  return (
    <>
      <ambientLight intensity={1.4} />
      <pointLight position={[2.5, 3.5, 3]} intensity={24} color="#ff2cad" distance={8} />
      <pointLight position={[-3, 1.5, 2]} intensity={16} color="#9257ff" distance={8} />
      <gridHelper args={[9, 18, '#77205e', '#351235']} position={[0, -1.25, 0]} />
      <group ref={target} position={[0, 0.04, -0.55]}>
        <DroneBody ghost />
      </group>
      <group ref={drone} position={[0, 0, 0.25]}>
        <DroneBody />
      </group>
    </>
  );
}

export default function LearnFlightDemo({ run, mode, label, idle = false, className = '', onTime }) {
  const actualRef = useRef(null);
  const errorRef = useRef(null);
  const leftMotorRef = useRef(null);
  const rightMotorRef = useRef(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  return (
    <div className={`learn-flight-demo mode-${mode} ${idle ? 'is-idle' : ''} ${className}`}>
      <div className="learn-flight-readout"><span>ACTUAL ATTITUDE</span><b ref={actualRef}>{idle ? '—' : '0.0°'}</b></div>
      <div className="learn-flight-target"><span>GHOST</span> target attitude</div>
      <Canvas
        camera={{ position: [0, 2.5, 5.4], fov: 39 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        aria-label={`Three.js drone demonstration: ${label}`}
      >
        <TeachingScene
          run={run}
          mode={mode}
          actualRef={actualRef}
          errorRef={errorRef}
          leftMotorRef={leftMotorRef}
          rightMotorRef={rightMotorRef}
          onTimeRef={onTimeRef}
        />
      </Canvas>
      <div className="learn-flight-error" ref={errorRef}>{idle ? 'RUN VALIDATION TO ANIMATE' : '20.0° error'}</div>
      <div className="motor-teaching" aria-hidden="true">
        <span>L</span><i><b ref={leftMotorRef} /></i>
        <em>MOTOR CORRECTION</em>
        <i><b ref={rightMotorRef} /></i><span>R</span>
      </div>
    </div>
  );
}
