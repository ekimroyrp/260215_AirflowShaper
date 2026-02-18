import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import {
  applyObstacleInteraction,
  createObstacleFieldData,
  updateObstacleFieldDataFromObject,
} from '../src/core/obstacleInteraction';

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

    applyObstacleInteraction(position, velocity, obstacle, flowDirection, 0, 0.4, 0);

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

    applyObstacleInteraction(position, velocity, obstacle, flowDirection, 1.1, 0.3, 1);

    expect(velocity.length()).toBeGreaterThan(0);
  });

  it('does not add wake noise when turbulence is zero', () => {
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

    applyObstacleInteraction(position, velocity, obstacle, flowDirection, 1.1, 0.3, 0);

    expect(velocity.length()).toBeCloseTo(0, 6);
  });

  it('gradually realigns downstream flow back toward stream direction', () => {
    const obstacle = createObstacleFieldData();
    obstacle.center.set(0, 0, 0);
    obstacle.normal.set(0, 1, 0);
    obstacle.xAxis.set(1, 0, 0);
    obstacle.yAxis.set(0, 0, 1);
    obstacle.halfWidth = 1;
    obstacle.halfHeight = 0.5;
    obstacle.influenceRadius = 0.2;
    obstacle.wakeStrength = 0;

    const flowDirection = new Vector3(0, 0, 1);
    const position = new Vector3(0, 0, 1.4);
    const velocity = new Vector3(1.2, 0, 1.8);

    const lateralBefore = velocity.clone().addScaledVector(flowDirection, -velocity.dot(flowDirection)).length();
    applyObstacleInteraction(position, velocity, obstacle, flowDirection, 0.8, 0.3, 0);
    const lateralAfter = velocity.clone().addScaledVector(flowDirection, -velocity.dot(flowDirection)).length();

    expect(lateralAfter).toBeLessThan(lateralBefore);
  });

  it('respects non-uniform scale when evaluating obstacle proximity', () => {
    const sphere = new Mesh(new SphereGeometry(0.5, 10, 8), new MeshBasicMaterial());
    sphere.userData.obstacleShape = 'sphere';
    sphere.userData.obstacleParams = { radius: 0.5 };
    sphere.scale.set(2, 0.6, 1);
    sphere.updateMatrixWorld(true);

    const obstacle = createObstacleFieldData();
    updateObstacleFieldDataFromObject(sphere, 0.1, 0, obstacle);

    const flowDirection = new Vector3(0, 0, 1);
    const velocityA = new Vector3(0, 0, 0);
    const velocityB = new Vector3(0, 0, 0);

    const nearAlongWideAxis = applyObstacleInteraction(new Vector3(0.92, 0, 0), velocityA, obstacle, flowDirection, 0, 0.3, 0);
    const nearAlongTightAxis = applyObstacleInteraction(new Vector3(0, 0.55, 0), velocityB, obstacle, flowDirection, 0, 0.3, 0);

    expect(nearAlongWideAxis).toBe(true);
    expect(nearAlongTightAxis).toBe(false);
  });
});
