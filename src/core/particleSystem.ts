import {
  BufferAttribute,
  BufferGeometry,
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
  readonly pointsGeometry: BufferGeometry;
  readonly pointsMaterial: PointsMaterial;
  readonly points: Points;
  readonly trailGeometry: BufferGeometry;
  readonly trailMaterial: LineBasicMaterial;
  readonly trailsMesh: LineSegments;

  private readonly trailSegments: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly trailAttribute: BufferAttribute;

  constructor(options: ParticleSystemOptions) {
    this.maxParticles = Math.max(1, Math.round(options.maxParticles));
    this.trailLength = Math.max(2, Math.round(options.trailLength));
    this.positions = new Float32Array(this.maxParticles * 3);
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.ages = new Float32Array(this.maxParticles);
    this.lifetimes = new Float32Array(this.maxParticles);
    this.trails = new Float32Array(this.maxParticles * this.trailLength * 3);
    this.trailSegments = new Float32Array(this.maxParticles * (this.trailLength - 1) * 2 * 3);

    this.pointsGeometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.pointsGeometry.setAttribute('position', this.positionAttribute);

    this.pointsMaterial = new PointsMaterial({
      color: options.particleColor ?? 0xe5f6ff,
      size: options.particleSize ?? 0.03,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.points = new Points(this.pointsGeometry, this.pointsMaterial);
    this.points.renderOrder = 4;

    this.trailGeometry = new BufferGeometry();
    this.trailAttribute = new BufferAttribute(this.trailSegments, 3);
    this.trailAttribute.setUsage(DynamicDrawUsage);
    this.trailGeometry.setAttribute('position', this.trailAttribute);
    this.trailMaterial = new LineBasicMaterial({
      color: options.trailColor ?? 0x63d2ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.trailsMesh = new LineSegments(this.trailGeometry, this.trailMaterial);
    this.trailsMesh.renderOrder = 3;
  }

  attach(scene: Scene): void {
    scene.add(this.trailsMesh);
    scene.add(this.points);
  }

  detach(scene: Scene): void {
    scene.remove(this.trailsMesh);
    scene.remove(this.points);
  }

  dispose(): void {
    this.pointsGeometry.dispose();
    this.pointsMaterial.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
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
    }

    this.trails[trailStart] = px;
    this.trails[trailStart + 1] = py;
    this.trails[trailStart + 2] = pz;
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
      }
    }
  }

  refreshGpuBuffers(): void {
    this.positionAttribute.needsUpdate = true;
    this.refreshTrailSegmentsFromHistory();
    this.trailAttribute.needsUpdate = true;
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
        write += 6;
      }
    }
  }
}
