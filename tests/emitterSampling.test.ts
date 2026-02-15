import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  buildEmitterLocalVertices,
  computeEmitterWorldNormal,
  computeSpawnRateFromVertexCount,
  getEmitterVertexCount,
} from '../src/core/emitterSampling';

describe('emitterSampling', () => {
  it('computes vertex count from x/y density', () => {
    expect(getEmitterVertexCount(20, 12)).toBe((20 + 1) * (12 + 1));
    expect(getEmitterVertexCount(1, 1)).toBe(4);
  });

  it('builds vertex array with expected length', () => {
    const data = buildEmitterLocalVertices(4, 3);
    expect(data.length).toBe((4 + 1) * (3 + 1) * 3);
  });

  it('maps vertex count into bounded spawn rate', () => {
    expect(computeSpawnRateFromVertexCount(10, 100)).toBe(80);
    expect(computeSpawnRateFromVertexCount(1, 100)).toBe(40);
    expect(computeSpawnRateFromVertexCount(1000, 50)).toBe(300);
  });

  it('rotates emitter normal via quaternion', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI * 0.5);
    const normal = computeEmitterWorldNormal(q);
    expect(normal.x).toBeCloseTo(1, 4);
    expect(normal.y).toBeCloseTo(0, 4);
    expect(normal.z).toBeCloseTo(0, 4);
  });
});
