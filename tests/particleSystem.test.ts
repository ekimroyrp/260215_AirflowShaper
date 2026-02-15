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
});
