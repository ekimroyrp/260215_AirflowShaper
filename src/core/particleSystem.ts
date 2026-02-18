import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ColorRepresentation,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';

export interface ParticleSystemOptions {
  maxParticles: number;
  trailLength: number;
  particleColor?: ColorRepresentation;
  trailColor?: ColorRepresentation;
  particleSize?: number;
}

export class ParticleTrailSystem {
  readonly maxParticles: number;
  readonly trailLength: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly ages: Float32Array;
  readonly lifetimes: Float32Array;
  readonly trails: Float32Array;
  readonly pointColors: Float32Array;
  readonly trailColorHistory: Float32Array;
  readonly pointsGeometry: BufferGeometry;
  readonly pointsMaterial: PointsMaterial;
  readonly points: Points;
  readonly trailGeometry: BufferGeometry;
  readonly trailMaterial: LineBasicMaterial;
  readonly trailsMesh: LineSegments;
  readonly smokeGeometry: BufferGeometry;
  readonly smokeMaterial: PointsMaterial;
  readonly smokePoints: Points;

  private readonly trailSegments: Float32Array;
  private readonly trailSegmentColors: Float32Array;
  private readonly smokePositions: Float32Array;
  private readonly smokeColors: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly pointColorAttribute: BufferAttribute;
  private readonly trailAttribute: BufferAttribute;
  private readonly trailColorAttribute: BufferAttribute;
  private readonly smokePositionAttribute: BufferAttribute;
  private readonly smokeColorAttribute: BufferAttribute;
  private readonly smokeSpriteTexture: CanvasTexture | null;
  private smokeDisplayEnabled = false;

