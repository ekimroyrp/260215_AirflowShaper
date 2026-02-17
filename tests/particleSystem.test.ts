import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { ParticleTrailSystem } from '../src/core/particleSystem';

describe('particleSystem trails', () => {
  it('clearTrailsToCurrentPositions resets each trail sample', () => {
    const system = new ParticleTrailSystem({ maxParticles: 2, trailLength: 4 });
    const scene = new Scene();
    system.attach(scene);

    system.respawnParticle(0, new Vector3(1, 2, 3), new Vector3(0, 0, 1), 5);
    system.respawnParticle(1, new Vector3(-1, -2, -3), new Vector3(0, 1, 0), 5);

    system.positions[0] = 8;
    system.positions[1] = 9;
    system.positions[2] = 10;
    system.clearTrailsToCurrentPositions();

    for (let t = 0; t < system.trailLength; t += 1) {
      const offset = t * 3;
      expect(system.trails[offset]).toBe(8);
      expect(system.trails[offset + 1]).toBe(9);
      expect(system.trails[offset + 2]).toBe(10);
    }

    system.detach(scene);
    system.dispose();
  });

  it('propagates per-particle colors into trail color history', () => {
    const system = new ParticleTrailSystem({ maxParticles: 1, trailLength: 3 });
    const scene = new Scene();
    system.attach(scene);

    system.setParticleColor(0, 0.1, 0.2, 0.3);
    system.respawnParticle(0, new Vector3(0, 0, 0), new Vector3(0, 0, 1), 5);
    expect(system.trailColorHistory[0]).toBeCloseTo(0.1, 6);
    expect(system.trailColorHistory[1]).toBeCloseTo(0.2, 6);
    expect(system.trailColorHistory[2]).toBeCloseTo(0.3, 6);

    system.positions[0] = 1;
    system.positions[1] = 0.5;
    system.positions[2] = -0.25;
    system.setParticleColor(0, 0.8, 0.7, 0.6);
    system.pushTrailSample(0);
    expect(system.trailColorHistory[0]).toBeCloseTo(0.8, 6);
    expect(system.trailColorHistory[1]).toBeCloseTo(0.7, 6);
    expect(system.trailColorHistory[2]).toBeCloseTo(0.6, 6);

    system.detach(scene);
    system.dispose();
  });
});
