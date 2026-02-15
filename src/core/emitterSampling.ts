import { Quaternion, Vector3 } from 'three';

export const EMITTER_WIDTH = 2;
export const EMITTER_HEIGHT = 1.2;

const WORLD_FORWARD = new Vector3(0, 0, 1);

export function clampDensity(value: number, min = 1, max = 70): number {
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

export function getEmitterVertexCount(densityX: number, densityY: number): number {
  return (clampDensity(densityX) + 1) * (clampDensity(densityY) + 1);
}

export function buildEmitterLocalVertices(
  densityX: number,
  densityY: number,
  width = EMITTER_WIDTH,
  height = EMITTER_HEIGHT,
): Float32Array {
  const segX = clampDensity(densityX);
  const segY = clampDensity(densityY);
  const vertexCount = (segX + 1) * (segY + 1);
  const out = new Float32Array(vertexCount * 3);

  let write = 0;
  for (let y = 0; y <= segY; y += 1) {
    const v = y / segY;
    const py = (v - 0.5) * height;
    for (let x = 0; x <= segX; x += 1) {
      const u = x / segX;
      const px = (u - 0.5) * width;
      out[write] = px;
      out[write + 1] = py;
      out[write + 2] = 0;
      write += 3;
    }
  }

  return out;
}

export function computeEmitterWorldNormal(quaternion: Quaternion, target = new Vector3()): Vector3 {
  return target.copy(WORLD_FORWARD).applyQuaternion(quaternion).normalize();
}
