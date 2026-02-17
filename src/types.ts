import type { Euler, Vector3 } from 'three';

export type SimObjectKind = 'emitter' | 'obstacle';

export interface EmitterConfig {
  densityX: number;
  densityY: number;
  spawnRate: number;
  initialSpeed: number;
  particleLifetime: number;
  trailLength: number;
}

export interface FlowConfig {
  timeScale: number;
  drag: number;
  turbulenceStrength: number;
  turbulenceScale: number;
  recoveryLength: number;
  obstacleInfluenceRadius: number;
  wakeStrength: number;
}

export interface ObstaclePlaneState {
  id: string;
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
  width: number;
  height: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  speed: number;
}

export interface AirflowShaperApp {
  addObstaclePlane(): string;
  play(): void;
  pause(): void;
  restart(): void;
  setEmitterDensity(x: number, y: number): void;
  dispose(): void;
}
