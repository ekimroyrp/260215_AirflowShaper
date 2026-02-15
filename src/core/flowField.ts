import { Vector3 } from 'three';

const EPSILON = 0.05;
const AXIS_A = new Vector3(12.9898, 78.233, 37.719);
const AXIS_B = new Vector3(39.3468, 11.135, 83.155);
const AXIS_C = new Vector3(73.156, 52.235, 9.151);

function hashWave(position: Vector3, axis: Vector3, time: number): number {
  const dot = position.dot(axis) + time * 0.65;
  return Math.sin(dot) * Math.cos(dot * 1.37 + 3.1);
}

function potentialA(position: Vector3, time: number): number {
  return hashWave(position, AXIS_A, time) + hashWave(position, AXIS_B, time * 0.65);
}

function potentialB(position: Vector3, time: number): number {
  return hashWave(position, AXIS_B, time) + hashWave(position, AXIS_C, time * 0.72);
}

function potentialC(position: Vector3, time: number): number {
  return hashWave(position, AXIS_C, time) + hashWave(position, AXIS_A, time * 0.59);
}

export function sampleCurlNoise(
  position: Vector3,
  time: number,
  scale: number,
  target = new Vector3(),
): Vector3 {
  const scaled = new Vector3().copy(position).multiplyScalar(Math.max(1e-4, scale));
  const dx = new Vector3(EPSILON, 0, 0);
  const dy = new Vector3(0, EPSILON, 0);
  const dz = new Vector3(0, 0, EPSILON);

  const aY1 = potentialA(new Vector3().copy(scaled).add(dy), time);
  const aY0 = potentialA(new Vector3().copy(scaled).sub(dy), time);
  const aZ1 = potentialA(new Vector3().copy(scaled).add(dz), time);
  const aZ0 = potentialA(new Vector3().copy(scaled).sub(dz), time);

  const bX1 = potentialB(new Vector3().copy(scaled).add(dx), time);
  const bX0 = potentialB(new Vector3().copy(scaled).sub(dx), time);
  const bZ1 = potentialB(new Vector3().copy(scaled).add(dz), time);
  const bZ0 = potentialB(new Vector3().copy(scaled).sub(dz), time);

  const cX1 = potentialC(new Vector3().copy(scaled).add(dx), time);
  const cX0 = potentialC(new Vector3().copy(scaled).sub(dx), time);
  const cY1 = potentialC(new Vector3().copy(scaled).add(dy), time);
  const cY0 = potentialC(new Vector3().copy(scaled).sub(dy), time);

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
