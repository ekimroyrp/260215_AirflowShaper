import { Object3D, Quaternion, Vector3 } from 'three';
import { computeWakeDecay, sampleCurlNoise } from './flowField';

export interface ObstacleFieldData {
  center: Vector3;
  normal: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
  halfWidth: number;
  halfHeight: number;
  influenceRadius: number;
  wakeStrength: number;
}

export function createObstacleFieldData(): ObstacleFieldData {
  return {
    center: new Vector3(),
    normal: new Vector3(0, 0, 1),
    xAxis: new Vector3(1, 0, 0),
    yAxis: new Vector3(0, 1, 0),
    halfWidth: 0.5,
    halfHeight: 0.5,
    influenceRadius: 0.45,
    wakeStrength: 0.8,
  };
}

const worldScaleScratch = new Vector3();
const worldQuaternionScratch = new Quaternion();

export function updateObstacleFieldDataFromObject(
  object: Object3D,
  influenceRadius: number,
  wakeStrength: number,
  target: ObstacleFieldData,
): ObstacleFieldData {
  object.getWorldPosition(target.center);
  object.getWorldScale(worldScaleScratch);
  object.getWorldQuaternion(worldQuaternionScratch);

  target.normal.set(0, 0, 1).applyQuaternion(worldQuaternionScratch).normalize();
  target.xAxis.set(1, 0, 0).applyQuaternion(worldQuaternionScratch).normalize();
  target.yAxis.set(0, 1, 0).applyQuaternion(worldQuaternionScratch).normalize();
  target.halfWidth = Math.max(1e-4, Math.abs(worldScaleScratch.x) * 0.5);
  target.halfHeight = Math.max(1e-4, Math.abs(worldScaleScratch.y) * 0.5);
  target.influenceRadius = influenceRadius;
  target.wakeStrength = wakeStrength;
  return target;
}

const toCenterScratch = new Vector3();
const radialScratch = new Vector3();
const flowProjectionScratch = new Vector3();
const lateralScratch = new Vector3();
const wakeScratch = new Vector3();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function applyObstacleInteraction(
  position: Vector3,
  velocity: Vector3,
  obstacle: ObstacleFieldData,
  flowDirection: Vector3,
  time: number,
  turbulenceScale: number,
): void {
  toCenterScratch.copy(position).sub(obstacle.center);

  const localX = toCenterScratch.dot(obstacle.xAxis);
  const localY = toCenterScratch.dot(obstacle.yAxis);
  const localZ = toCenterScratch.dot(obstacle.normal);
  const absZ = Math.abs(localZ);

  const influence = Math.max(0.01, obstacle.influenceRadius);
  const nearestX = clamp(localX, -obstacle.halfWidth, obstacle.halfWidth);
  const nearestY = clamp(localY, -obstacle.halfHeight, obstacle.halfHeight);
  const dx = localX - nearestX;
  const dy = localY - nearestY;
  const radialEdgeDistance = Math.hypot(dx, dy);
  const insidePanel = Math.abs(localX) <= obstacle.halfWidth && Math.abs(localY) <= obstacle.halfHeight;
  const nearSurface = absZ <= influence * 1.3 && radialEdgeDistance <= influence;

  if (nearSurface) {
    const barrierThickness = Math.min(0.05, influence * 0.35);
    if (insidePanel && absZ < barrierThickness) {
      const side = localZ >= 0 ? 1 : -1;
      const pushOut = barrierThickness - absZ + 1e-4;
      position.addScaledVector(obstacle.normal, pushOut * side);
    }

    const normalComponent = velocity.dot(obstacle.normal);
    velocity.addScaledVector(obstacle.normal, -normalComponent);

    radialScratch
      .copy(obstacle.xAxis)
      .multiplyScalar(localX)
      .addScaledVector(obstacle.yAxis, localY);
    if (radialScratch.lengthSq() > 1e-6) {
      radialScratch.normalize();
      const blend = 1 - clamp(absZ / (influence * 1.3), 0, 1);
      velocity.addScaledVector(radialScratch, 0.75 * blend);
    }
  }

  const downstream = toCenterScratch.dot(flowDirection);
  if (downstream <= 0) {
    return;
  }

  flowProjectionScratch.copy(flowDirection).multiplyScalar(downstream);
  lateralScratch.copy(toCenterScratch).sub(flowProjectionScratch);
  const lateralDistance = lateralScratch.length();
  const wakeRadius = Math.max(obstacle.halfWidth, obstacle.halfHeight) + influence;
  const wakeFactor = computeWakeDecay(downstream, lateralDistance, wakeRadius);
  if (wakeFactor <= 1e-5) {
    return;
  }

  sampleCurlNoise(position, time, turbulenceScale, wakeScratch);
  wakeScratch.addScaledVector(flowDirection, -wakeScratch.dot(flowDirection));
  const wakeLengthSq = wakeScratch.lengthSq();
  if (wakeLengthSq > 1e-6) {
    wakeScratch.multiplyScalar(1 / Math.sqrt(wakeLengthSq));
    velocity.addScaledVector(wakeScratch, wakeFactor * obstacle.wakeStrength);
  }
}
