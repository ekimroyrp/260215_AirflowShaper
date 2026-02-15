import { Vector3 } from 'three';

const EPSILON = 0.05;
const AXIS_A = new Vector3(12.9898, 78.233, 37.719);
const AXIS_B = new Vector3(39.3468, 11.135, 83.155);
const AXIS_C = new Vector3(73.156, 52.235, 9.151);

function hashWave(x: number, y: number, z: number, axis: Vector3, time: number): number {
  const dot = x * axis.x + y * axis.y + z * axis.z + time * 0.65;
  return Math.sin(dot) * Math.cos(dot * 1.37 + 3.1);
}

function potentialA(x: number, y: number, z: number, time: number): number {
  return hashWave(x, y, z, AXIS_A, time) + hashWave(x, y, z, AXIS_B, time * 0.65);
}

function potentialB(x: number, y: number, z: number, time: number): number {
  return hashWave(x, y, z, AXIS_B, time) + hashWave(x, y, z, AXIS_C, time * 0.72);
}

function potentialC(x: number, y: number, z: number, time: number): number {
  return hashWave(x, y, z, AXIS_C, time) + hashWave(x, y, z, AXIS_A, time * 0.59);
}

export function sampleCurlNoise(
  position: Vector3,
  time: number,
  scale: number,
  target = new Vector3(),
): Vector3 {
  const s = Math.max(1e-4, scale);
  const x = position.x * s;
  const y = position.y * s;
  const z = position.z * s;

  const aY1 = potentialA(x, y + EPSILON, z, time);
  const aY0 = potentialA(x, y - EPSILON, z, time);
  const aZ1 = potentialA(x, y, z + EPSILON, time);
  const aZ0 = potentialA(x, y, z - EPSILON, time);

  const bX1 = potentialB(x + EPSILON, y, z, time);
  const bX0 = potentialB(x - EPSILON, y, z, time);
  const bZ1 = potentialB(x, y, z + EPSILON, time);
  const bZ0 = potentialB(x, y, z - EPSILON, time);

  const cX1 = potentialC(x + EPSILON, y, z, time);
  const cX0 = potentialC(x - EPSILON, y, z, time);
  const cY1 = potentialC(x, y + EPSILON, z, time);
  const cY0 = potentialC(x, y - EPSILON, z, time);

  const dA_dY = (aY1 - aY0) / (2 * EPSILON);
  const dA_dZ = (aZ1 - aZ0) / (2 * EPSILON);
  const dB_dX = (bX1 - bX0) / (2 * EPSILON);
  const dB_dZ = (bZ1 - bZ0) / (2 * EPSILON);
  const dC_dX = (cX1 - cX0) / (2 * EPSILON);
  const dC_dY = (cY1 - cY0) / (2 * EPSILON);

  target.set(dC_dY - dB_dZ, dA_dZ - dC_dX, dB_dX - dA_dY);
  const length = target.length();
  if (length > 1e-5) {
    target.multiplyScalar(1 / length);
  }
  return target;
}

export function computeWakeDecay(downstreamDistance: number, lateralDistance: number, radius: number): number {
  if (downstreamDistance <= 0) {
    return 0;
  }
  const safeRadius = Math.max(1e-4, radius);
  const lateralTerm = Math.exp(-(lateralDistance * lateralDistance) / (safeRadius * safeRadius));
  const downstreamTerm = Math.exp(-downstreamDistance / (safeRadius * 5.5));
  return lateralTerm * downstreamTerm;
}
