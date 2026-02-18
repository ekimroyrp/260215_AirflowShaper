import { Matrix3, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { computeWakeDecay, sampleCurlNoise } from './flowField';

export type ObstacleShapeKind = 'plane' | 'box' | 'sphere' | 'pyramid' | 'torus';

export interface ObstacleFieldData {
  shapeKind: ObstacleShapeKind;
  center: Vector3;
  normal: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
  worldMatrix: Matrix4;
  inverseWorldMatrix: Matrix4;
  worldNormalMatrix: Matrix3;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
  boundingRadius: number;
  sphereRadius: number;
  torusMajorRadius: number;
  torusMinorRadius: number;
  influenceRadius: number;
  wakeStrength: number;
}

export function createObstacleFieldData(): ObstacleFieldData {
  return {
    shapeKind: 'plane',
    center: new Vector3(),
    normal: new Vector3(0, 0, 1),
    xAxis: new Vector3(1, 0, 0),
    yAxis: new Vector3(0, 1, 0),
    worldMatrix: new Matrix4(),
    inverseWorldMatrix: new Matrix4(),
    worldNormalMatrix: new Matrix3(),
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    halfWidth: 0.5,
    halfHeight: 0.5,
    halfDepth: 0.01,
    boundingRadius: Math.sqrt(0.5 * 0.5 + 0.5 * 0.5 + 0.01 * 0.01),
    sphereRadius: 0.5,
    torusMajorRadius: 0.34,
    torusMinorRadius: 0.16,
    influenceRadius: 0.45,
    wakeStrength: 0.8,
  };
}

const worldScaleScratch = new Vector3();
const worldQuaternionScratch = new Quaternion();
const localSizeScratch = new Vector3();
const signedDeltaScratch = new Vector3();
const surfaceNormalLocalScratch = new Vector3();
const surfaceNormalWorldScratch = new Vector3();
const nearestLocalScratch = new Vector3();
const nearestWorldScratch = new Vector3();
const localPositionScratch = new Vector3();

export function updateObstacleFieldDataFromObject(
  object: Object3D,
  influenceRadius: number,
  wakeStrength: number,
  target: ObstacleFieldData,
): ObstacleFieldData {
  object.updateMatrixWorld(true);
  object.getWorldPosition(target.center);
  object.getWorldScale(worldScaleScratch);
  object.getWorldQuaternion(worldQuaternionScratch);
  target.worldMatrix.copy(object.matrixWorld);
  target.inverseWorldMatrix.copy(object.matrixWorld).invert();
  target.worldNormalMatrix.getNormalMatrix(object.matrixWorld);

  const userShape = object.userData?.obstacleShape;
  target.shapeKind =
    userShape === 'box' || userShape === 'sphere' || userShape === 'pyramid' || userShape === 'torus' ? userShape : 'plane';

  target.normal.set(0, 0, 1).applyQuaternion(worldQuaternionScratch).normalize();
  target.xAxis.set(1, 0, 0).applyQuaternion(worldQuaternionScratch).normalize();
  target.yAxis.set(0, 1, 0).applyQuaternion(worldQuaternionScratch).normalize();

  const geometry = (object as Object3D & { geometry?: { computeBoundingBox: () => void; boundingBox: { getSize: (target: Vector3) => Vector3 } | null } }).geometry;
  if (geometry) {
    geometry.computeBoundingBox();
  }
  const localSize = geometry?.boundingBox ? geometry.boundingBox.getSize(localSizeScratch) : localSizeScratch.set(1, 1, 1);
  const absScaleX = Math.max(1e-4, Math.abs(worldScaleScratch.x));
  const absScaleY = Math.max(1e-4, Math.abs(worldScaleScratch.y));
  const absScaleZ = Math.max(1e-4, Math.abs(worldScaleScratch.z));
  target.scaleX = absScaleX;
  target.scaleY = absScaleY;
  target.scaleZ = absScaleZ;

  target.halfWidth = Math.max(1e-4, localSize.x * 0.5);
  target.halfHeight = Math.max(1e-4, localSize.y * 0.5);
  target.halfDepth = Math.max(1e-4, localSize.z * 0.5);
  const worldHalfWidth = target.halfWidth * absScaleX;
  const worldHalfHeight = target.halfHeight * absScaleY;
  const worldHalfDepth = target.halfDepth * absScaleZ;
  target.boundingRadius = Math.sqrt(
    worldHalfWidth * worldHalfWidth + worldHalfHeight * worldHalfHeight + worldHalfDepth * worldHalfDepth,
  );

  const params = object.userData?.obstacleParams as Partial<{
    radius: number;
    majorRadius: number;
    minorRadius: number;
  }> | undefined;
  target.sphereRadius = Math.max(1e-4, params?.radius ?? Math.max(localSize.x, localSize.y, localSize.z) * 0.5);
  target.torusMajorRadius = Math.max(1e-4, params?.majorRadius ?? 0.34);
  target.torusMinorRadius = Math.max(1e-4, params?.minorRadius ?? 0.16);
  target.influenceRadius = influenceRadius;
  target.wakeStrength = wakeStrength;
  return target;
}

const toCenterScratch = new Vector3();
const radialScratch = new Vector3();
const flowProjectionScratch = new Vector3();
const flowTangentScratch = new Vector3();
const lateralScratch = new Vector3();
const wakeScratch = new Vector3();
const recoveryTargetScratch = new Vector3();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeLocalSurfaceDistanceAndNormal(
  shapeKind: ObstacleShapeKind,
  localX: number,
  localY: number,
  localZ: number,
  obstacle: ObstacleFieldData,
): number {
  if (shapeKind === 'sphere') {
    const radius = Math.max(1e-4, obstacle.sphereRadius);
    const invRadiusSq = 1 / (radius * radius);
    const f = (localX * localX + localY * localY + localZ * localZ) * invRadiusSq - 1;

    const gx = 2 * localX * invRadiusSq;
    const gy = 2 * localY * invRadiusSq;
    const gz = 2 * localZ * invRadiusSq;
    const gradLength = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (gradLength > 1e-6) {
      surfaceNormalLocalScratch.set(gx / gradLength, gy / gradLength, gz / gradLength);
    } else {
      surfaceNormalLocalScratch.set(0, 0, 1);
    }
    const signedDistance = gradLength > 1e-6 ? f / gradLength : radius;
    nearestLocalScratch.set(
      localX - surfaceNormalLocalScratch.x * signedDistance,
      localY - surfaceNormalLocalScratch.y * signedDistance,
      localZ - surfaceNormalLocalScratch.z * signedDistance,
    );
    return signedDistance;
  }

  if (shapeKind === 'torus') {
    const major = Math.max(1e-4, obstacle.torusMajorRadius);
    const minor = Math.max(1e-4, obstacle.torusMinorRadius);
    const xy = Math.sqrt(localX * localX + localY * localY);
    const qx = xy - major;
    const qy = localZ;
    const qLength = Math.sqrt(qx * qx + qy * qy);
    const signedDistance = qLength - minor;

    if (xy > 1e-6 && qLength > 1e-6) {
      const radialX = localX / xy;
      const radialY = localY / xy;
      const tangentFactor = qx / qLength;
      surfaceNormalLocalScratch.set(radialX * tangentFactor, radialY * tangentFactor, qy / qLength).normalize();
    } else {
      surfaceNormalLocalScratch.set(0, 0, 1);
    }

    nearestLocalScratch.set(
      localX - surfaceNormalLocalScratch.x * signedDistance,
      localY - surfaceNormalLocalScratch.y * signedDistance,
      localZ - surfaceNormalLocalScratch.z * signedDistance,
    );
    return signedDistance;
  }

  if (shapeKind === 'pyramid') {
    const halfWidth = Math.max(1e-4, obstacle.halfWidth);
    const halfHeight = Math.max(1e-4, obstacle.halfHeight);
    const halfDepth = Math.max(1e-4, obstacle.halfDepth);
    const zClamped = clamp(localZ, -halfDepth, halfDepth);
    const section = clamp((halfDepth - zClamped) / (2 * halfDepth), 0, 1);
    const allowedX = Math.max(1e-5, halfWidth * section);
    const allowedY = Math.max(1e-5, halfHeight * section);
    const nearestX = clamp(localX, -allowedX, allowedX);
    const nearestY = clamp(localY, -allowedY, allowedY);
    nearestLocalScratch.set(nearestX, nearestY, zClamped);

    signedDeltaScratch.set(localX - nearestX, localY - nearestY, localZ - zClamped);
    const outsideDistance = signedDeltaScratch.length();
    const inside =
      localZ >= -halfDepth &&
      localZ <= halfDepth &&
      Math.abs(localX) <= allowedX &&
      Math.abs(localY) <= allowedY;

    if (!inside) {
      if (outsideDistance > 1e-6) {
        surfaceNormalLocalScratch.copy(signedDeltaScratch).normalize();
      } else {
        surfaceNormalLocalScratch.set(0, 0, 1);
      }
      return outsideDistance;
    }

    const sideX = allowedX - Math.abs(localX);
    const sideY = allowedY - Math.abs(localY);
    const top = halfDepth - localZ;
    const base = localZ + halfDepth;
    const insideDepth = Math.min(sideX, sideY, top, base);

    if (insideDepth === top) {
      surfaceNormalLocalScratch.set(0, 0, 1);
    } else if (insideDepth === base) {
      surfaceNormalLocalScratch.set(0, 0, -1);
    } else if (insideDepth === sideX) {
      surfaceNormalLocalScratch.set(Math.sign(localX) || 1, 0, halfWidth / (2 * halfDepth)).normalize();
    } else {
      surfaceNormalLocalScratch.set(0, Math.sign(localY) || 1, halfHeight / (2 * halfDepth)).normalize();
    }

    nearestLocalScratch.set(
      localX - surfaceNormalLocalScratch.x * insideDepth,
      localY - surfaceNormalLocalScratch.y * insideDepth,
      localZ - surfaceNormalLocalScratch.z * insideDepth,
    );
    return -insideDepth;
  }

  // Box and plane fallback use oriented box logic.
  const halfWidth = Math.max(1e-4, obstacle.halfWidth);
  const halfHeight = Math.max(1e-4, obstacle.halfHeight);
  const halfDepth = shapeKind === 'plane' ? Math.max(1e-4, obstacle.influenceRadius * 0.25) : Math.max(1e-4, obstacle.halfDepth);

  const nearestX = clamp(localX, -halfWidth, halfWidth);
  const nearestY = clamp(localY, -halfHeight, halfHeight);
  const nearestZ = clamp(localZ, -halfDepth, halfDepth);
  nearestLocalScratch.set(nearestX, nearestY, nearestZ);

  signedDeltaScratch.set(localX - nearestX, localY - nearestY, localZ - nearestZ);
  const outsideDistance = signedDeltaScratch.length();
  if (outsideDistance > 1e-6) {
    surfaceNormalLocalScratch.copy(signedDeltaScratch).normalize();
    return outsideDistance;
  }

  const insideX = halfWidth - Math.abs(localX);
  const insideY = halfHeight - Math.abs(localY);
  const insideZ = halfDepth - Math.abs(localZ);
  if (insideX <= insideY && insideX <= insideZ) {
    surfaceNormalLocalScratch.set(Math.sign(localX) || 1, 0, 0);
    return -insideX;
  }
  if (insideY <= insideX && insideY <= insideZ) {
    surfaceNormalLocalScratch.set(0, Math.sign(localY) || 1, 0);
    return -insideY;
  }
  surfaceNormalLocalScratch.set(0, 0, Math.sign(localZ) || 1);
  return -insideZ;
}

export function applyObstacleInteraction(
  position: Vector3,
  velocity: Vector3,
  obstacle: ObstacleFieldData,
  flowDirection: Vector3,
  time: number,
  turbulenceScale: number,
  turbulenceStrength: number,
): boolean {
  toCenterScratch.copy(position).sub(obstacle.center);

  localPositionScratch.copy(position).applyMatrix4(obstacle.inverseWorldMatrix);
  const localX = localPositionScratch.x;
  const localY = localPositionScratch.y;
  const localZ = localPositionScratch.z;
  const influence = Math.max(0.01, obstacle.influenceRadius);
  computeLocalSurfaceDistanceAndNormal(obstacle.shapeKind, localX, localY, localZ, obstacle);
  surfaceNormalWorldScratch.copy(surfaceNormalLocalScratch).applyMatrix3(obstacle.worldNormalMatrix).normalize();
  nearestWorldScratch.copy(nearestLocalScratch).applyMatrix4(obstacle.worldMatrix);
  signedDeltaScratch.copy(position).sub(nearestWorldScratch);
  const signedDistance = signedDeltaScratch.dot(surfaceNormalWorldScratch);
  const nearSurface = signedDistance <= influence;

  if (nearSurface) {
    const barrierThickness = Math.min(0.05, influence * 0.35);
    if (signedDistance < barrierThickness) {
      const pushOut = barrierThickness - signedDistance + 1e-4;
      position.addScaledVector(surfaceNormalWorldScratch, pushOut);
    }

    const normalComponent = velocity.dot(surfaceNormalWorldScratch);
    velocity.addScaledVector(surfaceNormalWorldScratch, -normalComponent);

    radialScratch.copy(toCenterScratch).addScaledVector(surfaceNormalWorldScratch, -toCenterScratch.dot(surfaceNormalWorldScratch));
    if (radialScratch.lengthSq() > 1e-6) {
      radialScratch.normalize();
      const blend = 1 - clamp(signedDistance / influence, 0, 1);
      // Always provide deterministic smooth bypass steering around the surface.
      velocity.addScaledVector(radialScratch, 0.65 * blend);
    }

    // Pull flow back toward forward direction (surface tangent only) to regain straight stream.
    const forwardPull = clamp(signedDistance / influence, 0, 1);
    flowTangentScratch.copy(flowDirection).addScaledVector(surfaceNormalWorldScratch, -flowDirection.dot(surfaceNormalWorldScratch));
    if (flowTangentScratch.lengthSq() > 1e-6) {
      flowTangentScratch.normalize();
      velocity.addScaledVector(flowTangentScratch, 0.35 * (1 - forwardPull));
    }
  }

  const downstream = toCenterScratch.dot(flowDirection) - obstacle.boundingRadius;
  if (downstream <= 0) {
    return nearSurface;
  }

  const projectedAlongFlow = toCenterScratch.dot(flowDirection);
  flowProjectionScratch.copy(flowDirection).multiplyScalar(projectedAlongFlow);
  lateralScratch.copy(toCenterScratch).sub(flowProjectionScratch);
  const lateralDistance = lateralScratch.length();
  const wakeRadius =
    obstacle.shapeKind === 'torus'
      ? Math.max(
          (obstacle.torusMajorRadius + obstacle.torusMinorRadius) * obstacle.scaleX,
          (obstacle.torusMajorRadius + obstacle.torusMinorRadius) * obstacle.scaleY,
          obstacle.torusMinorRadius * obstacle.scaleZ,
        ) + influence
      : obstacle.shapeKind === 'sphere'
        ? Math.max(
            obstacle.sphereRadius * obstacle.scaleX,
            obstacle.sphereRadius * obstacle.scaleY,
            obstacle.sphereRadius * obstacle.scaleZ,
          ) + influence
        : Math.max(
            obstacle.halfWidth * obstacle.scaleX,
            obstacle.halfHeight * obstacle.scaleY,
            obstacle.halfDepth * obstacle.scaleZ,
          ) + influence;
  const wakeFactor = computeWakeDecay(downstream, lateralDistance, wakeRadius);
  if (wakeFactor <= 1e-5) {
    return nearSurface;
  }

  // After clearing the obstacle, gradually steer particles back to the
  // original stream direction (flowDirection) while keeping their speed.
  if (!nearSurface && downstream > influence * 0.35) {
    const currentSpeed = velocity.length();
    if (currentSpeed > 1e-5) {
      const recoveryBlend = clamp(wakeFactor * 0.22, 0, 0.2);
      recoveryTargetScratch.copy(flowDirection).multiplyScalar(currentSpeed);
      velocity.lerp(recoveryTargetScratch, recoveryBlend);
    }
  }

  const turbulenceAmount = Math.max(0, turbulenceStrength);
  if (turbulenceAmount > 1e-5) {
    sampleCurlNoise(position, time, turbulenceScale, wakeScratch);
    wakeScratch.addScaledVector(flowDirection, -wakeScratch.dot(flowDirection));
    const wakeLengthSq = wakeScratch.lengthSq();
    if (wakeLengthSq > 1e-6) {
      wakeScratch.multiplyScalar(1 / Math.sqrt(wakeLengthSq));
      velocity.addScaledVector(wakeScratch, wakeFactor * obstacle.wakeStrength * turbulenceAmount);
    }
  }

  return nearSurface;
}
