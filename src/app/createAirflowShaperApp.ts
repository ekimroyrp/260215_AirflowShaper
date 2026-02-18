import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  SphereGeometry,
  TorusGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  buildEmitterLocalVertices,
  clampDensity,
  computeSpawnRateFromVertexCount,
  computeEmitterWorldNormal,
  EMITTER_HEIGHT,
  EMITTER_WIDTH,
  getEmitterVertexCount,
} from '../core/emitterSampling';
import { sampleCurlNoise } from '../core/flowField';
import { ParticleTrailSystem } from '../core/particleSystem';
import { createPlaybackState, pausePlayback, playPlayback, restartPlayback } from '../core/playback';
import {
  applyObstacleInteraction,
  createObstacleFieldData,
  type ObstacleFieldData,
  updateObstacleFieldDataFromObject,
} from '../core/obstacleInteraction';
import type { AirflowShaperApp, EmitterConfig, FlowConfig, PlaybackState, SimObjectKind } from '../types';
import type { ObstacleShapeKind } from '../core/obstacleInteraction';

interface PlaneEntity {
  id: string;
  kind: SimObjectKind;
  transformObject: Object3D;
  scaleProxy: Object3D;
  object: Object3D;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  outline: LineSegments;
}

interface UiState {
  densityX: number;
  densityY: number;
  flowSpeed: number;
  flowLength: number;
  pathColor: string;
  obstructedColor: string;
  turbulence: number;
  recoveryLength: number;
  impactBuffer: number;
}

interface UiElements {
  panel: HTMLDivElement;
  handleTop: HTMLDivElement;
  handleBottom: HTMLDivElement;
  collapseToggle: HTMLButtonElement;
  playButton: HTMLButtonElement;
  pauseButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
  addPlaneButton: HTMLButtonElement;
  addBoxButton: HTMLButtonElement;
  addSphereButton: HTMLButtonElement;
  addPyramidButton: HTMLButtonElement;
  addTorusButton: HTMLButtonElement;
  flowSpeedRange: HTMLInputElement;
  flowSpeedValue: HTMLSpanElement;
  flowLengthRange: HTMLInputElement;
  flowLengthValue: HTMLSpanElement;
  pathColorInput: HTMLInputElement;
  obstructedColorInput: HTMLInputElement;
  turbulenceRange: HTMLInputElement;
  turbulenceValue: HTMLSpanElement;
  recoveryLengthRange: HTMLInputElement;
  recoveryLengthValue: HTMLSpanElement;
  impactBufferRange: HTMLInputElement;
  impactBufferValue: HTMLSpanElement;
  densityXRange: HTMLInputElement;
  densityXValue: HTMLSpanElement;
  densityYRange: HTMLInputElement;
  densityYValue: HTMLSpanElement;
}

interface UiRangeBinding {
  input: HTMLInputElement;
  value: HTMLSpanElement;
  format: (value: number) => string;
}

interface ObstacleRuntime {
  id: string;
  data: ObstacleFieldData;
}

const MAX_PARTICLES = 4200;
const DEFAULT_TRAIL_LENGTH = 22;
const SCALE_EPSILON = 1e-4;
const ENVIRONMENT_BLUR_SIGMA = 1.25;
const BACK_SCALE_HANDLE_OFFSET = 0.4;
const TRANSLATE_ARROW_HEAD_SCALE = 2 / 3;
const TRANSLATE_PICKER_HIT_SCALE = 1.12;
const ROTATE_PICKER_HIT_SCALE = 0.95;
const SCALE_PICKER_HIT_SCALE = 1.15;
const SCALE_BOX_PICKER_SCALE = 1.75;
const DEFAULT_PATH_COLOR = '#1100ff';
const DEFAULT_OBSTRUCTED_COLOR = '#ff8552';
const OFF_PATH_DISTANCE_FOR_MAX_COLOR = 0.9;
const FLOW_LENGTH_MIN = 0.1;
const FLOW_LENGTH_LIFETIME_EXPONENT = 0.5;
const EMITTER_BASE_COLOR = 0x1b7ea5;
const EMITTER_SELECTED_COLOR = 0x56ecff;
const OBSTACLE_BASE_COLOR = 0x5f738a;
const OBSTACLE_SELECTED_COLOR = 0xffcf7a;

