import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { applyObstacleInteraction, createObstacleFieldData } from '../src/core/obstacleInteraction';

describe('obstacleInteraction', () => {
  it('prevents inward penetration and removes normal velocity', () => {
    const obstacle = createObstacleFieldData();
    obstacle.center.set(0, 0, 0);
    obstacle.normal.set(0, 0, 1);
    obstacle.xAxis.set(1, 0, 0);
    obstacle.yAxis.set(0, 1, 0);
    obstacle.halfWidth = 1;
    obstacle.halfHeight = 1;
    obstacle.influenceRadius = 0.5;
    obstacle.wakeStrength = 0;

    const position = new Vector3(0.1, 0.1, 0.01);
    const velocity = new Vector3(0.2, 0, -1.5);
    const flowDirection = new Vector3(0, 0, 1);

    applyObstacleInteraction(position, velocity, obstacle, flowDirection, 0, 0.4);

    expect(position.z).toBeGreaterThan(0.01);
    expect(Math.abs(velocity.dot(obstacle.normal))).toBeLessThan(1e-4);
  });

  it('adds wake disturbance downstream', () => {
    const obstacle = createObstacleFieldData();
    obstacle.center.set(0, 0, 0);
    obstacle.normal.set(0, 1, 0);
    obstacle.xAxis.set(1, 0, 0);
    obstacle.yAxis.set(0, 0, 1);
    obstacle.halfWidth = 0.8;
    obstacle.halfHeight = 0.5;
    obstacle.influenceRadius = 0.35;
    obstacle.wakeStrength = 2;

    const position = new Vector3(0, 0, 2);
    const velocity = new Vector3(0, 0, 0);
    const flowDirection = new Vector3(0, 0, 1);

    applyObstacleInteraction(position, velocity, obstacle, flowDirection, 1.1, 0.3);

    expect(velocity.length()).toBeGreaterThan(0);
  });
});
