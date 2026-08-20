import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  CHASE_CAMERA_FOV,
  FPV_CAMERA_FOV,
  updateFlightCamera,
  updateFlightCameraFov
} from './flightCamera.js';

const closeVector = (actual, expected, tolerance = 1e-9) => {
  assert.ok(actual.distanceTo(expected) < tolerance, `${actual.toArray()} != ${expected.toArray()}`);
};

test('FPV camera is nose-mounted and follows the full aircraft attitude', () => {
  const camera = new THREE.PerspectiveCamera();
  const position = new THREE.Vector3(2, 3, 4);
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.4, 0.5, 'YXZ'));
  const cameraTarget = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();

  updateFlightCamera({
    camera,
    cameraMode: 'fpv',
    position,
    orientation,
    yaw: 0,
    delta: 1 / 60,
    cameraTarget,
    cameraLook,
    cameraForward,
    cameraUp
  });

  const expectedPosition = new THREE.Vector3(0, 0.12, 0.42).applyQuaternion(orientation).add(position);
  const expectedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
  const expectedUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
  closeVector(camera.position, expectedPosition);
  closeVector(camera.getWorldDirection(new THREE.Vector3()), expectedForward);
  closeVector(camera.up, expectedUp);
});

test('camera mode selects chase and wide-angle FPV fields of view', () => {
  const camera = new THREE.PerspectiveCamera();
  updateFlightCameraFov(camera, 'fpv');
  assert.equal(camera.fov, FPV_CAMERA_FOV);
  updateFlightCameraFov(camera, 'chase');
  assert.equal(camera.fov, CHASE_CAMERA_FOV);
});