  constructor(options: ParticleSystemOptions) {
    this.maxParticles = Math.max(1, Math.round(options.maxParticles));
    this.trailLength = Math.max(2, Math.round(options.trailLength));
    this.positions = new Float32Array(this.maxParticles * 3);
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.ages = new Float32Array(this.maxParticles);
    this.lifetimes = new Float32Array(this.maxParticles);
    this.trails = new Float32Array(this.maxParticles * this.trailLength * 3);
    this.pointColors = new Float32Array(this.maxParticles * 3);
    this.trailColorHistory = new Float32Array(this.maxParticles * this.trailLength * 3);
    this.trailSegments = new Float32Array(this.maxParticles * (this.trailLength - 1) * 2 * 3);
    this.trailSegmentColors = new Float32Array(this.maxParticles * (this.trailLength - 1) * 2 * 3);
    this.smokePositions = new Float32Array(this.maxParticles * this.trailLength * 3);
    this.smokeColors = new Float32Array(this.maxParticles * this.trailLength * 3);

    const defaultPointColor = new Color(options.particleColor ?? 0xe5f6ff);
    const defaultTrailColor = new Color(options.trailColor ?? options.particleColor ?? 0x63d2ff);
    for (let i = 0; i < this.maxParticles; i += 1) {
      const i3 = i * 3;
      this.pointColors[i3] = defaultPointColor.r;
      this.pointColors[i3 + 1] = defaultPointColor.g;
      this.pointColors[i3 + 2] = defaultPointColor.b;

      const trailStart = i * this.trailLength * 3;
      for (let t = 0; t < this.trailLength; t += 1) {
        const write = trailStart + t * 3;
        this.trailColorHistory[write] = defaultTrailColor.r;
        this.trailColorHistory[write + 1] = defaultTrailColor.g;
        this.trailColorHistory[write + 2] = defaultTrailColor.b;
      }
    }
    this.smokeColors.set(this.trailColorHistory);

    this.pointsGeometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.pointsGeometry.setAttribute('position', this.positionAttribute);
    this.pointColorAttribute = new BufferAttribute(this.pointColors, 3);
    this.pointColorAttribute.setUsage(DynamicDrawUsage);
    this.pointsGeometry.setAttribute('color', this.pointColorAttribute);

    this.pointsMaterial = new PointsMaterial({
      color: 0xffffff,
      size: options.particleSize ?? 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      vertexColors: true,
    });
    this.points = new Points(this.pointsGeometry, this.pointsMaterial);
    this.points.renderOrder = 4;

    this.trailGeometry = new BufferGeometry();
    this.trailAttribute = new BufferAttribute(this.trailSegments, 3);
    this.trailAttribute.setUsage(DynamicDrawUsage);
    this.trailGeometry.setAttribute('position', this.trailAttribute);
    this.trailColorAttribute = new BufferAttribute(this.trailSegmentColors, 3);
    this.trailColorAttribute.setUsage(DynamicDrawUsage);
    this.trailGeometry.setAttribute('color', this.trailColorAttribute);
    this.trailMaterial = new LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      vertexColors: true,
    });
    this.trailsMesh = new LineSegments(this.trailGeometry, this.trailMaterial);
    this.trailsMesh.renderOrder = 3;

    this.smokeGeometry = new BufferGeometry();
    this.smokePositionAttribute = new BufferAttribute(this.smokePositions, 3);
    this.smokePositionAttribute.setUsage(DynamicDrawUsage);
    this.smokeGeometry.setAttribute('position', this.smokePositionAttribute);
    this.smokeColorAttribute = new BufferAttribute(this.smokeColors, 3);
    this.smokeColorAttribute.setUsage(DynamicDrawUsage);
    this.smokeGeometry.setAttribute('color', this.smokeColorAttribute);

    this.smokeSpriteTexture = createSmokeSpriteTexture();
    const smokeMaterialOptions: ConstructorParameters<typeof PointsMaterial>[0] = {
      color: 0xffffff,
      size: (options.particleSize ?? 0.03) * 7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      vertexColors: true,
      blending: AdditiveBlending,
    };
    if (this.smokeSpriteTexture) {
      smokeMaterialOptions.map = this.smokeSpriteTexture;
      smokeMaterialOptions.alphaMap = this.smokeSpriteTexture;
      smokeMaterialOptions.alphaTest = 0.02;
    }
    this.smokeMaterial = new PointsMaterial(smokeMaterialOptions);
    this.smokePoints = new Points(this.smokeGeometry, this.smokeMaterial);
    this.smokePoints.renderOrder = 2;
    this.smokePoints.visible = false;
  }

  attach(scene: Scene): void {
    scene.add(this.trailsMesh);
    scene.add(this.points);
    scene.add(this.smokePoints);
  }

  detach(scene: Scene): void {
    scene.remove(this.trailsMesh);
    scene.remove(this.points);
    scene.remove(this.smokePoints);
  }

  dispose(): void {
    this.pointsGeometry.dispose();
    this.pointsMaterial.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.smokeGeometry.dispose();
    this.smokeMaterial.dispose();
    this.smokeSpriteTexture?.dispose();
  }

  setSmokeDisplay(enabled: boolean): void {
    this.smokeDisplayEnabled = enabled;
    this.points.visible = !enabled;
    this.trailsMesh.visible = !enabled;
    this.smokePoints.visible = enabled;
  }

  setParticleColor(index: number, r: number, g: number, b: number): void {
    const i3 = index * 3;
    this.pointColors[i3] = r;
    this.pointColors[i3 + 1] = g;
    this.pointColors[i3 + 2] = b;
  }

  respawnParticle(index: number, position: Vector3, velocity: Vector3, lifetime: number): void {
    const i3 = index * 3;
    this.positions[i3] = position.x;
    this.positions[i3 + 1] = position.y;
    this.positions[i3 + 2] = position.z;
    this.velocities[i3] = velocity.x;
    this.velocities[i3 + 1] = velocity.y;
    this.velocities[i3 + 2] = velocity.z;
    this.ages[index] = 0;
    this.lifetimes[index] = Math.max(0.05, lifetime);

    const trailStart = index * this.trailLength * 3;
    for (let t = 0; t < this.trailLength; t += 1) {
      const write = trailStart + t * 3;
      this.trails[write] = position.x;
      this.trails[write + 1] = position.y;
      this.trails[write + 2] = position.z;

      this.trailColorHistory[write] = this.pointColors[i3];
      this.trailColorHistory[write + 1] = this.pointColors[i3 + 1];
      this.trailColorHistory[write + 2] = this.pointColors[i3 + 2];
    }
  }

  pushTrailSample(index: number): void {
    const i3 = index * 3;
    const px = this.positions[i3];
    const py = this.positions[i3 + 1];
    const pz = this.positions[i3 + 2];

    const trailStart = index * this.trailLength * 3;
    for (let t = this.trailLength - 1; t > 0; t -= 1) {
      const write = trailStart + t * 3;
      const prev = write - 3;
      this.trails[write] = this.trails[prev];
      this.trails[write + 1] = this.trails[prev + 1];
      this.trails[write + 2] = this.trails[prev + 2];

      this.trailColorHistory[write] = this.trailColorHistory[prev];
      this.trailColorHistory[write + 1] = this.trailColorHistory[prev + 1];
      this.trailColorHistory[write + 2] = this.trailColorHistory[prev + 2];
    }

    this.trails[trailStart] = px;
    this.trails[trailStart + 1] = py;
    this.trails[trailStart + 2] = pz;
    this.trailColorHistory[trailStart] = this.pointColors[i3];
    this.trailColorHistory[trailStart + 1] = this.pointColors[i3 + 1];
    this.trailColorHistory[trailStart + 2] = this.pointColors[i3 + 2];
  }

  clearTrailsToCurrentPositions(): void {
    for (let i = 0; i < this.maxParticles; i += 1) {
      const i3 = i * 3;
      const px = this.positions[i3];
      const py = this.positions[i3 + 1];
      const pz = this.positions[i3 + 2];
      const trailStart = i * this.trailLength * 3;
      for (let t = 0; t < this.trailLength; t += 1) {
        const write = trailStart + t * 3;
        this.trails[write] = px;
        this.trails[write + 1] = py;
        this.trails[write + 2] = pz;
        this.trailColorHistory[write] = this.pointColors[i3];
        this.trailColorHistory[write + 1] = this.pointColors[i3 + 1];
        this.trailColorHistory[write + 2] = this.pointColors[i3 + 2];
      }
    }
  }

  syncTrailColorHistoryToParticleColors(): void {
    for (let i = 0; i < this.maxParticles; i += 1) {
      const i3 = i * 3;
      const trailStart = i * this.trailLength * 3;
      for (let t = 0; t < this.trailLength; t += 1) {
        const write = trailStart + t * 3;
        this.trailColorHistory[write] = this.pointColors[i3];
        this.trailColorHistory[write + 1] = this.pointColors[i3 + 1];
        this.trailColorHistory[write + 2] = this.pointColors[i3 + 2];
      }
    }
  }

  refreshGpuBuffers(): void {
    this.positionAttribute.needsUpdate = true;
    this.pointColorAttribute.needsUpdate = true;
    this.refreshTrailSegmentsFromHistory();
    this.trailAttribute.needsUpdate = true;
    this.trailColorAttribute.needsUpdate = true;
    if (this.smokeDisplayEnabled) {
      this.refreshSmokePointsFromHistory();
      this.smokePositionAttribute.needsUpdate = true;
      this.smokeColorAttribute.needsUpdate = true;
      this.smokeGeometry.computeBoundingSphere();
    }
    this.pointsGeometry.computeBoundingSphere();
    this.trailGeometry.computeBoundingSphere();
  }

  private refreshTrailSegmentsFromHistory(): void {
    let write = 0;
    for (let i = 0; i < this.maxParticles; i += 1) {
      const trailStart = i * this.trailLength * 3;
      for (let t = 0; t < this.trailLength - 1; t += 1) {
        const a = trailStart + t * 3;
        const b = a + 3;
        this.trailSegments[write] = this.trails[a];
        this.trailSegments[write + 1] = this.trails[a + 1];
        this.trailSegments[write + 2] = this.trails[a + 2];
        this.trailSegments[write + 3] = this.trails[b];
        this.trailSegments[write + 4] = this.trails[b + 1];
        this.trailSegments[write + 5] = this.trails[b + 2];

        this.trailSegmentColors[write] = this.trailColorHistory[a];
        this.trailSegmentColors[write + 1] = this.trailColorHistory[a + 1];
        this.trailSegmentColors[write + 2] = this.trailColorHistory[a + 2];
        this.trailSegmentColors[write + 3] = this.trailColorHistory[b];
        this.trailSegmentColors[write + 4] = this.trailColorHistory[b + 1];
        this.trailSegmentColors[write + 5] = this.trailColorHistory[b + 2];
        write += 6;
      }
    }
  }

  private refreshSmokePointsFromHistory(): void {
    this.smokePositions.set(this.trails);
    this.smokeColors.set(this.trailColorHistory);
  }
}

function createSmokeSpriteTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const radius = size * 0.5;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