class AirflowShaperAppImpl implements AirflowShaperApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly orbitControls: OrbitControls;
  private readonly transformControls: TransformControls[];
  private readonly transformHelpers: Object3D[];
  private readonly uiElements: UiElements;
  private readonly uiCleanupCallbacks: Array<() => void> = [];
  private readonly uiRangeBindings: UiRangeBinding[] = [];
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private readonly emitterConfig: EmitterConfig = {
    densityX: 20,
    densityY: 12,
    spawnRate: 1,
    initialSpeed: 2.7,
    particleLifetime: 7.2,
    trailLength: DEFAULT_TRAIL_LENGTH,
  };

  private readonly flowConfig: FlowConfig = {
    timeScale: 1,
    drag: 0.8,
    turbulenceStrength: 0,
    turbulenceScale: 0.35,
    recoveryLength: 1,
    obstacleInfluenceRadius: 0.1,
    wakeStrength: 1.05,
  };

  private readonly playbackState: PlaybackState = createPlaybackState(5);
  private readonly uiState: UiState = {
    densityX: 20,
    densityY: 12,
    flowSpeed: 5,
    flowLength: 6,
    pathColor: DEFAULT_PATH_COLOR,
    obstructedColor: DEFAULT_OBSTRUCTED_COLOR,
    turbulence: 0,
    recoveryLength: 1,
    impactBuffer: 0.1,
  };

  private readonly particleSystem: ParticleTrailSystem;

  private readonly planeEntities = new Map<string, PlaneEntity>();
  private readonly selectable = new Set<Object3D>();
  private readonly obstacleRuntimes: ObstacleRuntime[] = [];

  private readonly emitterId = 'emitter-1';
  private obstacleCounter = 0;
  private selectedPlaneId: string | null = null;

  private emitterLocalVertices = buildEmitterLocalVertices(this.emitterConfig.densityX, this.emitterConfig.densityY);
  private emitterWorldVertices = new Float32Array(this.emitterLocalVertices.length);
  private readonly emitterNormal = new Vector3(0, 0, 1);
  private readonly emitterRight = new Vector3(1, 0, 0);
  private readonly emitterUp = new Vector3(0, 1, 0);
  private readonly particleLaneOrigins = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleLaneDirections = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleOffPathAmounts = new Float32Array(MAX_PARTICLES);
  private readonly particleImpactTurbulence = new Float32Array(MAX_PARTICLES);

  private readonly quaternionScratch = new Quaternion();
  private readonly positionScratch = new Vector3();
  private readonly velocityScratch = new Vector3();
  private readonly baseFlowScratch = new Vector3();
  private readonly steeringScratch = new Vector3();
  private readonly turbulenceScratch = new Vector3();
  private readonly laneOriginScratch = new Vector3();
  private readonly laneDirectionScratch = new Vector3();
  private readonly laneTargetScratch = new Vector3();
  private readonly pathColorScratch = new Color(DEFAULT_PATH_COLOR);
  private readonly obstructedColorScratch = new Color(DEFAULT_OBSTRUCTED_COLOR);
  private readonly blendedColorScratch = new Color(DEFAULT_PATH_COLOR);
  private readonly scalePickerMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  private environmentRenderTarget: WebGLRenderTarget | null = null;
  private isTransformDragging = false;
  private isUsingTransformControls = false;
  private pendingTrailGradientRecolor = false;
  private spawnAccumulator = 0;
  private spawnParticleCursor = 0;
  private spawnVertexCursor = 0;
  private simTime = 0;

  private animationFrameHandle = 0;
  private lastAnimationTimeSeconds = performance.now() * 0.001;

  private readonly onResizeBound: () => void;
  private readonly onPointerDownBound: (event: PointerEvent) => void;
  private readonly onKeyDownBound: (event: KeyboardEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = new Scene();
    this.scene.background = new Color(0x000000);

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(8, 5.5, 8);

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.mouseButtons.LEFT = undefined;
    this.orbitControls.mouseButtons.MIDDLE = MOUSE.PAN;
    this.orbitControls.mouseButtons.RIGHT = MOUSE.ROTATE;

    const translateControl = this.createTransformControl('translate', 1.0);
    const rotateControl = this.createTransformControl('rotate', 0.5);
    const scaleControl = this.createTransformControl('scale', 0.42);
    this.transformControls = [translateControl.control, rotateControl.control, scaleControl.control];
    this.transformHelpers = [translateControl.helper, rotateControl.helper, scaleControl.helper];

    this.setupSceneHelpers();
    this.setupEnvironment();

    this.uiElements = this.resolveUiElements();
    this.createEmitterEntity();

    this.particleSystem = new ParticleTrailSystem({
      maxParticles: MAX_PARTICLES,
      trailLength: this.emitterConfig.trailLength,
      particleColor: 0xe5f6ff,
      trailColor: 0x63d2ff,
      particleSize: 0.03,
    });
    this.particleSystem.attach(this.scene);

    this.setupUi();
    this.selectPlane(this.emitterId);

    this.updateSpawnRateFromDensity();
    this.restart();

    this.onResizeBound = () => this.handleResize();
    this.onPointerDownBound = (event) => this.handlePointerDown(event);
    this.onKeyDownBound = (event) => this.handleKeyDown(event);

    window.addEventListener('resize', this.onResizeBound);
    this.canvas.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('keydown', this.onKeyDownBound);

    this.animationLoop();
  }

  addObstaclePlane(): string {
    const id = `obstacle-${++this.obstacleCounter}`;
    const entity = this.createPlaneEntity(id, 'obstacle', 0x5f738a, 1, 1, 1, 1);
    entity.scaleProxy.scale.set(1.8, 0.95, 1);
    this.registerObstacleEntity(id, entity);
    return id;
  }

  private addObstacleBox(): string {
    const id = `obstacle-${++this.obstacleCounter}`;
    const width = 1;
    const height = 0.62;
    const depth = 0.62;
    const geometry = new BoxGeometry(width, height, depth, 1, 1, 1);
    const entity = this.createObstacleEntity(id, 'box', geometry, {
      width,
      height,
      depth,
    });
    entity.scaleProxy.scale.set(1.2, 1, 1);
    this.registerObstacleEntity(id, entity);
    return id;
  }

  private addObstacleSphere(): string {
    const id = `obstacle-${++this.obstacleCounter}`;
    const radius = 0.5;
    const geometry = new SphereGeometry(radius, 20, 14);
    const entity = this.createObstacleEntity(id, 'sphere', geometry, {
      radius,
    });
    entity.scaleProxy.scale.set(1.05, 1.05, 1);
    this.registerObstacleEntity(id, entity);
    return id;
  }

  private addObstaclePyramid(): string {
    const id = `obstacle-${++this.obstacleCounter}`;
    const radius = 0.5;
    const height = 1;
    const geometry = new ConeGeometry(radius, height, 4, 1);
    geometry.rotateX(Math.PI * 0.5);
    const entity = this.createObstacleEntity(id, 'pyramid', geometry, {
      radius,
      height,
    });
    entity.scaleProxy.scale.set(1.05, 1.05, 1);
    this.registerObstacleEntity(id, entity);
    return id;
  }

  private addObstacleTorus(): string {
    const id = `obstacle-${++this.obstacleCounter}`;
    const majorRadius = 0.34;
    const minorRadius = 0.16;
    const geometry = new TorusGeometry(majorRadius, minorRadius, 14, 28);
    const entity = this.createObstacleEntity(id, 'torus', geometry, {
      majorRadius,
      minorRadius,
    });
    entity.scaleProxy.scale.set(1.15, 1.15, 1);
    this.registerObstacleEntity(id, entity);
    return id;
  }

  play(): void {
    playPlayback(this.playbackState);
  }

  pause(): void {
    pausePlayback(this.playbackState);
  }

  restart(): void {
    restartPlayback(this.playbackState);
    this.simTime = 0;
    this.pendingTrailGradientRecolor = false;
    this.spawnAccumulator = 0;
    this.spawnParticleCursor = 0;
    this.spawnVertexCursor = 0;

    this.updateAllWorldMatrices();
    this.refreshEmitterSpawnData();
    this.refreshObstacleFieldData();
    this.initializeRestartParticleDistribution();

    this.particleSystem.clearTrailsToCurrentPositions();
    this.particleSystem.refreshGpuBuffers();
  }

  setEmitterDensity(x: number, y: number): void {
    const nextX = clampDensity(x);
    const nextY = clampDensity(y);
    if (nextX === this.emitterConfig.densityX && nextY === this.emitterConfig.densityY) {
      return;
    }

    this.emitterConfig.densityX = nextX;
    this.emitterConfig.densityY = nextY;
    this.uiState.densityX = nextX;
    this.uiState.densityY = nextY;
    this.rebuildEmitterGeometry();
    this.updateSpawnRateFromDensity();
    this.restart();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrameHandle);

    window.removeEventListener('resize', this.onResizeBound);
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('keydown', this.onKeyDownBound);

    for (const cleanup of this.uiCleanupCallbacks) {
      cleanup();
    }
    this.uiCleanupCallbacks.length = 0;

    for (const helper of this.transformHelpers) {
      this.scene.remove(helper);
    }
    for (const control of this.transformControls) {
      const internal = control as unknown as {
        _gizmo?: {
          picker?: Record<string, Object3D>;
        };
      };
      const pickerScaleGroup = internal._gizmo?.picker?.scale;
      if (pickerScaleGroup) {
        for (const child of [...pickerScaleGroup.children]) {
          if (!child.userData?.customScalePicker) {
            continue;
          }
          const meshLike = child as Object3D & { geometry?: BufferGeometry };
          meshLike.geometry?.dispose();
          pickerScaleGroup.remove(child);
        }
      }
      control.dispose();
    }
    this.scalePickerMaterial.dispose();
    this.orbitControls.dispose();

    this.particleSystem.detach(this.scene);
    this.particleSystem.dispose();

    for (const entity of this.planeEntities.values()) {
      this.disposePlaneEntity(entity);
    }
    this.planeEntities.clear();
    this.selectable.clear();
    this.obstacleRuntimes.length = 0;

    if (this.environmentRenderTarget) {
      this.environmentRenderTarget.dispose();
      this.environmentRenderTarget = null;
    }

    this.renderer.dispose();
  }

  private createEmitterEntity(): void {
    const entity = this.createPlaneEntity(this.emitterId, 'emitter', EMITTER_BASE_COLOR, EMITTER_WIDTH, EMITTER_HEIGHT, 1, 1);
    entity.transformObject.position.set(0, 1.4, -2.8);
    entity.transformObject.rotation.set(0, 0, 0);
    entity.scaleProxy.scale.set(1, 1, 1);

    this.scene.add(entity.transformObject);
    this.planeEntities.set(this.emitterId, entity);
    this.selectable.add(entity.mesh);

    this.rebuildEmitterGeometry();
  }

  private registerObstacleEntity(id: string, entity: PlaneEntity): void {
    entity.transformObject.position.set(
      ((this.obstacleCounter % 5) - 2) * 1.1,
      1 + ((this.obstacleCounter % 3) - 1) * 0.35,
      -0.5 + this.obstacleCounter * 0.5,
    );
    entity.transformObject.rotation.set(0, 0, 0);

    this.scene.add(entity.transformObject);
    this.planeEntities.set(id, entity);
    this.selectable.add(entity.mesh);
    this.obstacleRuntimes.push({ id, data: createObstacleFieldData() });
    this.selectPlane(id);
  }

  private createObstacleEntity(
    id: string,
    shapeKind: ObstacleShapeKind,
    geometry: BufferGeometry,
    shapeParams: Record<string, number>,
  ): PlaneEntity {
    const transformObject = new Object3D();
    const scaleProxy = new Object3D();
    scaleProxy.scale.set(1, 1, 1);

    const object = new Object3D();
    const material = new MeshStandardMaterial({
      color: OBSTACLE_BASE_COLOR,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity: 0.38,
      side: DoubleSide,
    });

    const mesh = new Mesh(geometry, material);
    mesh.userData.planeId = id;
    mesh.userData.obstacleShape = shapeKind;
    mesh.userData.obstacleParams = shapeParams;

    const outlineMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    const outline = new LineSegments(new EdgesGeometry(geometry), outlineMaterial);

    object.add(mesh);
    object.add(outline);
    scaleProxy.add(object);
    transformObject.add(scaleProxy);

    return {
      id,
      kind: 'obstacle',
      transformObject,
      scaleProxy,
      object,
      mesh,
      outline,
    };
  }

  private createPlaneEntity(
    id: string,
    kind: SimObjectKind,
    color: number,
    width: number,
    height: number,
    widthSegments: number,
    heightSegments: number,
  ): PlaneEntity {
    const transformObject = new Object3D();
    const scaleProxy = new Object3D();
    scaleProxy.scale.set(Math.max(SCALE_EPSILON, width), Math.max(SCALE_EPSILON, height), 1);

    const object = new Object3D();
    const geometry = new PlaneGeometry(1, 1, widthSegments, heightSegments);
    const material = new MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity: kind === 'emitter' ? 0.3 : 0.38,
      side: DoubleSide,
    });

    const mesh = new Mesh(geometry, material);
    mesh.userData.planeId = id;
    if (kind === 'obstacle') {
      mesh.userData.obstacleShape = 'plane';
      mesh.userData.obstacleParams = { width: 1, height: 1, depth: 0 };
    }

    const outlineMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    const outline = new LineSegments(new EdgesGeometry(geometry), outlineMaterial);

    object.add(mesh);
    object.add(outline);
    scaleProxy.add(object);
    transformObject.add(scaleProxy);

    return {
      id,
      kind,
      transformObject,
      scaleProxy,
      object,
      mesh,
      outline,
    };
  }

  private disposePlaneEntity(entity: PlaneEntity): void {
    const outlineMaterial = entity.outline.material;
    if (Array.isArray(outlineMaterial)) {
      for (const material of outlineMaterial) {
        material.dispose();
      }
    } else {
      outlineMaterial.dispose();
    }

    entity.outline.geometry.dispose();
    entity.mesh.geometry.dispose();
    entity.mesh.material.dispose();
    entity.object.remove(entity.outline);
    entity.object.remove(entity.mesh);
    entity.scaleProxy.remove(entity.object);
    entity.transformObject.remove(entity.scaleProxy);
    this.scene.remove(entity.transformObject);
  }

  private rebuildEmitterGeometry(): void {
    const emitter = this.planeEntities.get(this.emitterId);
    if (!emitter) {
      return;
    }

    const nextGeometry = new PlaneGeometry(
      EMITTER_WIDTH,
      EMITTER_HEIGHT,
      this.emitterConfig.densityX,
      this.emitterConfig.densityY,
    );

    emitter.mesh.geometry.dispose();
    emitter.mesh.geometry = nextGeometry;

    emitter.outline.geometry.dispose();
    emitter.outline.geometry = new EdgesGeometry(nextGeometry);

    this.emitterLocalVertices = buildEmitterLocalVertices(this.emitterConfig.densityX, this.emitterConfig.densityY);
    this.emitterWorldVertices = new Float32Array(this.emitterLocalVertices.length);
  }

  private removeObstacle(id: string): void {
    const entity = this.planeEntities.get(id);
    if (!entity || entity.kind !== 'obstacle') {
      return;
    }

    this.selectable.delete(entity.mesh);
    this.disposePlaneEntity(entity);
    this.planeEntities.delete(id);

    const runtimeIndex = this.obstacleRuntimes.findIndex((runtime) => runtime.id === id);
    if (runtimeIndex >= 0) {
      this.obstacleRuntimes.splice(runtimeIndex, 1);
    }

    if (this.selectedPlaneId === id) {
      this.selectPlane(this.emitterId);
    }
  }

  private selectPlane(id: string | null): void {
    this.selectedPlaneId = id;
    this.refreshSelectionVisuals();
    this.updateTransformControlAttachments();
  }

  private refreshSelectionVisuals(): void {
    for (const [id, entity] of this.planeEntities) {
      if (entity.kind === 'emitter') {
        entity.mesh.material.color.setHex(id === this.selectedPlaneId ? EMITTER_SELECTED_COLOR : EMITTER_BASE_COLOR);
      } else {
        entity.mesh.material.color.setHex(id === this.selectedPlaneId ? OBSTACLE_SELECTED_COLOR : OBSTACLE_BASE_COLOR);
      }
    }
  }

  private updateTransformControlAttachments(): void {
    for (const control of this.transformControls) {
      control.detach();
    }

    if (!this.selectedPlaneId) {
      return;
    }

    const entity = this.planeEntities.get(this.selectedPlaneId);
    if (!entity) {
      return;
    }

    const [translateControl, rotateControl, scaleControl] = this.transformControls;
    translateControl?.attach(entity.transformObject);
    rotateControl?.attach(entity.transformObject);
    scaleControl?.attach(entity.scaleProxy);
  }

  private handleScaleProxyObjectChange(): void {
    if (!this.selectedPlaneId) {
      return;
    }

    const entity = this.planeEntities.get(this.selectedPlaneId);
    if (!entity) {
      return;
    }

    entity.scaleProxy.scale.set(
      Math.max(SCALE_EPSILON, Math.abs(entity.scaleProxy.scale.x)),
      Math.max(SCALE_EPSILON, Math.abs(entity.scaleProxy.scale.y)),
      entity.kind === 'emitter' ? 1 : Math.max(SCALE_EPSILON, Math.abs(entity.scaleProxy.scale.z)),
    );
  }

  private setupSceneHelpers(): void {
    const ambient = new AmbientLight(0xffffff, 0.62);
    this.scene.add(ambient);

    const directional = new DirectionalLight(0xffffff, 1.08);
    directional.position.set(9, 10, 4);
    this.scene.add(directional);
  }

  private setupEnvironment(): void {
    const pmremGenerator = new PMREMGenerator(this.renderer);
    const roomEnvironment = new RoomEnvironment();
    this.environmentRenderTarget = pmremGenerator.fromScene(roomEnvironment, ENVIRONMENT_BLUR_SIGMA);
    this.scene.environment = this.environmentRenderTarget.texture;

    roomEnvironment.dispose();
    pmremGenerator.dispose();
  }

  private resolveUiElements(): UiElements {
    const panel = document.getElementById('ui-panel');
    const handleTop = document.getElementById('ui-handle');
    const handleBottom = document.getElementById('ui-handle-bottom');
    const collapseToggle = document.getElementById('collapse-toggle');
    const playButton = document.getElementById('play-sim');
    const pauseButton = document.getElementById('pause-sim');
    const restartButton = document.getElementById('restart-sim');
    const addPlaneButton = document.getElementById('add-plane');
    const addBoxButton = document.getElementById('add-box');
    const addSphereButton = document.getElementById('add-sphere');
    const addPyramidButton = document.getElementById('add-pyramid');
    const addTorusButton = document.getElementById('add-torus');
    const flowSpeedRange = document.getElementById('flow-speed');
    const flowSpeedValue = document.getElementById('flow-speed-value');
    const flowLengthRange = document.getElementById('flow-length');
    const flowLengthValue = document.getElementById('flow-length-value');
    const pathColorInput = document.getElementById('path-color');
    const obstructedColorInput = document.getElementById('obstructed-color');
    const turbulenceRange = document.getElementById('turbulence-strength');
    const turbulenceValue = document.getElementById('turbulence-value');
    const recoveryLengthRange = document.getElementById('recovery-length');
    const recoveryLengthValue = document.getElementById('recovery-length-value');
    const impactBufferRange = document.getElementById('impact-buffer');
    const impactBufferValue = document.getElementById('impact-buffer-value');
    const densityXRange = document.getElementById('density-x');
    const densityXValue = document.getElementById('density-x-value');
    const densityYRange = document.getElementById('density-y');
    const densityYValue = document.getElementById('density-y-value');

    if (
      !(panel instanceof HTMLDivElement) ||
      !(handleTop instanceof HTMLDivElement) ||
      !(handleBottom instanceof HTMLDivElement) ||
      !(collapseToggle instanceof HTMLButtonElement) ||
      !(playButton instanceof HTMLButtonElement) ||
      !(pauseButton instanceof HTMLButtonElement) ||
      !(restartButton instanceof HTMLButtonElement) ||
      !(addPlaneButton instanceof HTMLButtonElement) ||
      !(addBoxButton instanceof HTMLButtonElement) ||
      !(addSphereButton instanceof HTMLButtonElement) ||
      !(addPyramidButton instanceof HTMLButtonElement) ||
      !(addTorusButton instanceof HTMLButtonElement) ||
      !(flowSpeedRange instanceof HTMLInputElement) ||
      !(flowSpeedValue instanceof HTMLSpanElement) ||
      !(flowLengthRange instanceof HTMLInputElement) ||
      !(flowLengthValue instanceof HTMLSpanElement) ||
      !(pathColorInput instanceof HTMLInputElement) ||
      !(obstructedColorInput instanceof HTMLInputElement) ||
      !(turbulenceRange instanceof HTMLInputElement) ||
      !(turbulenceValue instanceof HTMLSpanElement) ||
      !(recoveryLengthRange instanceof HTMLInputElement) ||
      !(recoveryLengthValue instanceof HTMLSpanElement) ||
      !(impactBufferRange instanceof HTMLInputElement) ||
      !(impactBufferValue instanceof HTMLSpanElement) ||
      !(densityXRange instanceof HTMLInputElement) ||
      !(densityXValue instanceof HTMLSpanElement) ||
      !(densityYRange instanceof HTMLInputElement) ||
      !(densityYValue instanceof HTMLSpanElement)
    ) {
      throw new Error('UI elements for controls panel are missing or invalid.');
    }

    return {
      panel,
      handleTop,
      handleBottom,
      collapseToggle,
      playButton,
      pauseButton,
      restartButton,
      addPlaneButton,
      addBoxButton,
      addSphereButton,
      addPyramidButton,
      addTorusButton,
      flowSpeedRange,
      flowSpeedValue,
      flowLengthRange,
      flowLengthValue,
      pathColorInput,
      obstructedColorInput,
      turbulenceRange,
      turbulenceValue,
      recoveryLengthRange,
      recoveryLengthValue,
      impactBufferRange,
      impactBufferValue,
      densityXRange,
      densityXValue,
      densityYRange,
      densityYValue,
    };
  }

  private setupUi(): void {
    this.bindRangeControl(
      {
        input: this.uiElements.flowSpeedRange,
        value: this.uiElements.flowSpeedValue,
        format: (value) => value.toFixed(2),
      },
      (value) => {
        this.uiState.flowSpeed = value;
        this.playbackState.speed = value;
      },
      this.uiState.flowSpeed,
    );

    this.bindRangeControl(
      {
        input: this.uiElements.flowLengthRange,
        value: this.uiElements.flowLengthValue,
        format: (value) => value.toFixed(2),
      },
      (value) => {
        this.uiState.flowLength = value;
      },
      this.uiState.flowLength,
    );

    this.uiElements.pathColorInput.value = this.uiState.pathColor;
    this.uiElements.obstructedColorInput.value = this.uiState.obstructedColor;
    this.syncParticleGradientEndpoints();

    this.addDomListener(this.uiElements.pathColorInput, 'input', () => {
      this.uiState.pathColor = this.uiElements.pathColorInput.value;
      this.syncParticleGradientEndpoints();
      this.pendingTrailGradientRecolor = true;
    });

    this.addDomListener(this.uiElements.obstructedColorInput, 'input', () => {
      this.uiState.obstructedColor = this.uiElements.obstructedColorInput.value;
      this.syncParticleGradientEndpoints();
      this.pendingTrailGradientRecolor = true;
    });

    this.bindRangeControl(
      {
        input: this.uiElements.turbulenceRange,
        value: this.uiElements.turbulenceValue,
        format: (value) => value.toFixed(2),
      },
      (value) => {
        this.uiState.turbulence = value;
        this.flowConfig.turbulenceStrength = value;
      },
      this.uiState.turbulence,
    );

    this.bindRangeControl(
      {
        input: this.uiElements.recoveryLengthRange,
        value: this.uiElements.recoveryLengthValue,
        format: (value) => value.toFixed(2),
      },
      (value) => {
        this.uiState.recoveryLength = value;
        this.flowConfig.recoveryLength = value;
      },
      this.uiState.recoveryLength,
    );

    this.bindRangeControl(
      {
        input: this.uiElements.impactBufferRange,
        value: this.uiElements.impactBufferValue,
        format: (value) => value.toFixed(2),
      },
      (value) => {
        this.uiState.impactBuffer = value;
        this.flowConfig.obstacleInfluenceRadius = value;
      },
      this.uiState.impactBuffer,
    );

    this.bindRangeControl(
      {
        input: this.uiElements.densityXRange,
        value: this.uiElements.densityXValue,
        format: (value) => String(Math.round(value)),
      },
      (value) => {
        this.setEmitterDensity(value, this.uiState.densityY);
      },
      this.uiState.densityX,
    );

    this.bindRangeControl(
      {
        input: this.uiElements.densityYRange,
        value: this.uiElements.densityYValue,
        format: (value) => String(Math.round(value)),
      },
      (value) => {
        this.setEmitterDensity(this.uiState.densityX, value);
      },
      this.uiState.densityY,
    );

    this.addDomListener(this.uiElements.playButton, 'click', () => this.play());
    this.addDomListener(this.uiElements.pauseButton, 'click', () => this.pause());
    this.addDomListener(this.uiElements.restartButton, 'click', () => this.restart());
    this.addDomListener(this.uiElements.addPlaneButton, 'click', () => this.addObstaclePlane());
    this.addDomListener(this.uiElements.addBoxButton, 'click', () => this.addObstacleBox());
    this.addDomListener(this.uiElements.addSphereButton, 'click', () => this.addObstacleSphere());
    this.addDomListener(this.uiElements.addPyramidButton, 'click', () => this.addObstaclePyramid());
    this.addDomListener(this.uiElements.addTorusButton, 'click', () => this.addObstacleTorus());

    this.setupUiPanelInteractions();
    this.refreshAllRangeProgress();
  }

  private setupUiPanelInteractions(): void {
    const { panel, handleTop, handleBottom, collapseToggle } = this.uiElements;
    let dragOffset: { x: number; y: number } | null = null;

    this.addDomListener(collapseToggle, 'pointerdown', (event) => {
      event.stopPropagation();
    });

    this.addDomListener(collapseToggle, 'click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');
      collapseToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      this.clampPanelToViewport();
      requestAnimationFrame(() => this.refreshAllRangeProgress());
    });

    const sectionHeadings = panel.querySelectorAll<HTMLButtonElement>('.panel-section .panel-heading');
    for (const heading of sectionHeadings) {
      this.addDomListener(heading, 'click', () => {
        const section = heading.closest('.panel-section');
        if (!section) {
          return;
        }
        const collapsed = section.classList.toggle('is-collapsed');
        heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.clampPanelToViewport();
        requestAnimationFrame(() => this.refreshAllRangeProgress());
      });
    }

    const startDrag = (event: Event): void => {
      const pointerEvent = event as PointerEvent;
      const target = pointerEvent.target;
      if (target instanceof Element && target.closest('.collapse-button')) {
        return;
      }
      const currentTarget = pointerEvent.currentTarget;
      if (!(currentTarget instanceof Element)) {
        return;
      }
      if ('setPointerCapture' in currentTarget) {
        (currentTarget as HTMLElement).setPointerCapture(pointerEvent.pointerId);
      }
      dragOffset = {
        x: pointerEvent.clientX - panel.offsetLeft,
        y: pointerEvent.clientY - panel.offsetTop,
      };
    };

    const moveDrag = (event: Event): void => {
      const pointerEvent = event as PointerEvent;
      if (!dragOffset) {
        return;
      }
      const margin = 10;
      const nextX = Math.max(
        margin,
        Math.min(window.innerWidth - panel.offsetWidth - margin, pointerEvent.clientX - dragOffset.x),
      );
      const nextY = Math.max(margin, pointerEvent.clientY - dragOffset.y);
      panel.style.left = `${nextX}px`;
      panel.style.top = `${nextY}px`;
      this.clampPanelToViewport();
    };

    const endDrag = (): void => {
      dragOffset = null;
    };

    const dragTargets = [handleTop, handleBottom];
    for (const dragTarget of dragTargets) {
      this.addDomListener(dragTarget, 'pointerdown', startDrag);
      this.addDomListener(dragTarget, 'pointermove', moveDrag);
      this.addDomListener(dragTarget, 'pointerup', endDrag);
      this.addDomListener(dragTarget, 'pointercancel', endDrag);
    }

    this.clampPanelToViewport();
  }

  private bindRangeControl(binding: UiRangeBinding, onChange: (value: number) => void, initialValue: number): void {
    this.uiRangeBindings.push(binding);
    binding.input.value = String(initialValue);
    const update = (): void => {
      const value = Number(binding.input.value);
      binding.value.textContent = binding.format(value);
      this.setRangeProgress(binding.input);
      onChange(value);
    };
    this.addDomListener(binding.input, 'input', update);
    update();
  }

  private setRangeProgress(input: HTMLInputElement): void {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const span = max - min;
    const percent = span <= 0 ? 0 : (value - min) / span;
    const uiScaleRaw = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-size-scale'));
    const uiScale = Number.isFinite(uiScaleRaw) && uiScaleRaw > 0 ? uiScaleRaw : 1;
    const thumbSize = 16 * uiScale;
    const trackWidth = input.clientWidth || 1;
    const usable = Math.max(trackWidth - thumbSize, 1);
    const px = percent * usable + thumbSize * 0.5;
    input.style.setProperty('--range-progress', `${px}px`);
  }

  private refreshAllRangeProgress(): void {
    for (const binding of this.uiRangeBindings) {
      this.setRangeProgress(binding.input);
    }
  }

  private clampPanelToViewport(): void {
    const { panel, handleTop, handleBottom } = this.uiElements;
    const margin = 10;

    const minHeight = handleTop.offsetHeight + handleBottom.offsetHeight + 40;
    const maxTop = Math.max(margin, window.innerHeight - minHeight - margin);
    const clampedTop = Math.min(Math.max(panel.offsetTop, margin), maxTop);
    if (clampedTop !== panel.offsetTop) {
      panel.style.top = `${clampedTop}px`;
    }

    const availableHeight = window.innerHeight - clampedTop - margin;
    panel.style.maxHeight = `${Math.max(availableHeight, minHeight)}px`;

    const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    const clampedLeft = Math.min(Math.max(panel.offsetLeft, margin), maxLeft);
    if (clampedLeft !== panel.offsetLeft) {
      panel.style.left = `${clampedLeft}px`;
    }
  }

  private addDomListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    this.uiCleanupCallbacks.push(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.clampPanelToViewport();
    this.refreshAllRangeProgress();
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    if (this.isUsingTransformControls || this.isTransformDragging) {
      return;
    }

    this.updatePointerFromEvent(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(Array.from(this.selectable));

    if (intersections.length === 0) {
      this.selectPlane(null);
      return;
    }

    const planeId = intersections[0].object.userData.planeId as string | undefined;
    if (!planeId) {
      this.selectPlane(null);
      return;
    }

    this.selectPlane(planeId);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.selectPlane(null);
      event.preventDefault();
      return;
    }

    if (event.key === 'Delete' && this.selectedPlaneId && this.selectedPlaneId !== this.emitterId) {
      this.removeObstacle(this.selectedPlaneId);
      event.preventDefault();
    }
  }

  private updatePointerFromEvent(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private updateSpawnRateFromDensity(): void {
    const vertexCount = getEmitterVertexCount(this.emitterConfig.densityX, this.emitterConfig.densityY);
    this.emitterConfig.spawnRate = computeSpawnRateFromVertexCount(vertexCount, this.particleSystem.maxParticles);
  }

  private getEffectiveSpawnRate(): number {
    const lengthScale = Math.max(FLOW_LENGTH_MIN, this.uiState.flowLength);
    const rate = this.emitterConfig.spawnRate / lengthScale;
    return Math.max(8, Math.min(this.particleSystem.maxParticles * 8, rate));
  }

  private syncParticleGradientEndpoints(): void {
    this.pathColorScratch.set(this.uiState.pathColor);
    this.obstructedColorScratch.set(this.uiState.obstructedColor);
  }

  private computeNormalizedOffPath(index: number, worldPosition: Vector3): number {
    const i3 = index * 3;
    this.laneOriginScratch.set(
      this.particleLaneOrigins[i3],
      this.particleLaneOrigins[i3 + 1],
      this.particleLaneOrigins[i3 + 2],
    );
    this.laneDirectionScratch.set(
      this.particleLaneDirections[i3],
      this.particleLaneDirections[i3 + 1],
      this.particleLaneDirections[i3 + 2],
    );

    const forwardDistance = this.steeringScratch.copy(worldPosition).sub(this.laneOriginScratch).dot(this.laneDirectionScratch);
    if (forwardDistance <= 0) {
      return 0;
    }

    this.laneTargetScratch.copy(this.laneDirectionScratch).multiplyScalar(forwardDistance).add(this.laneOriginScratch);
    const lateralDistance = this.steeringScratch.copy(worldPosition).sub(this.laneTargetScratch).length();
    const normalized = lateralDistance / OFF_PATH_DISTANCE_FOR_MAX_COLOR;
    return Math.min(1, Math.max(0, normalized));
  }

  private setParticleGradientColor(index: number, normalizedOffPath: number): void {
    const t = Math.min(1, Math.max(0, normalizedOffPath));
    this.blendedColorScratch.copy(this.pathColorScratch).lerp(this.obstructedColorScratch, t);
    this.particleSystem.setParticleColor(index, this.blendedColorScratch.r, this.blendedColorScratch.g, this.blendedColorScratch.b);
  }

  private recolorParticlesFromCachedDeviation(syncTrailHistory: boolean): void {
    for (let i = 0; i < this.particleSystem.maxParticles; i += 1) {
      this.setParticleGradientColor(i, this.particleOffPathAmounts[i]);
    }
    if (syncTrailHistory) {
      this.particleSystem.syncTrailColorHistoryToParticleColors();
    }
    this.particleSystem.refreshGpuBuffers();
  }

  private updateAllWorldMatrices(): void {
    for (const entity of this.planeEntities.values()) {
      entity.transformObject.updateMatrixWorld(true);
    }
  }

  private refreshEmitterSpawnData(): void {
    const emitter = this.planeEntities.get(this.emitterId);
    if (!emitter) {
      return;
    }

    emitter.mesh.getWorldQuaternion(this.quaternionScratch);
    computeEmitterWorldNormal(this.quaternionScratch, this.emitterNormal);
    this.emitterRight.set(1, 0, 0).applyQuaternion(this.quaternionScratch).normalize();
    this.emitterUp.set(0, 1, 0).applyQuaternion(this.quaternionScratch).normalize();

    const matrix = emitter.mesh.matrixWorld;
    for (let i = 0; i < this.emitterLocalVertices.length; i += 3) {
      this.positionScratch.set(
        this.emitterLocalVertices[i],
        this.emitterLocalVertices[i + 1],
        this.emitterLocalVertices[i + 2],
      );
      this.positionScratch.applyMatrix4(matrix);
      this.emitterWorldVertices[i] = this.positionScratch.x;
      this.emitterWorldVertices[i + 1] = this.positionScratch.y;
      this.emitterWorldVertices[i + 2] = this.positionScratch.z;
    }
  }

  private refreshObstacleFieldData(): void {
    this.obstacleRuntimes.length = 0;

    for (const [id, entity] of this.planeEntities) {
      if (entity.kind !== 'obstacle') {
        continue;
      }
      const data = createObstacleFieldData();
      updateObstacleFieldDataFromObject(entity.mesh, this.flowConfig.obstacleInfluenceRadius, this.flowConfig.wakeStrength, data);
      this.obstacleRuntimes.push({ id, data });
    }
  }

  private randomUnit(index: number, channel: number): number {
    const raw = Math.sin((index + 1) * 12.9898 + channel * 78.233 + this.simTime * 0.7) * 43758.5453;
    return raw - Math.floor(raw);
  }

  private respawnParticleAtEmitter(index: number): void {
    const vertexCount = this.emitterWorldVertices.length / 3;
    if (vertexCount <= 0) {
      return;
    }

    const vertexIndex = this.spawnVertexCursor % vertexCount;
    this.spawnVertexCursor += 1;

    const v3 = vertexIndex * 3;
    const px = this.emitterWorldVertices[v3];
    const py = this.emitterWorldVertices[v3 + 1];
    const pz = this.emitterWorldVertices[v3 + 2];

    const jitterA = (this.randomUnit(index, 0) - 0.5) * 0.3;
    const jitterB = (this.randomUnit(index, 1) - 0.5) * 0.3;

    this.positionScratch.set(px, py, pz);
    this.velocityScratch
      .copy(this.emitterNormal)
      .multiplyScalar(this.emitterConfig.initialSpeed)
      .addScaledVector(this.emitterRight, jitterA)
      .addScaledVector(this.emitterUp, jitterB);

    const flowLengthScale = Math.pow(Math.max(FLOW_LENGTH_MIN, this.uiState.flowLength), FLOW_LENGTH_LIFETIME_EXPONENT);
    const lifeScale = (0.72 + this.randomUnit(index, 2) * 0.55) * flowLengthScale;
    this.particleOffPathAmounts[index] = 0;
    this.particleImpactTurbulence[index] = 0;
    this.setParticleGradientColor(index, 0);
    this.particleSystem.respawnParticle(index, this.positionScratch, this.velocityScratch, this.emitterConfig.particleLifetime * lifeScale);

    const i3 = index * 3;
    this.particleLaneOrigins[i3] = this.positionScratch.x;
    this.particleLaneOrigins[i3 + 1] = this.positionScratch.y;
    this.particleLaneOrigins[i3 + 2] = this.positionScratch.z;
    this.particleLaneDirections[i3] = this.emitterNormal.x;
    this.particleLaneDirections[i3 + 1] = this.emitterNormal.y;
    this.particleLaneDirections[i3 + 2] = this.emitterNormal.z;
  }

  private initializeRestartParticleDistribution(): void {
    const maxParticles = this.particleSystem.maxParticles;
    const startDistance = Math.max(0.5, this.uiState.flowLength * 0.9);

    for (let i = 0; i < maxParticles; i += 1) {
      this.respawnParticleAtEmitter(i);
      const phase = 0.02 + this.randomUnit(i, 5) * 0.96;
      this.particleSystem.ages[i] = this.particleSystem.lifetimes[i] * phase;

      const i3 = i * 3;
      this.positionScratch.set(
        this.particleLaneOrigins[i3],
        this.particleLaneOrigins[i3 + 1],
        this.particleLaneOrigins[i3 + 2],
      );
      this.laneDirectionScratch.set(
        this.particleLaneDirections[i3],
        this.particleLaneDirections[i3 + 1],
        this.particleLaneDirections[i3 + 2],
      );
      this.positionScratch.addScaledVector(this.laneDirectionScratch, startDistance * phase);

      this.particleSystem.positions[i3] = this.positionScratch.x;
      this.particleSystem.positions[i3 + 1] = this.positionScratch.y;
      this.particleSystem.positions[i3 + 2] = this.positionScratch.z;
    }
  }

  private applyLaneRecovery(index: number, dt: number, nearObstacleSurface: boolean): void {
    if (nearObstacleSurface) {
      return;
    }

    const i3 = index * 3;
    this.laneOriginScratch.set(
      this.particleLaneOrigins[i3],
      this.particleLaneOrigins[i3 + 1],
      this.particleLaneOrigins[i3 + 2],
    );
    this.laneDirectionScratch.set(
      this.particleLaneDirections[i3],
      this.particleLaneDirections[i3 + 1],
      this.particleLaneDirections[i3 + 2],
    );

    const forwardDistance = this.steeringScratch.copy(this.positionScratch).sub(this.laneOriginScratch).dot(this.laneDirectionScratch);
    if (forwardDistance <= 0) {
      return;
    }

    this.laneTargetScratch.copy(this.laneDirectionScratch).multiplyScalar(forwardDistance).add(this.laneOriginScratch);
    this.steeringScratch.copy(this.laneTargetScratch).sub(this.positionScratch);
    const lateralError = this.steeringScratch.length();
    if (lateralError <= 1e-4) {
      return;
    }

    const recoveryDistance = Math.max(0.1, this.flowConfig.recoveryLength);
    const forwardSpeed = Math.max(0.2, Math.abs(this.velocityScratch.dot(this.laneDirectionScratch)));
    const recoveryRate = (forwardSpeed / recoveryDistance) * 1.2;
    const recoveryStep = Math.min(0.35, recoveryRate * dt);
    this.velocityScratch.addScaledVector(this.steeringScratch, recoveryStep);
  }

  private simulate(dt: number): void {
    this.simTime += dt;

    this.updateAllWorldMatrices();
    this.refreshEmitterSpawnData();
    this.refreshObstacleFieldData();

    this.spawnAccumulator += dt * this.getEffectiveSpawnRate();
    while (this.spawnAccumulator >= 1) {
      this.respawnParticleAtEmitter(this.spawnParticleCursor);
      this.spawnParticleCursor = (this.spawnParticleCursor + 1) % this.particleSystem.maxParticles;
      this.spawnAccumulator -= 1;
    }

    const dragScale = Math.exp(-this.flowConfig.drag * dt);

    for (let i = 0; i < this.particleSystem.maxParticles; i += 1) {
      this.particleSystem.ages[i] += dt;
      if (this.particleSystem.ages[i] >= this.particleSystem.lifetimes[i]) {
        this.respawnParticleAtEmitter(i);
        continue;
      }

      const i3 = i * 3;
      this.positionScratch.set(
        this.particleSystem.positions[i3],
        this.particleSystem.positions[i3 + 1],
        this.particleSystem.positions[i3 + 2],
      );
      this.velocityScratch.set(
        this.particleSystem.velocities[i3],
        this.particleSystem.velocities[i3 + 1],
        this.particleSystem.velocities[i3 + 2],
      );

      this.baseFlowScratch.copy(this.emitterNormal).multiplyScalar(this.emitterConfig.initialSpeed);
      this.steeringScratch.copy(this.baseFlowScratch).sub(this.velocityScratch);
      this.velocityScratch.addScaledVector(this.steeringScratch, Math.min(1, dt * 1.4));

      let nearObstacleSurface = false;
      let impactedThisFrame = false;
      for (const runtime of this.obstacleRuntimes) {
        const touchedSurface = applyObstacleInteraction(
          this.positionScratch,
          this.velocityScratch,
          runtime.data,
          this.emitterNormal,
          this.simTime,
          this.flowConfig.turbulenceScale,
          0,
        );
        nearObstacleSurface = nearObstacleSurface || touchedSurface;
        impactedThisFrame = impactedThisFrame || touchedSurface;
      }

      if (impactedThisFrame) {
        this.particleImpactTurbulence[i] = 1;
      }

      const impactTurbulenceWeight = this.particleImpactTurbulence[i];
      if (impactTurbulenceWeight > 1e-4 && this.flowConfig.turbulenceStrength > 1e-5) {
        sampleCurlNoise(this.positionScratch, this.simTime, this.flowConfig.turbulenceScale, this.turbulenceScratch);
        this.turbulenceScratch.addScaledVector(this.emitterNormal, -this.turbulenceScratch.dot(this.emitterNormal));
        const turbulenceLengthSq = this.turbulenceScratch.lengthSq();
        if (turbulenceLengthSq > 1e-6) {
          this.turbulenceScratch.multiplyScalar(1 / Math.sqrt(turbulenceLengthSq));
          this.velocityScratch.addScaledVector(
            this.turbulenceScratch,
            this.flowConfig.turbulenceStrength * impactTurbulenceWeight * dt * 2.25,
          );
        }
      }

      this.applyLaneRecovery(i, dt, nearObstacleSurface);

      this.velocityScratch.multiplyScalar(dragScale);
      this.positionScratch.addScaledVector(this.velocityScratch, dt);

      this.particleSystem.positions[i3] = this.positionScratch.x;
      this.particleSystem.positions[i3 + 1] = this.positionScratch.y;
      this.particleSystem.positions[i3 + 2] = this.positionScratch.z;
      this.particleSystem.velocities[i3] = this.velocityScratch.x;
      this.particleSystem.velocities[i3 + 1] = this.velocityScratch.y;
      this.particleSystem.velocities[i3 + 2] = this.velocityScratch.z;

      const normalizedOffPath = this.computeNormalizedOffPath(i, this.positionScratch);
      if (nearObstacleSurface) {
        this.particleImpactTurbulence[i] = 1;
      } else if (this.particleImpactTurbulence[i] > 0) {
        const targetWeight = Math.min(1, normalizedOffPath * 2);
        const recoveryDistance = Math.max(0.1, this.flowConfig.recoveryLength);
        const blend = Math.min(1, dt * (1.2 + 2.8 / recoveryDistance));
        const relaxedWeight = this.particleImpactTurbulence[i] + (targetWeight - this.particleImpactTurbulence[i]) * blend;
        this.particleImpactTurbulence[i] =
          relaxedWeight < 0.02 && normalizedOffPath < 0.01
            ? 0
            : relaxedWeight;
      }
      this.particleOffPathAmounts[i] = normalizedOffPath;
      this.setParticleGradientColor(i, normalizedOffPath);
      this.particleSystem.pushTrailSample(i);
    }

    if (this.pendingTrailGradientRecolor) {
      this.particleSystem.syncTrailColorHistoryToParticleColors();
      this.pendingTrailGradientRecolor = false;
    }

    this.particleSystem.refreshGpuBuffers();
  }

  private animationLoop = (): void => {
    this.animationFrameHandle = requestAnimationFrame(this.animationLoop);

    const nowSeconds = performance.now() * 0.001;
    const rawDelta = nowSeconds - this.lastAnimationTimeSeconds;
    this.lastAnimationTimeSeconds = nowSeconds;
    const dt = Math.min(0.05, Math.max(1 / 240, rawDelta));

    this.orbitControls.update();

    if (this.playbackState.isPlaying) {
      const scaledDt = dt * Math.max(0.05, this.playbackState.speed) * this.flowConfig.timeScale;
      this.simulate(scaledDt);
    } else if (this.pendingTrailGradientRecolor) {
      this.pendingTrailGradientRecolor = false;
      this.recolorParticlesFromCachedDeviation(true);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private createTransformControl(
    mode: 'translate' | 'rotate' | 'scale',
    size: number,
  ): { control: TransformControls; helper: Object3D } {
    const control = new TransformControls(this.camera, this.renderer.domElement);
    control.setMode(mode);
    control.setSpace('local');
    control.setSize(size);
    control.addEventListener('dragging-changed', () => {
      if (control.dragging) {
        this.setExclusiveTransformControl(control);
      } else {
        this.setExclusiveTransformControl(null);
      }
      this.updateTransformDraggingState();
    });
    control.addEventListener('mouseDown', () => {
      if (!this.getTransformControlAxis(control)) {
        return;
      }
      this.setExclusiveTransformControl(control);
      this.isUsingTransformControls = true;
    });
    control.addEventListener('mouseUp', () => {
      window.setTimeout(() => {
        this.isUsingTransformControls = false;
        this.setExclusiveTransformControl(null);
      }, 0);
    });
    if (mode === 'scale') {
      control.addEventListener('objectChange', () => {
        this.handleScaleProxyObjectChange();
      });
    }

    const helper = control.getHelper();
    this.stripNonAxisTransformHandles(control, mode);
    if (mode === 'translate') {
      this.stripTranslateBackArrows(control);
      this.resizeTranslateArrowHeads(control, TRANSLATE_ARROW_HEAD_SCALE);
    }
    if (mode === 'scale') {
      this.pushBackScaleHandles(control, BACK_SCALE_HANDLE_OFFSET);
      this.rebuildScaleAxisPickersFromVisibleBoxes(control, SCALE_BOX_PICKER_SCALE);
    }
    if (mode !== 'scale') {
      this.tightenTransformPickerHitAreas(
        control,
        mode,
        mode === 'rotate' ? ROTATE_PICKER_HIT_SCALE : TRANSLATE_PICKER_HIT_SCALE,
      );
    } else {
      this.tightenTransformPickerHitAreas(control, mode, SCALE_PICKER_HIT_SCALE);
    }
    this.scene.add(helper);
    return { control, helper };
  }

  private updateTransformDraggingState(): void {
    const isDragging = this.transformControls.some((control) => control.dragging);
    this.isTransformDragging = isDragging;
    this.orbitControls.enabled = !isDragging;
  }

  private getTransformControlAxis(control: TransformControls): string | null {
    const axis = (control as unknown as { axis?: string | null }).axis;
    if (typeof axis === 'string') {
      return axis;
    }
    return null;
  }

  private setExclusiveTransformControl(activeControl: TransformControls | null): void {
    for (const control of this.transformControls) {
      control.enabled = !activeControl || control === activeControl;
    }
  }

  private stripNonAxisTransformHandles(control: TransformControls, mode: 'translate' | 'rotate' | 'scale'): void {
    const allowedHandleNames = new Set(mode === 'scale' ? ['X', 'Y', 'Z', 'XYZ'] : ['X', 'Y', 'Z']);
    const internal = control as unknown as {
      _gizmo?: {
        gizmo?: Record<string, Object3D>;
        picker?: Record<string, Object3D>;
        helper?: Record<string, Object3D>;
      };
    };

    const gizmo = internal._gizmo;
    if (!gizmo) {
      return;
    }

    const helperGroup = gizmo.helper?.[mode];
    if (helperGroup) {
      for (const child of [...helperGroup.children]) {
        helperGroup.remove(child);
      }
    }

    const groups: Array<Object3D | undefined> = [gizmo.gizmo?.[mode], gizmo.picker?.[mode]];
    for (const group of groups) {
      if (!group) {
        continue;
      }
      const toRemove = group.children.filter((child) => !allowedHandleNames.has(child.name));
      for (const child of toRemove) {
        group.remove(child);
      }
    }
  }

  private stripTranslateBackArrows(control: TransformControls): void {
    const axisVectors: Record<'X' | 'Y' | 'Z', Vector3> = {
      X: new Vector3(1, 0, 0),
      Y: new Vector3(0, 1, 0),
      Z: new Vector3(0, 0, 1),
    };

    const internal = control as unknown as {
      _gizmo?: {
        gizmo?: Record<string, Object3D>;
        picker?: Record<string, Object3D>;
      };
    };

    const gizmo = internal._gizmo;
    if (!gizmo) {
      return;
    }

    const groups: Array<Object3D | undefined> = [gizmo.gizmo?.translate, gizmo.picker?.translate];
    for (const group of groups) {
      if (!group) {
        continue;
      }

      for (const axisName of ['X', 'Y', 'Z'] as const) {
        const axisChildren = group.children.filter((child) => child.name === axisName);
        if (axisChildren.length <= 1) {
          continue;
        }

        const axisVector = axisVectors[axisName];
        const toRemove: Object3D[] = [];

        for (const child of axisChildren) {
          const meshLike = child as Object3D & { geometry?: BufferGeometry };
          const geometry = meshLike.geometry;
          if (!geometry) {
            continue;
          }

          geometry.computeBoundingBox();
          const boundingBox = geometry.boundingBox;
          if (!boundingBox) {
            continue;
          }

          const center = boundingBox.getCenter(new Vector3());
          const projection = center.dot(axisVector);
          if (projection < -1e-4) {
            toRemove.push(child);
          }
        }

        for (const child of toRemove) {
          group.remove(child);
        }
      }
    }
  }

  private resizeTranslateArrowHeads(control: TransformControls, scaleFactor: number): void {
    const axisVectors: Record<'X' | 'Y' | 'Z', Vector3> = {
      X: new Vector3(1, 0, 0),
      Y: new Vector3(0, 1, 0),
      Z: new Vector3(0, 0, 1),
    };

    const internal = control as unknown as {
      _gizmo?: {
        gizmo?: Record<string, Object3D>;
      };
    };

    const group = internal._gizmo?.gizmo?.translate;
    if (!group) {
      return;
    }

    for (const axisName of ['X', 'Y', 'Z'] as const) {
      const axisVector = axisVectors[axisName];
      for (const child of group.children) {
        if (child.name !== axisName) {
          continue;
        }

        const meshLike = child as Object3D & { geometry?: BufferGeometry };
        const geometry = meshLike.geometry;
        if (!geometry) {
          continue;
        }

        geometry.computeBoundingBox();
        const boundingBox = geometry.boundingBox;
        if (!boundingBox) {
          continue;
        }

        const center = boundingBox.getCenter(new Vector3());
        const size = boundingBox.getSize(new Vector3());
        const maxExtent = Math.max(size.x, size.y, size.z);
        const minExtent = Math.min(size.x, size.y, size.z);

        const projection = center.dot(axisVector);
        const isArrowHead = projection > 0.35 && maxExtent <= 0.16 && minExtent > 0.03;
        if (!isArrowHead) {
          continue;
        }

        const centerInv = center.clone().multiplyScalar(-1);
        geometry.translate(centerInv.x, centerInv.y, centerInv.z);
        geometry.scale(scaleFactor, scaleFactor, scaleFactor);
        geometry.translate(center.x, center.y, center.z);
      }
    }
  }

  private pushBackScaleHandles(control: TransformControls, offset: number): void {
    const axisVectors: Record<'X' | 'Y' | 'Z', Vector3> = {
      X: new Vector3(1, 0, 0),
      Y: new Vector3(0, 1, 0),
      Z: new Vector3(0, 0, 1),
    };

    const internal = control as unknown as {
      _gizmo?: {
        gizmo?: Record<string, Object3D>;
        picker?: Record<string, Object3D>;
      };
    };

    const gizmo = internal._gizmo;
    if (!gizmo) {
      return;
    }

    const visualGroup = gizmo.gizmo?.scale;
    if (visualGroup) {
      for (const axisName of ['X', 'Y', 'Z'] as const) {
        const axisVector = axisVectors[axisName];
        const toRemove: Object3D[] = [];
        for (const child of visualGroup.children) {
          if (child.name !== axisName) {
            continue;
          }
          const meshLike = child as Object3D & { geometry?: BufferGeometry };
          const geometry = meshLike.geometry;
          if (!geometry) {
            continue;
          }

          geometry.computeBoundingBox();
          const boundingBox = geometry.boundingBox;
          if (!boundingBox) {
            continue;
          }

          const size = boundingBox.getSize(new Vector3());
          const maxExtent = Math.max(size.x, size.y, size.z);
          if (maxExtent > 0.2) {
            continue;
          }

          const center = boundingBox.getCenter(new Vector3());
          const projection = center.dot(axisVector);
          if (projection > 1e-4) {
            toRemove.push(child);
          } else if (projection < -1e-4) {
            geometry.translate(-axisVector.x * offset, -axisVector.y * offset, -axisVector.z * offset);
          }
        }
        for (const child of toRemove) {
          visualGroup.remove(child);
        }
      }
    }

  }

  private rebuildScaleAxisPickersFromVisibleBoxes(control: TransformControls, scaleFactor: number): void {
    const internal = control as unknown as {
      _gizmo?: {
        gizmo?: Record<string, Object3D>;
        picker?: Record<string, Object3D>;
      };
    };

    const visualGroup = internal._gizmo?.gizmo?.scale;
    const pickerGroup = internal._gizmo?.picker?.scale;
    if (!visualGroup || !pickerGroup) {
      return;
    }

    for (const child of [...pickerGroup.children]) {
      if (child.userData?.customScalePicker) {
        const meshLike = child as Object3D & { geometry?: BufferGeometry };
        meshLike.geometry?.dispose();
        pickerGroup.remove(child);
      }
    }

    for (const axisName of ['X', 'Y', 'Z'] as const) {
      for (const child of visualGroup.children) {
        if (child.name !== axisName) {
          continue;
        }

        const meshLike = child as Object3D & { geometry?: BufferGeometry };
        const geometry = meshLike.geometry;
        if (!geometry) {
          continue;
        }

        geometry.computeBoundingBox();
        const boundingBox = geometry.boundingBox;
        if (!boundingBox) {
          continue;
        }

        const size = boundingBox.getSize(new Vector3());
        const maxExtent = Math.max(size.x, size.y, size.z);
        const minExtent = Math.min(size.x, size.y, size.z);
        const isScaleBox = maxExtent <= 0.2 && minExtent > 0.03;
        if (!isScaleBox) {
          continue;
        }

        const pickerGeometry = geometry.clone();
        pickerGeometry.computeBoundingBox();
        const pickerBounds = pickerGeometry.boundingBox;
        if (!pickerBounds) {
          pickerGeometry.dispose();
          continue;
        }

        const center = pickerBounds.getCenter(new Vector3());
        pickerGeometry.translate(-center.x, -center.y, -center.z);
        pickerGeometry.scale(scaleFactor, scaleFactor, scaleFactor);
        pickerGeometry.translate(center.x, center.y, center.z);
        pickerGeometry.computeBoundingBox();
        pickerGeometry.computeBoundingSphere();

        const pickerMesh = new Mesh(pickerGeometry, this.scalePickerMaterial);
        pickerMesh.name = axisName;
        pickerMesh.position.copy(child.position);
        pickerMesh.quaternion.copy(child.quaternion);
        pickerMesh.scale.copy(child.scale);
        pickerMesh.userData.customScalePicker = true;
        pickerGroup.add(pickerMesh);
      }
    }
  }

  private tightenTransformPickerHitAreas(
    control: TransformControls,
    mode: 'translate' | 'rotate' | 'scale',
    scaleFactor: number,
  ): void {
    const internal = control as unknown as {
      _gizmo?: {
        picker?: Record<string, Object3D>;
      };
    };

    const pickerGroup = internal._gizmo?.picker?.[mode];
    if (!pickerGroup) {
      return;
    }

    const scaledGeometries = new Set<BufferGeometry>();
    for (const child of pickerGroup.children) {
      const meshLike = child as Object3D & { geometry?: BufferGeometry };
      const geometry = meshLike.geometry;
      if (!geometry || scaledGeometries.has(geometry)) {
        continue;
      }

      geometry.computeBoundingBox();
      const boundingBox = geometry.boundingBox;
      if (!boundingBox) {
        continue;
      }

      const center = boundingBox.getCenter(new Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.scale(scaleFactor, scaleFactor, scaleFactor);
      geometry.translate(center.x, center.y, center.z);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      scaledGeometries.add(geometry);
    }
  }
}

export function createAirflowShaperApp(canvas: HTMLCanvasElement): AirflowShaperApp {
  return new AirflowShaperAppImpl(canvas);
}
