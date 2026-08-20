export const CHASE_CAMERA_FOV = 55;
export const FPV_CAMERA_FOV = 78;

export function updateFlightCameraFov(camera, cameraMode) {
  camera.fov = cameraMode === 'fpv' ? FPV_CAMERA_FOV : CHASE_CAMERA_FOV;
  camera.updateProjectionMatrix();
}

export function updateFlightCamera({
  camera,
  cameraMode,
  position,
  orientation,
  yaw,
  delta,
  cameraTarget,
  cameraLook,
  cameraForward,
  cameraUp
}) {
  if (cameraMode === 'fpv') {
    cameraTarget.set(0, 0.12, 0.42).applyQuaternion(orientation).add(position);
    cameraForward.set(0, 0, 10).applyQuaternion(orientation);
    cameraUp.set(0, 1, 0).applyQuaternion(orientation);
    camera.position.copy(cameraTarget);
    camera.up.copy(cameraUp);
    cameraLook.copy(cameraTarget).add(cameraForward);
    camera.lookAt(cameraLook);
    return;
  }

  camera.up.set(0, 1, 0);
  cameraTarget.set(position.x - Math.sin(yaw) * 5, position.y + 2.5, position.z - Math.cos(yaw) * 5);
  camera.position.lerp(cameraTarget, 1 - Math.pow(0.001, delta));
  cameraLook.set(position.x + Math.sin(yaw) * 5, position.y + 0.15, position.z + Math.cos(yaw) * 5);
  camera.lookAt(cameraLook);
}
