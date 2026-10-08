import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { advanceToMorning, getGameDate, setGamePaused } from './calendar.js?v=town-7';
import { allowedAction, farmPhase, phaseMessage } from './farming.mjs?v=town-7';
import { bindingLabel, bindingSummary, eventMatches, onKeybindsChange } from './keybinds.js?v=town-7';
import { soilSampleRoute, soilReportDue, soilReportForField, soilReportStatus, SOIL_LAB_COST, nextSoilSamplePoint, soilCoverageAt, soilCoveragePercent, SOIL_LAB_DAY_MS } from './soil-study.mjs?v=drive-9';
import { advanceCar, distanceToRoad } from './driving.mjs?v=drive-9';
import { playSound, soundMuted, setSoundMuted } from './sound.js?v=soil-8';
// Importing the menu wires up the Escape menu (credits + keybind settings).
import './menu.js?v=town-7';

const CELL_SIZE = 1.25;
const MAX_GRID = 6;
let COLUMNS = 3;
let ROWS = 3;
let PLOT_COUNT = COLUMNS * ROWS;
const canvas = document.querySelector('#field');
const status = document.querySelector('#field-status');
setGamePaused(true);

// Each soil plot progresses through four states over the winter-wheat year:
// weedy (overgrown after the previous harvest) → cleared (weeds removed) →
// cultivated (seedbed prepared) → planted (winter wheat drilled).
const PLOT_STATE = Object.freeze({
  WEEDY: 'weedy',
  CLEARED: 'cleared',
  TESTED: 'tested',
  CULTIVATED: 'cultivated',
  PLANTED: 'planted',
  HARVESTED: 'harvested',
});
const plotStates = new Array(MAX_GRID * MAX_GRID).fill(PLOT_STATE.WEEDY);
const plotCare = Array.from({ length: MAX_GRID * MAX_GRID }, () => ({}));
const inventory = { seed: 0, fertiliser: 0, treatment: 0, grain: 0, straw: 0 };
let coins = 100;
let energy = 100;
const mapView = { centerX: 0, centerZ: 0, zoom: 8 };
const mapCanvas = document.querySelector('#farm-map-canvas');
const mapContext = mapCanvas?.getContext('2d');
const shopSupplies = [
  { key: 'seed', label: 'Winter wheat seed', unit: 'bags', price: 4 },
  { key: 'fertiliser', label: 'Spring fertiliser', unit: 'bags', price: 3 },
  { key: 'treatment', label: 'Crop treatment', unit: 'applications', price: 3 },
];
const sellableGoods = [
  { key: 'grain', label: 'Stored grain', unit: 'sacks', price: 5 },
  { key: 'straw', label: 'Baled straw', unit: 'bales', price: 2 },
];
const wheatGroups = new Array(MAX_GRID * MAX_GRID).fill(null);
let fieldBounds = null;
let cleanup = null;
let cleanupWork = null;
const terrainEdits = [];
const cleanupRocks = [];
const cleanupPatches = [];
const blockedPlots = new Set();
let temporaryTerrainEdit = null;
let lastTerrainRefresh = 0;
let soilStudy = { phase: 'not-started', points: [], sampleIndex: 0, submittedAt: null, report: null, reportDate: null, mailRead: false, bookOpened: false, carProgress: 0, carPose: null };
let carTrip = null;
const driveKeys = new Set();
const touchDriveKeys = new Set();
let lastEngineNote = 0;
let coverageOverlay = null;
let scoopUntil = 0;
let lastFootstep = 0;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch {
  status.textContent = 'This browser could not open the 3D field.';
  throw new Error('WebGL is unavailable');
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa2d3e9);
scene.fog = new THREE.Fog(0xa2d3e9, 28, 130);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 700);
camera.position.set(6.5, 8, 12.2);
camera.lookAt(-1.5, 0.25, -0.8);

const controls = new OrbitControls(camera, canvas);
controls.target.set(-1.5, 0.25, -0.8);
controls.enablePan = false;
controls.enableZoom = true;
controls.minDistance = 6.5;
controls.maxDistance = 55;
controls.minPolarAngle = THREE.MathUtils.degToRad(25);
controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
controls.rotateSpeed = 0.8;
controls.update();

// ==========================================================================
// CAMERA MEMORY
// --------------------------------------------------------------------------
// Where the camera is left is remembered between visits, alongside the wheat
// and weather that were already saved. Both the camera position and the orbit
// target are stored (moving with WASD shifts the target too), and the saved
// view is restored once the initial fit-to-window resize has run.
// ==========================================================================

const STORAGE_CAMERA_KEY = 'farm-hands-camera-v1';
const STORAGE_CAMERA_MEMORY_KEY = 'farm-hands-camera-memory-v1';
const STORAGE_PLOT_FOCUS_KEY = 'farm-hands-plot-focus-v1';
const DEFAULT_CAMERA_POSITION = camera.position.clone();
const DEFAULT_CAMERA_TARGET = controls.target.clone();
let lastSavedCameraState = '';

function isCameraMemoryEnabled() {
  try {
    return localStorage.getItem(STORAGE_CAMERA_MEMORY_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saneVector(values) {
  return Array.isArray(values)
    && values.length === 3
    && values.every((value) => Number.isFinite(value))
    && Math.abs(values[0]) < 1000
    && Math.abs(values[2]) < 1000
    && values[1] > -50
    && values[1] < 500;
}

function cameraStateSnapshot() {
  return {
    position: camera.position.toArray().map((value) => Number(value.toFixed(3))),
    target: controls.target.toArray().map((value) => Number(value.toFixed(3))),
  };
}

function readSavedCameraState() {
  if (!isCameraMemoryEnabled()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_CAMERA_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!saneVector(data?.position) || !saneVector(data?.target)) return null;
    return { position: data.position, target: data.target };
  } catch {
    return null;
  }
}

function applyCameraState(state) {
  const target = new THREE.Vector3().fromArray(state.target);
  const offset = new THREE.Vector3().fromArray(state.position).sub(target);
  if (offset.lengthSq() < 1e-6) {
    offset.copy(DEFAULT_CAMERA_POSITION).sub(DEFAULT_CAMERA_TARGET);
  }
  const distance = THREE.MathUtils.clamp(
    offset.length(),
    controls.minDistance,
    controls.maxDistance,
  );
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(offset.normalize(), distance);
  controls.update();
  lastSavedCameraState = JSON.stringify(cameraStateSnapshot());
  cameraStateRestored = true;
  render();
}

function saveCameraState(force = false) {
  if (window.__farmHandsResetting) return;
  if (!fieldBounds) return;
  if (!isCameraMemoryEnabled()) return;
  const snapshot = JSON.stringify(cameraStateSnapshot());
  if (!force && snapshot === lastSavedCameraState) return;
  lastSavedCameraState = snapshot;
  try {
    localStorage.setItem(STORAGE_CAMERA_KEY, snapshot);
  } catch {
    // Storage unavailable; the camera still moves, it just is not remembered.
  }
}

function setCameraMemoryEnabled(enabled) {
  try {
    if (enabled) {
      localStorage.removeItem(STORAGE_CAMERA_MEMORY_KEY);
    } else {
      localStorage.setItem(STORAGE_CAMERA_MEMORY_KEY, 'off');
      localStorage.removeItem(STORAGE_CAMERA_KEY);
    }
  } catch {
    // Ignore unavailable storage.
  }
  lastSavedCameraState = enabled ? '' : JSON.stringify(cameraStateSnapshot());
  if (enabled) saveCameraState(true);
}

function resetCameraToDefault() {
  homeTransition = null;
  // Reproduce the framing a fresh visit gets: the starting view direction at
  // the same fit-to-window distance the resize handler would choose.
  const direction = DEFAULT_CAMERA_POSITION.clone().sub(DEFAULT_CAMERA_TARGET);
  const startDistance = fittedDistance ?? direction.length();
  const distance = THREE.MathUtils.clamp(startDistance, controls.minDistance, controls.maxDistance);
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  camera.position.copy(DEFAULT_CAMERA_TARGET).addScaledVector(direction.normalize(), distance);
  controls.update();
  lastSavedCameraState = '';
  saveCameraState(true);
  render();
}

let homeTransition = null;

function isPlotFocusEnabled() {
  try {
    return localStorage.getItem(STORAGE_PLOT_FOCUS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setPlotFocusEnabled(enabled) {
  try {
    if (enabled) localStorage.removeItem(STORAGE_PLOT_FOCUS_KEY);
    else localStorage.setItem(STORAGE_PLOT_FOCUS_KEY, 'off');
  } catch {
    // The option still works for this visit if storage is unavailable.
  }
  plotFocusEnabled = Boolean(enabled);
}
let plotFocusEnabled = isPlotFocusEnabled();

function transitionCamera(target, position) {
  if (reducedMotion.matches) {
    controls.target.copy(target);
    camera.position.copy(position);
    controls.update();
    saveCameraState(true);
    render();
    return;
  }
  homeTransition = {
    start: performance.now(), duration: 1000,
    fromPosition: camera.position.clone(), fromTarget: controls.target.clone(),
    position, target,
  };
}

function focusFarmhouse() {
  closePlotActionMenu();
  const target = new THREE.Vector3(-5.8, groundHeight(-5.8, -5.1) + 1.1, -5.1);
  const position = target.clone().add(new THREE.Vector3(5.5, 5.2, 8));
  transitionCamera(target, position);
}

function focusPlot(index) {
  if (!plotFocusEnabled || !fieldBounds) return;
  const { x, z } = plotPositions[index];
  const target = new THREE.Vector3(x, groundHeight(x, z) + 0.25, z);
  const offset = camera.position.clone().sub(controls.target);
  const distance = THREE.MathUtils.clamp(offset.length(), 8.5, 12);
  const position = target.clone().addScaledVector(offset.normalize(), distance);
  transitionCamera(target, position);
}

document.querySelector('#home-btn')?.addEventListener('click', focusFarmhouse);
controls.addEventListener('start', () => { homeTransition = null; closePlotActionMenu(); });

function updateHomeTransition(now) {
  if (!homeTransition) return;
  const progress = THREE.MathUtils.clamp((now - homeTransition.start) / homeTransition.duration, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  controls.target.lerpVectors(homeTransition.fromTarget, homeTransition.target, eased);
  camera.position.lerpVectors(homeTransition.fromPosition, homeTransition.position, eased);
  controls.update();
  if (progress === 1) {
    homeTransition = null;
    saveCameraState(true);
  }
}

// Warm pastoral lighting
const ambientLight = new THREE.HemisphereLight(0xe8f4ff, 0x6e945c, 2.5);
scene.add(ambientLight);

const sunlight = new THREE.DirectionalLight(0xfff3d6, 3.4);
sunlight.position.set(-5, 12, 7);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
sunlight.shadow.camera.left = -11;
sunlight.shadow.camera.right = 11;
sunlight.shadow.camera.top = 11;
sunlight.shadow.camera.bottom = -11;
sunlight.shadow.normalBias = 0.025;
scene.add(sunlight);

// ==========================================================================
// SKY: SUN, SUNRISE/SUNSET, AND STARS
// --------------------------------------------------------------------------
// The directional light above lights the scene, but it has no visible disc.
// These billboarded sprites and points draw the sun itself, a warm horizon
// glow at dawn/dusk, and a starfield that fades in at night. They are unlit
// (SpriteMaterial/PointsMaterial) and ignore fog so they stay bright against
// the sky no matter the weather.
// ==========================================================================

function radialGlowTexture(innerColor, outerColor) {
  const size = 128;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const context = tile.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(0.28, innerColor);
  gradient.addColorStop(1, outerColor);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(tile);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const SUN_DISTANCE = 400;
const SKY_RADIUS = 380;

// Sun: a bright core wrapped in a warm halo.
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: radialGlowTexture('rgba(255, 246, 210, 0.95)', 'rgba(255, 190, 90, 0)'),
  color: 0xfff2c2,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  fog: false,
}));
sunGlow.scale.setScalar(96);
sunGlow.renderOrder = -10;
scene.add(sunGlow);

const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
  map: radialGlowTexture('rgba(255, 255, 255, 1)', 'rgba(255, 244, 200, 0)'),
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  fog: false,
}));
sunCore.scale.setScalar(24);
sunCore.renderOrder = -10;
scene.add(sunCore);

// A wide, soft warm band that hugs the horizon at sunrise and sunset.
const horizonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: radialGlowTexture('rgba(255, 160, 80, 0.9)', 'rgba(255, 120, 60, 0)'),
  color: 0xff9d5c,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  fog: false,
}));
horizonGlow.scale.set(230, 70, 1);
horizonGlow.renderOrder = -10;
scene.add(horizonGlow);

// Stars: a fixed dome of points above the horizon, revealed at night.
function makeStarTexture() {
  const size = 32;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const context = tile.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(tile);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const STAR_COUNT = 700;
const starPositions = new Float32Array(STAR_COUNT * 3);
const starColors = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i += 1) {
  const azimuth = Math.random() * Math.PI * 2;
  const elevation = Math.random() * Math.PI * 0.5 * 0.95;
  const y = Math.sin(elevation);
  const radius = Math.cos(elevation);
  starPositions[i * 3] = Math.cos(azimuth) * radius * SKY_RADIUS;
  starPositions[i * 3 + 1] = y * SKY_RADIUS + 6;
  starPositions[i * 3 + 2] = Math.sin(azimuth) * radius * SKY_RADIUS;
  const color = new THREE.Color();
  if (Math.random() < 0.8) {
    color.setHSL(0.58 + Math.random() * 0.1, 0.2 + Math.random() * 0.25, 0.62 + Math.random() * 0.38);
  } else {
    color.setHSL(0.08 + Math.random() * 0.05, 0.35, 0.7 + Math.random() * 0.3);
  }
  starColors[i * 3] = color.r;
  starColors[i * 3 + 1] = color.g;
  starColors[i * 3 + 2] = color.b;
}
const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
const starMaterial = new THREE.PointsMaterial({
  map: makeStarTexture(),
  size: 2.6 * Math.min(window.devicePixelRatio || 1, 2),
  sizeAttenuation: false,
  transparent: true,
  opacity: 0,
  vertexColors: true,
  depthWrite: false,
  fog: false,
});
const stars = new THREE.Points(starGeometry, starMaterial);
stars.renderOrder = -10;
scene.add(stars);

const SUN_HORIZON_COLOR = new THREE.Color(0xff8a3d);
const SUN_DAY_COLOR = new THREE.Color(0xfff4d2);
const SUN_CORE_LOW = new THREE.Color(0xffd9a0);
const SUN_CORE_DAY = new THREE.Color(0xfffef2);
const _sunGlowColor = new THREE.Color();
const _sunCoreColor = new THREE.Color();

function updateSkyObjects(sunX, sunY, sunZ) {
  const length = Math.hypot(sunX, sunY, sunZ) || 1;
  const dirX = sunX / length;
  const dirY = sunY / length;
  const dirZ = sunZ / length;

  // Sun disc — visible only above the horizon.
  const sunVisible = dirY > 0.03;
  sunGlow.visible = sunVisible;
  sunCore.visible = sunVisible;
  if (sunVisible) {
    sunGlow.position.set(dirX * SUN_DISTANCE, dirY * SUN_DISTANCE, dirZ * SUN_DISTANCE);
    sunCore.position.copy(sunGlow.position);

    const altitude = THREE.MathUtils.clamp(dirY, 0, 1);
    const opacity = THREE.MathUtils.clamp(altitude / 0.24, 0, 1);
    const warmth = THREE.MathUtils.clamp(1 - altitude / 0.55, 0, 1);
    sunGlow.material.opacity = opacity * 0.92;
    sunCore.material.opacity = opacity;
    _sunGlowColor.copy(SUN_HORIZON_COLOR).lerp(SUN_DAY_COLOR, 1 - warmth);
    _sunCoreColor.copy(SUN_CORE_LOW).lerp(SUN_CORE_DAY, 1 - warmth);
    sunGlow.material.color.copy(_sunGlowColor);
    sunCore.material.color.copy(_sunCoreColor);
  }

  // Warm horizon band — strongest right around sunrise and sunset.
  const horizon = THREE.MathUtils.clamp(1 - Math.abs(dirY) / 0.3, 0, 1);
  horizonGlow.visible = horizon > 0.02 && dirY > -0.4;
  if (horizonGlow.visible) {
    const horizonLength = Math.hypot(sunX, sunZ) || 1;
    horizonGlow.position.set((sunX / horizonLength) * SUN_DISTANCE, 0, (sunZ / horizonLength) * SUN_DISTANCE);
    horizonGlow.material.opacity = horizon * 0.55;
  }

  // Stars fade in once the sun has sunk below the horizon.
  starMaterial.opacity = THREE.MathUtils.clamp((-dirY - 0.03) / 0.22, 0, 1) * 0.95;
}

const material = (color, roughness = 1, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

const ridgeMaterial = material(0xa6744a);
const furrowMaterial = material(0x67432d);
const stemMaterial = material(0x4a8c54);
const leafMaterial = material(0x6fae63);
const headMaterial = material(0xd9b85c); // Warm golden wheat heads

function box(parent, width, height, depth, meshMaterial, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), meshMaterial);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Terrain feature placements (shared by the 3D scene and the farmhouse map).
const HILL = { x: 2, z: -9, height: 1.45, spread: 11 };
const RANCH = { minX: -11, maxX: 11, minZ: -11, maxZ: 11 };
const PINE_POSITIONS = [
  [-12.0, -7.0], [-11.5, -9.0], [-12.8, -8.6], [-10.6, -10.2], [-13.4, -5.8],
];
const ORCHARD_POSITIONS = [[-10.7, -7.4], [3.8, -5.6]];
const TREE_POSITIONS = [...PINE_POSITIONS.map(([x, z]) => ({ x, z, radius: 0.65 })), ...ORCHARD_POSITIONS.map(([x, z]) => ({ x, z, radius: 0.85 }))];
function cellBlockedByTree(x, z, halfWidth = CELL_SIZE / 2, halfDepth = CELL_SIZE / 2) {
  return TREE_POSITIONS.some((tree) => Math.hypot(tree.x - THREE.MathUtils.clamp(tree.x, x - halfWidth, x + halfWidth), tree.z - THREE.MathUtils.clamp(tree.z, z - halfDepth, z + halfDepth)) < tree.radius);
}
const ROCK_POSITIONS = [
  [-3.4, 3.2], [4.2, 3.6], [3.8, -3.2], [-3.8, -3.4],
  [7.3, 5.9], [9.6, 5.8], [8.2, 8.3], [10.3, 7.3],
];
const GARDEN_PATH_STEPS = [
  [-5.8, -3.9], [-5.2, -3.6], [-4.6, -3.2],
  [-3.9, -2.9], [-3.2, -2.6], [-2.5, -2.4], [-1.9, -2.2],
];

function groundHeight(x, z) {
  const distance = Math.hypot(x, z);
  const foothills = THREE.MathUtils.smoothstep(distance, 8, 32) * (
    0.28 * Math.sin(x * 0.085) * Math.cos(z * 0.07) +
    0.18 * Math.sin(x * 0.17 + z * 0.11) +
    0.13 * Math.cos(z * 0.14)
  );
  const hillDist = Math.hypot(x - HILL.x, z - HILL.z);
  const northernHill = HILL.height * Math.exp(-(hillDist * hillDist) / (2 * HILL.spread * HILL.spread));
  // Preserve a level clearing around the field while the northern hill rises beyond it.
  const farmClearing = THREE.MathUtils.smoothstep(distance, 5, 12);

  const angle = Math.atan2(z, x);
  const ridgeDistance = 105 + 12 * Math.sin(angle * 3 + 0.7) + 6 * Math.cos(angle * 7 - 0.4);
  const ridge = Math.exp(-(((distance - ridgeDistance) / 26) ** 2));
  const sharpPeaks = 3 * Math.max(0, Math.sin(angle * 10 + Math.sin(angle * 3))) ** 4;
  const peaks = 6 + 2 * Math.sin(x * 0.13 + z * 0.04) + 1.5 * Math.cos(z * 0.11 - x * 0.08) + sharpPeaks;
  const mountains = THREE.MathUtils.smoothstep(distance, 68, 95) * ridge * peaks;
  const natural = -0.18 + farmClearing * (foothills + northernHill) + mountains;
  // The house sits in a graded clearing, with a soft edge into the meadow.
  const houseDistance = Math.hypot(Math.max(0, Math.abs(x + 5.8) - 2.5), Math.max(0, Math.abs(z + 5.1) - 2.35));
  const graded = THREE.MathUtils.lerp(-0.18, natural, THREE.MathUtils.smoothstep(houseDistance, 0, 2));
  const savedOffset = terrainEdits.reduce((sum, edit) => {
    const radius = Math.hypot(x - edit.x, z - edit.z);
    return sum + edit.delta * Math.max(0, 1 - radius / (CELL_SIZE * 1.2));
  }, 0);
  const edit = temporaryTerrainEdit;
  const liveOffset = edit ? edit.delta * Math.max(0, 1 - Math.hypot(x - edit.x, z - edit.z) / (CELL_SIZE * 1.2)) : 0;
  return graded + savedOffset + liveOffset;
}

function grassTexture() {
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const context = tile.getContext('2d');
  context.fillStyle = '#f8faed';
  context.fillRect(0, 0, 128, 128);
  let seed = 19;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let index = 0; index < 190; index += 1) {
    const x = random() * 128;
    const y = random() * 128;
    context.fillStyle = random() > 0.25 ? 'rgba(100, 135, 78, 0.09)' : 'rgba(157, 133, 83, 0.07)';
    context.beginPath();
    context.ellipse(x, y, 1 + random() * 2, 1 + random() * 1.5, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(tile);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(85, 85);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

const terrainGeometry = new THREE.PlaneGeometry(600, 600, 240, 240);
terrainGeometry.rotateX(-Math.PI / 2);
const terrainPositions = terrainGeometry.attributes.position;
// The detailed ranch mesh owns the ground inside the boundary. Keep the
// coarse landscape underneath it, including where shovel edits dig downward.
function coarseTerrainHeight(x, z) {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const clearance = 1.0 * (1 - THREE.MathUtils.smoothstep(edge, 9, 13));
  return groundHeight(x, z) - clearance;
}
const terrainColors = [];
const grassLight = new THREE.Color(0x94c47b);
const grassShade = new THREE.Color(0x73a869);
const rockLight = new THREE.Color(0xa4aaa0);
const rockShade = new THREE.Color(0x737e78);
const snow = new THREE.Color(0xd5ddd5);
for (let index = 0; index < terrainPositions.count; index += 1) {
  const x = terrainPositions.getX(index);
  const z = terrainPositions.getZ(index);
  const height = groundHeight(x, z);
  terrainPositions.setY(index, coarseTerrainHeight(x, z));
  const variation = (Math.sin(x * 0.12 + z * 0.035) * Math.cos(z * 0.11) + 1) / 2;
  const color = grassShade.clone().lerp(grassLight, variation);
  color.lerp(rockShade.clone().lerp(rockLight, variation), THREE.MathUtils.smoothstep(height, 3, 11));
  color.lerp(snow, THREE.MathUtils.smoothstep(height, 17, 24) * 0.8);
  terrainColors.push(color.r, color.g, color.b);
}
terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
terrainGeometry.computeVertexNormals();
const terrain = new THREE.Mesh(
  terrainGeometry,
  new THREE.MeshStandardMaterial({ map: grassTexture(), vertexColors: true, roughness: 1 }),
);
terrain.receiveShadow = true;
scene.add(terrain);

// Finer geometry over owned land lets shovel jobs visibly change the ground.
const ranchGeometry = new THREE.PlaneGeometry(22, 22, 88, 88);
ranchGeometry.rotateX(-Math.PI / 2);
const ranchPositions = ranchGeometry.attributes.position;
const ranchColors = [];
for (let index = 0; index < ranchPositions.count; index += 1) {
  const x = ranchPositions.getX(index), z = ranchPositions.getZ(index);
  ranchPositions.setY(index, groundHeight(x, z) + 0.035);
  const shade = (Math.sin(x * 0.12 + z * 0.035) * Math.cos(z * 0.11) + 1) / 2;
  const color = grassShade.clone().lerp(grassLight, shade);
  ranchColors.push(color.r, color.g, color.b);
}
ranchGeometry.setAttribute('color', new THREE.Float32BufferAttribute(ranchColors, 3));
ranchGeometry.computeVertexNormals();
const ranchGround = new THREE.Mesh(ranchGeometry, terrain.material);
ranchGround.receiveShadow = true;
scene.add(ranchGround);
function refreshRanchTerrain() {
  for (let index = 0; index < ranchPositions.count; index += 1) ranchPositions.setY(index, groundHeight(ranchPositions.getX(index), ranchPositions.getZ(index)) + 0.035);
  ranchPositions.needsUpdate = true;
  ranchGeometry.computeVertexNormals();
}
const dirtMound = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.48, 9), new THREE.MeshStandardMaterial({ color: 0x98704b, roughness: 1 }));
dirtMound.castShadow = true;
dirtMound.receiveShadow = true;
dirtMound.visible = false;
scene.add(dirtMound);
const dirtMoundLabel = document.querySelector('#dirt-mound-label');
function dirtMoundPoint() {
  if (!fieldBounds) return null;
  const x = fieldBounds.maxX + 1.05 < RANCH.maxX ? fieldBounds.maxX + 1.05 : fieldBounds.minX - 1.05;
  return { x, z: (fieldBounds.minZ + fieldBounds.maxZ) / 2 };
}
function updateDirtMound() {
  const point = dirtMoundPoint();
  const work = cleanupWork;
  const progress = work?.kind === 'high' || work?.kind === 'low' ? Math.max(0, Math.min(1, (performance.now() - work.started - (work.fetchShovel ? 4300 : 2400)) / (work.duration - (work.fetchShovel ? 4300 : 2400)))) : 0;
  const amount = (cleanup?.dirt ?? 0) + (work?.kind === 'high' ? progress : work?.kind === 'low' ? -progress : 0);
  dirtMound.visible = Boolean(point && amount > 0.025);
  if (dirtMoundLabel) dirtMoundLabel.hidden = !dirtMound.visible;
  if (!dirtMound.visible) return;
  dirtMound.position.set(point.x, groundHeight(point.x, point.z) + 0.12 + amount * 0.08, point.z);
  dirtMound.scale.setScalar(0.45 + amount * 0.25);
  if (dirtMoundLabel) {
    dirtMoundLabel.textContent = `Soil nearby: ${amount.toFixed(1)}`;
    const projected = dirtMound.position.clone().add(new THREE.Vector3(0, 0.55, 0)).project(camera);
    const rect = canvas.getBoundingClientRect();
    dirtMoundLabel.style.left = `${(projected.x + 1) * rect.width / 2}px`;
    dirtMoundLabel.style.top = `${(1 - projected.y) * rect.height / 2}px`;
  }
}
function spreadExcessDirt() {
  if (!cleanup || cleanup.dirt <= 0 || !cleanupReady()) return;
  const point = dirtMoundPoint();
  if (point) terrainEdits.push({ ...point, delta: Math.min(0.45, cleanup.dirt * 0.12) });
  cleanup.dirt = 0;
  refreshRanchTerrain();
  status.textContent = 'John spread the extra soil into the nearby ground.';
}

function dottedRectangle(bounds, color = 0xf5e2a7, step = 0.32) {
  const points = [];
  const edge = (ax, az, bx, bz) => {
    const length = Math.hypot(bx - ax, bz - az);
    for (let distance = 0; distance < length; distance += step * 2) {
      const end = Math.min(length, distance + step);
      for (const d of [distance, end]) {
        const x = ax + (bx - ax) * d / length;
        const z = az + (bz - az) * d / length;
        points.push(new THREE.Vector3(x, groundHeight(x, z) + 0.12, z));
      }
    }
  };
  edge(bounds.minX, bounds.minZ, bounds.maxX, bounds.minZ);
  edge(bounds.maxX, bounds.minZ, bounds.maxX, bounds.maxZ);
  edge(bounds.maxX, bounds.maxZ, bounds.minX, bounds.maxZ);
  edge(bounds.minX, bounds.maxZ, bounds.minX, bounds.minZ);
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false }));
  scene.add(line);
  return line;
}
const ranchBorder = dottedRectangle(RANCH, 0xf3df9e, 0.4);
let fieldBorder = null;
let fieldGrid = null;

// A narrow dirt lane leaves the farmhouse and crosses the ranch boundary.
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x9a7950, roughness: 1, side: THREE.DoubleSide });
const TOWN_Z = 52;
const roadCenter = (z) => z < 8 ? -5.8 : -5.8 - Math.min(4.6, (z - 8) * 0.38);
const roadVertices = [];
for (let z = -3.85; z < TOWN_Z; z += 0.25) {
  const nextZ = Math.min(TOWN_Z, z + 0.25);
  const edge = (atZ, side) => {
    const slope = (roadCenter(atZ + 0.1) - roadCenter(atZ - 0.1)) / 0.2;
    const offset = side * 0.72 / Math.hypot(1, slope);
    const x = roadCenter(atZ) + offset;
    return [x, groundHeight(x, atZ) + 0.07, atZ - offset * slope];
  };
  const left = edge(z, -1), right = edge(z, 1), nextLeft = edge(nextZ, -1), nextRight = edge(nextZ, 1);
  roadVertices.push(...left, ...right, ...nextLeft, ...right, ...nextRight, ...nextLeft);
}
const roadGeometry = new THREE.BufferGeometry();
roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
roadGeometry.computeVertexNormals();
const road = new THREE.Mesh(roadGeometry, roadMaterial);
road.receiveShadow = true;
scene.add(road);
const glowMaterials = [];

function townSign(label, width = 3.2) {
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512;
  signCanvas.height = 128;
  const ctx = signCanvas.getContext('2d');
  ctx.fillStyle = '#f3dca8';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#714b2f';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#4d3525';
  ctx.font = 'bold 55px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 67);
  const texture = new THREE.CanvasTexture(signCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  sign.rotation.y = Math.PI;
  return sign;
}

function addTown() {
  const centerX = roadCenter(TOWN_Z);
  const stone = material(0xb8aa8b), trim = material(0xf2dfb8), timber = material(0x76503a);
  const litGlass = new THREE.MeshStandardMaterial({ color: 0xffd995, emissive: 0xc77b35, emissiveIntensity: 0.32, roughness: 0.22 });
  glowMaterials.push(litGlass);
  const roofPanel = (building, halfWidth, depth, y, color) => {
    const tiles = material(color);
    for (const side of [-1, 1]) {
      const panel = box(building, halfWidth + 0.28, 0.16, depth + 0.45, tiles, side * halfWidth / 2, y + 0.38, 0);
      panel.rotation.z = -side * 0.43;
      for (let row = -1; row <= 1; row += 1) box(panel, 0.035, 0.02, depth / 5, material(0xffffff), 0, 0.09, row * depth / 3);
    }
  };

  const hall = new THREE.Group();
  hall.position.set(centerX - 4.8, groundHeight(centerX - 4.8, TOWN_Z), TOWN_Z);
  box(hall, 7.1, 0.35, 5.2, stone, 0, 0.13, 0);
  box(hall, 5.9, 2.75, 4.3, material(0xdfcda6), 0, 1.65, 0);
  for (const y of [0.43, 2.98]) box(hall, 6.2, 0.16, 4.56, trim, 0, y, 0);
  roofPanel(hall, 3.05, 4.4, 3.28, 0x895b46);
  box(hall, 2.95, 0.23, 1.3, stone, 0, 0.15, -2.75);
  for (const x of [-1.85, 1.85]) {
    box(hall, 0.19, 2.35, 0.19, trim, x, 1.62, -2.44);
    box(hall, 0.36, 0.16, 0.36, stone, x, 2.85, -2.44);
    box(hall, 0.95, 1.2, 0.07, timber, x, 1.75, -2.18);
    box(hall, 0.77, 1.02, 0.08, litGlass, x, 1.79, -2.23);
    box(hall, 0.07, 1.1, 0.1, trim, x, 1.8, -2.31);
  }
  box(hall, 1.3, 1.95, 0.14, timber, 0, 1.24, -2.25);
  box(hall, 0.08, 0.08, 0.08, material(0xe3b45b), 0.46, 1.25, -2.35);
  for (const side of [-1,1]) for (const z of [-1.05,0.95]) {
    box(hall,0.08,1.24,0.89,timber,side*2.99,1.76,z);
    box(hall,0.09,1.04,0.69,litGlass,side*3.04,1.76,z);
    box(hall,0.1,0.08,0.94,trim,side*3.06,1.13,z);
  }
  box(hall, 1.55, 1.25, 1.36, trim, 0, 3.7, 0);
  box(hall, 1.72, 0.18, 1.52, stone, 0, 4.38, 0);
  const hallClock = new THREE.Mesh(new THREE.CylinderGeometry(0.37,0.37,0.08,18),material(0xf8edce));
  hallClock.rotation.x = Math.PI / 2; hallClock.position.set(0,3.84,-0.73); hall.add(hallClock);
  box(hall, 0.04, 0.26, 0.03, timber, 0, 3.86, -0.79);
  const hallSign = townSign('TOWN HALL', 2.5); hallSign.position.set(0,2.69,-2.29); hall.add(hallSign);
  hall.traverse((item) => { if (item.isMesh) item.castShadow = true; });
  scene.add(hall);

  const science = new THREE.Group();
  const scienceX = centerX + 5.2;
  science.position.set(scienceX, groundHeight(scienceX, TOWN_Z), TOWN_Z);
  box(science, 4.7, 0.32, 4.15, stone, 0, 0.12, 0);
  box(science, 4.14, 2.58, 3.52, material(0xd6dfc9), 0, 1.55, 0);
  for (const x of [-1.86,1.86]) box(science, 0.24, 2.55, 3.56, material(0x78928a), x, 1.57, 0);
  box(science, 4.3, 0.17, 3.72, trim, 0, 2.91, 0);
  roofPanel(science, 2.22, 3.6, 3.22, 0x4b7778);
  box(science, 1.12, 1.89, 0.11, timber, 0, 1.09, -1.82);
  box(science, 0.74, 0.92, 0.04, litGlass, 0, 1.68, -1.9);
  for (const x of [-1.23,1.23]) {
    box(science, 0.82, 1.17, 0.07, timber, x, 1.58, -1.82);
    box(science, 0.65, 1.0, 0.08, litGlass, x, 1.59, -1.87);
    box(science, 0.08, 1.07, 0.09, trim, x, 1.59, -1.94);
    box(science, 0.73, 0.07, 0.12, trim, x, 1.55, -1.96);
  }
  for (const side of [-1,1]) box(science,0.09,1.03,0.95,litGlass,side*2.13,1.68,0.28);
  box(science, 2.2, 0.15, 0.95, material(0x4b7778), 0, 2.23, -2.08);
  const labSign = townSign('SCIENCE CENTER', 2.75); labSign.position.set(0,2.59,-2.0); science.add(labSign);
  box(science, 0.42, 0.82, 0.42, material(0x729290), 1.2, 3.72, 0.4);
  box(science, 0.6, 0.09, 0.6, stone, 1.2, 4.18, 0.4);
  science.traverse((item) => { if (item.isMesh) item.castShadow = true; });
  scene.add(science);

  const spurZ = TOWN_Z - 3.4;
  const spurStart = roadCenter(spurZ), spurEnd = centerX + 3.2;
  const spurVertices = [];
  for (let x = spurStart - 0.6; x < spurEnd + 0.6; x += 0.25) {
    const end = Math.min(spurEnd + 0.6,x + 0.25);
    const edge = (atX,side) => [atX,groundHeight(atX,spurZ + side * 0.8) + 0.075,spurZ + side * 0.8];
    spurVertices.push(...edge(x,-1),...edge(x,1),...edge(end,-1),...edge(x,1),...edge(end,1),...edge(end,-1));
  }
  const spurGeometry = new THREE.BufferGeometry();
  spurGeometry.setAttribute('position',new THREE.Float32BufferAttribute(spurVertices,3));
  spurGeometry.computeVertexNormals();
  const spur = new THREE.Mesh(spurGeometry,roadMaterial);
  spur.receiveShadow = true;
  scene.add(spur);
  box(scene, 0.95, 0.42, 0.82, stone, centerX + 3.2, groundHeight(centerX + 3.2, spurZ) + 0.1, spurZ + 1.27);
}
addTown();

const car = new THREE.Group();
const carPaint = material(0x8e5541, 0.55, 0.15);
const carTrim = material(0x4d4538);
const carGlass = material(0x9fc5be, 0.3, 0.12);
const carFrontWheels = [], carWheelMeshes = [];
box(car, 1.48, 0.42, 2.4, carPaint, 0, 0.42, 0);
box(car, 1.13, 0.55, 1.14, carPaint, 0, 0.91, -0.16);
box(car, 1.05, 0.39, 0.06, carGlass, 0, 0.94, 0.43);
box(car, 1.05, 0.36, 0.06, carGlass, 0, 0.94, -0.75);
for (const x of [-0.77, 0.77]) for (const z of [-0.75, 0.75]) {
  const pivot = new THREE.Group();
  pivot.position.set(x,0.26,z);
  car.add(pivot);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.13, 12), carTrim);
  wheel.rotation.z = Math.PI / 2;
  pivot.add(wheel);
  carWheelMeshes.push(wheel);
  if (z > 0) carFrontWheels.push(pivot);
}
for (const x of [-0.46, 0.46]) box(car, 0.22, 0.12, 0.05, material(0xffdd91), x, 0.44, 1.23);
const PARKED_CAR = { x: -9.2, z: -3.15 };
const LAB_PARK = { x: roadCenter(TOWN_Z) + 3.2, z: TOWN_Z - 3.4 };
car.position.set(PARKED_CAR.x, groundHeight(PARKED_CAR.x, PARKED_CAR.z) + 0.12, PARKED_CAR.z);
car.rotation.y = Math.atan2(roadCenter(-1.8) - PARKED_CAR.x, -1.8 - PARKED_CAR.z);
const drivewayVertices = [];
for (let i = 0; i < 10; i += 1) {
  const a = i / 10, b = (i + 1) / 10;
  const point = (t, side) => { const x = PARKED_CAR.x + (roadCenter(-1.8) - PARKED_CAR.x) * t; const z = PARKED_CAR.z + 1.35 * t + side * 0.67; return [x, groundHeight(x, z) + 0.055, z]; };
  drivewayVertices.push(...point(a,-1),...point(a,1),...point(b,-1),...point(a,1),...point(b,1),...point(b,-1));
}
const drivewayGeometry = new THREE.BufferGeometry();
drivewayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(drivewayVertices,3));
drivewayGeometry.computeVertexNormals();
scene.add(new THREE.Mesh(drivewayGeometry, roadMaterial));
car.traverse((child) => { if (child.isMesh) child.castShadow = true; });
scene.add(car);

const mailbox = new THREE.Group();
const MAILBOX_X = -3.1;
const MAILBOX_Z = -2.05;
mailbox.position.set(MAILBOX_X, groundHeight(MAILBOX_X, MAILBOX_Z), MAILBOX_Z);
box(mailbox, 0.12, 1.04, 0.12, material(0x795537), 0, 0.54, 0);
box(mailbox, 0.62, 0.38, 0.85, material(0x54735c), 0, 1.16, 0);
box(mailbox, 0.65, 0.06, 0.9, material(0x304d3f), 0, 1.4, 0);
box(mailbox, 0.08, 0.35, 0.25, material(0xb46343), 0.35, 1.4, 0);
const mailboxFlag = mailbox.children.at(-1);
const mailboxHitbox = new THREE.Mesh(new THREE.BoxGeometry(1, 1.7, 1.1), new THREE.MeshBasicMaterial({ visible: false }));
mailboxHitbox.position.set(MAILBOX_X, groundHeight(MAILBOX_X, MAILBOX_Z) + 0.9, MAILBOX_Z);
scene.add(mailbox, mailboxHitbox);

let grassSeed = 317;
const randomGrass = () => ((grassSeed = (grassSeed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ==========================================================================
// WILDFLOWERS (COZY PASTORAL MEADOW)
// ==========================================================================
function addWildflowers() {
  const flowerGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 6);
  const flowerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const flowerCount = 240;
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  const transform = new THREE.Object3D();

  const flowerPalette = [
    new THREE.Color(0xfff3a8), // Buttercup yellow
    new THREE.Color(0xffffff), // Daisy white
    new THREE.Color(0xf06856), // Red poppy
    new THREE.Color(0xaf8ce0), // Lavender
    new THREE.Color(0x6aa6f2), // Cornflower blue
    new THREE.Color(0xf2a444), // Marigold orange
  ];

  for (let index = 0; index < flowerCount; index += 1) {
    let x;
    let z;
    do {
      const angle = randomGrass() * Math.PI * 2;
      const radius = 4.2 + randomGrass() * 24;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
    } while (
      (x > -2.6 && x < 2.6 && z > -2.6 && z < 2.6) || // Avoid wheat plot
      (x > -7.8 && x < -3.8 && z > -7.2 && z < -3.2) // Avoid house
    );

    const y = groundHeight(x, z) + 0.16 + randomGrass() * 0.12;
    transform.position.set(x, y, z);
    transform.rotation.set((randomGrass() - 0.5) * 0.25, randomGrass() * Math.PI * 2, (randomGrass() - 0.5) * 0.25);
    const scale = 0.75 + randomGrass() * 0.65;
    transform.scale.set(scale, scale, scale);
    transform.updateMatrix();
    flowers.setMatrixAt(index, transform.matrix);

    const chosenColor = flowerPalette[Math.floor(randomGrass() * flowerPalette.length)];
    flowers.setColorAt(index, chosenColor);
  }
  flowers.instanceMatrix.needsUpdate = true;
  flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);
}
addWildflowers();

// ==========================================================================
// FARMHOUSE & CHIMNEY SMOKE
// ==========================================================================
const farmhouseGroup = new THREE.Group();
const chimneyPuffs = [];
const warmLightSources = [];
let houseHitbox;

function addWarmLight(parent, x, y, z, intensity, distance) {
  const light = new THREE.PointLight(0xffbd6b, 0, distance, 2);
  light.position.set(x, y, z);
  parent.add(light);
  warmLightSources.push({ light, intensity });
}

function addFarmhouse() {
  const house = farmhouseGroup;
  house.position.set(-5.8, -0.18, -5.1);
  scene.add(house);

  const foundation = material(0x9a886f);
  const siding = material(0xf7ecd5);      // Warm butter-cream siding
  const trim = material(0x6c4424);        // Warm rich timber trim
  const roof = material(0xa24d38);        // Terracotta tile roof
  const roofEdge = material(0x733425);
  const door = material(0x6b3f22);
  const warmGlass = new THREE.MeshStandardMaterial({
    color: 0xffe9a6,
    emissive: 0x8a5e18,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.1,
  });
  glowMaterials.push(warmGlass);

  box(house, 2.9, 0.5, 2.7, foundation, 0, 0.1, 0);
  box(house, 2.58, 1.82, 2.38, siding, 0, 1.07, 0);
  box(house, 2.72, 0.14, 2.52, trim, 0, 0.23, 0);
  box(house, 2.72, 0.12, 2.52, trim, 0, 1.98, 0);

  // Gable ends
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-1.29, 2.01);
  gableShape.lineTo(1.29, 2.01);
  gableShape.lineTo(0, 2.85);
  gableShape.closePath();
  const gableGeometry = new THREE.ShapeGeometry(gableShape);
  const gableMaterial = new THREE.MeshStandardMaterial({ color: 0xf7ecd5, roughness: 1, side: THREE.DoubleSide });
  for (const z of [-1.19, 1.19]) {
    const gable = new THREE.Mesh(gableGeometry, gableMaterial);
    gable.position.z = z;
    gable.castShadow = true;
    gable.receiveShadow = true;
    house.add(gable);
  }

  // Roof slopes & eaves
  for (const side of [-1, 1]) {
    const panel = box(house, 1.62, 0.14, 2.86, roof, side * 0.73, 2.45, 0);
    panel.rotation.z = side * -0.59;
    const fascia = box(house, 1.62, 0.1, 0.09, roofEdge, side * 0.73, 2.46, 1.43);
    fascia.rotation.z = side * -0.59;
    const fasciaBack = box(house, 1.62, 0.1, 0.09, roofEdge, side * 0.73, 2.46, -1.43);
    fasciaBack.rotation.z = side * -0.59;
  }

  // Stone Chimney
  const chimneyMat = material(0x736d65);
  box(house, 0.42, 1.05, 0.42, chimneyMat, -0.65, 2.85, -0.55);
  box(house, 0.54, 0.14, 0.54, foundation, -0.65, 3.38, -0.55);

  // Front Door & Steps
  box(house, 0.76, 1.34, 0.07, trim, 0, 0.9, 1.22);
  box(house, 0.62, 1.24, 0.08, door, 0, 0.84, 1.27);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), material(0xdfaf4a));
  knob.position.set(0.22, 0.84, 1.33);
  house.add(knob);
  box(house, 1.05, 0.34, 0.7, foundation, 0, 0.04, 1.53);

  // Front Porch Lantern
  const lanternBracket = box(house, 0.06, 0.15, 0.12, material(0x2d1f14), 0.46, 1.25, 1.25);
  const lanternLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffe285, emissive: 0xffaa2b, emissiveIntensity: 0.6, roughness: 0.3 })
  );
  lanternLight.position.set(0.46, 1.18, 1.31);
  house.add(lanternLight);
  glowMaterials.push(lanternLight.material);
  addWarmLight(house, 0.46, 1.13, 1.7, 8, 5.5);
  addWarmLight(house, -0.88, 1.25, 1.55, 3.5, 3.5);
  addWarmLight(house, 1.5, 1.25, -0.12, 3.5, 3.5);

  // Front windows
  for (const x of [-0.87, 0.87]) {
    box(house, 0.54, 0.68, 0.07, trim, x, 1.25, 1.23);
    box(house, 0.44, 0.56, 0.08, warmGlass, x, 1.25, 1.28);
    box(house, 0.05, 0.58, 0.09, trim, x, 1.25, 1.33);
    box(house, 0.48, 0.05, 0.09, trim, x, 1.25, 1.33);

  }

  // Side Windows
  for (const side of [-1, 1]) {
    const x = side * 1.32;
    box(house, 0.08, 0.78, 0.76, trim, x, 1.23, -0.12);
    box(house, 0.09, 0.67, 0.66, warmGlass, x + side * 0.05, 1.23, -0.12);
    box(house, 0.11, 0.7, 0.06, trim, x + side * 0.11, 1.23, -0.12);
  }

  // Generous invisible Click Hitbox for the farmhouse
  houseHitbox = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 4.0, 4.2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  houseHitbox.position.set(-5.8, groundHeight(-5.8, -5.1) + 1.8, -5.1);
  houseHitbox.userData.isFarmhouse = true;
  scene.add(houseHitbox);

  // Mark all child meshes for hover and raycasting
  house.traverse((child) => {
    if (child.isMesh) child.userData.isFarmhouse = true;
  });

  // Cozy Chimney Smoke Puffs
  const puffMat = new THREE.MeshLambertMaterial({
    color: 0xfaeedd,
    transparent: true,
    opacity: 0.55,
  });
  for (let i = 0; i < 5; i += 1) {
    const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 1), puffMat);
    puff.position.set(-0.65, 3.45 + i * 0.28, -0.55);
    puff.scale.setScalar(0.7 + i * 0.25);
    puff.userData = {
      baseY: 3.45,
      offset: i * 0.85,
      speed: 0.65,
    };
    house.add(puff);
    chimneyPuffs.push(puff);
  }
}
addFarmhouse();

// Farmer John is the on-screen farm hand. The player chooses work; John walks
// to the chosen plot and acts on it without direct character controls.
const farmerJohn = new THREE.Group();
const johnShirt = material(0x587b70);
const johnPants = material(0x544832);
const johnSkin = material(0xd7a674);
const johnHat = material(0x9e7143);
const johnTorso = box(farmerJohn, 0.52, 0.75, 0.32, johnShirt, 0, 1.02, 0);
const johnLeftLeg = box(farmerJohn, 0.19, 0.58, 0.22, johnPants, -0.15, 0.36, 0);
const johnRightLeg = box(farmerJohn, 0.19, 0.58, 0.22, johnPants, 0.15, 0.36, 0);
const johnHead = new THREE.Mesh(new THREE.SphereGeometry(0.29, 8, 6), johnSkin);
johnHead.position.y = 1.62;
johnHead.castShadow = true;
farmerJohn.add(johnHead);
const johnEyes = [];
for (const x of [-0.105, 0.105]) {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.027, 6, 4), material(0x382b22));
  eye.position.set(x, 1.67, 0.265);
  farmerJohn.add(eye);
  johnEyes.push(eye);
}
box(farmerJohn, 0.82, 0.08, 0.7, johnHat, 0, 1.9, 0);
box(farmerJohn, 0.48, 0.26, 0.48, johnHat, 0, 2.06, 0);
const johnLeftArm = box(farmerJohn, 0.17, 0.62, 0.2, johnShirt, -0.37, 1.02, 0);
const johnRightArm = box(farmerJohn, 0.17, 0.62, 0.2, johnShirt, 0.37, 1.02, 0);
const johnShovel = new THREE.Group();
box(johnShovel, 0.06, 1.04, 0.06, material(0x8b6036), 0, 0.16, 0);
box(johnShovel, 0.21, 0.28, 0.05, material(0x71766d, 0.8, 0.2), 0, -0.47, 0);
johnShovel.position.set(0.49, 0.81, 0.04);
johnShovel.visible = false;
farmerJohn.add(johnShovel);
const sampleBag = new THREE.Group();
const sampleCue = document.querySelector('#sample-cue');
const bagPlastic = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.29, 0.07), new THREE.MeshStandardMaterial({ color: 0xd3e1d4, transparent: true, opacity: 0.52, roughness: 0.18, side: THREE.DoubleSide }));
bagPlastic.position.y = -0.13;
sampleBag.add(bagPlastic);
box(sampleBag, 0.23, 0.035, 0.08, material(0xb5c8ba), 0, 0.025, 0);
const soilInBag = box(sampleBag, 0.19, 0.03, 0.05, material(0x5e3e25), 0, -0.24, 0);
sampleBag.position.set(-0.49, 0.95, 0.16);
sampleBag.visible = false;
farmerJohn.add(sampleBag);
const handSoil = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), material(0x5c3b22));
handSoil.position.set(0.43, 0.64, 0.24);
handSoil.visible = false;
farmerJohn.add(handSoil);
farmerJohn.position.set(-5.15, groundHeight(-5.15, -3.05), -3.05);
scene.add(farmerJohn);
let johnTravel = null;
let johnSleeping = false;
let sleepWakeAt = 0;
let sleepMorningAt = null;
let pendingJobs = [];

function sendJohnToPlot(index, duration) {
  const { x, z } = plotPositions[index];
  sendJohnToPoint(x - 0.48, z + 0.42, duration * 0.65);
}

function sendJohnToPoint(x, z, duration, reason = null) {
  johnTravel = { from: farmerJohn.position.clone(), to: new THREE.Vector3(x, groundHeight(x, z), z), started: performance.now(), duration, reason };
}

function updateFarmerJohn(now) {
  const walking = Boolean(johnTravel);
  if (walking && now - lastFootstep > 480) { playSound('work'); lastFootstep = now; }
  if (johnTravel) {
    const t = THREE.MathUtils.clamp((now - johnTravel.started) / johnTravel.duration, 0, 1);
    farmerJohn.position.lerpVectors(johnTravel.from, johnTravel.to, t);
    farmerJohn.rotation.y = Math.atan2(johnTravel.to.x - johnTravel.from.x, johnTravel.to.z - johnTravel.from.z);
    if (t >= 1) {
      if (johnTravel.reason === 'summoned') status.textContent = 'Farmer John reached the spot you chose.';
      if (johnTravel.reason === 'soil-sample') {
        scoopUntil = now + 1550;
        playSound('scoop');
      }
      johnTravel = null;
      saveGameProgress();
    }
  }
  const working = Boolean(cleanupWork || activeWork.size);
  const stride = Math.sin(now * 0.013);
  johnLeftLeg.rotation.x = walking ? stride * 0.62 : 0;
  johnRightLeg.rotation.x = walking ? -stride * 0.62 : 0;
  johnLeftArm.rotation.x = walking ? -stride * 0.56 : working ? Math.sin(now * 0.012) * 0.28 : Math.sin(now * 0.0018) * 0.035;
  johnRightArm.rotation.x = walking ? stride * 0.56 : working ? -Math.sin(now * 0.012) * 0.42 : -Math.sin(now * 0.0018) * 0.035;
  johnTorso.scale.y = 1 + Math.sin(now * 0.003) * 0.012;
  johnHead.rotation.z = Math.sin(now * 0.0013) * 0.035;
  if (scoopUntil > now) {
    const progress = 1 - (scoopUntil - now) / 1550;
    johnTorso.rotation.x = Math.sin(progress * Math.PI) * 0.55;
    johnRightArm.rotation.x = -0.6 + Math.sin(progress * Math.PI) * 1.2;
    handSoil.visible = progress > 0.28 && progress < 0.78;
    if (sampleCue) {
      const projected = farmerJohn.position.clone().add(new THREE.Vector3(0,2.5,0)).project(camera);
      const rect = canvas.getBoundingClientRect();
      sampleCue.hidden = false;
      sampleCue.style.left = `${Math.max(70,Math.min(rect.width - 70,(projected.x + 1) * rect.width / 2))}px`;
      sampleCue.style.top = `${Math.max(85,Math.min(rect.height - 80,(1 - projected.y) * rect.height / 2))}px`;
      document.querySelector('#sample-cue-text').textContent = progress < 0.64 ? 'Scooping soil' : 'Sealing sample bag';
      sampleCue.style.setProperty('--bag-fill',`${Math.round(progress * 70)}%`);
    }
  } else { johnTorso.rotation.x = 0; handSoil.visible = false; if (sampleCue) sampleCue.hidden = true; }
  const blink = Math.sin(now * 0.0021) > 0.997 ? 0.16 : 1;
  johnEyes.forEach((eye) => { eye.scale.y = blink; });
  if (!johnSleeping) farmerJohn.position.y = groundHeight(farmerJohn.position.x, farmerJohn.position.z) + (walking ? Math.abs(stride) * 0.07 : Math.sin(now * 0.002) * 0.012);
}

const soilJourneyHud = document.querySelector('#soil-journey-hud');
const soilJourneyTitle = document.querySelector('#soil-journey-title');
const soilJourneyStatus = document.querySelector('#soil-journey-status');
const soilJourneyAction = document.querySelector('#soil-journey-action');
const cropBook = document.querySelector('#crop-book');
const cropBookClose = document.querySelector('#crop-book-close');
const soilCoverageHud = document.querySelector('#soil-coverage');
const labProgressHud = document.querySelector('#lab-progress');
const soilPlanUndo = document.querySelector('#soil-plan-undo');
const drivePhone = document.querySelector('#drive-phone');
const driveMap = document.querySelector('#drive-map');
const mailboxModal = document.querySelector('#mailbox-modal');
const mailAlert = document.querySelector('#mail-alert');
const soundToggle = document.querySelector('#sound-toggle');
if (soundToggle) { soundToggle.checked = !soundMuted(); soundToggle.addEventListener('change', () => { setSoundMuted(!soundToggle.checked); if (soundToggle.checked) playSound('success'); }); }

function updateKnowledge() {
  const reportEl = document.querySelector('#journal-soil-report');
  if (!reportEl) return;
  if (!soilStudy.mailRead || !soilStudy.report) {
    reportEl.innerHTML = '<h4>Field soil report</h4><p>Collect samples after ground cleanup. Results arrive by mail from the town science center after one game day.</p>';
    return;
  }
  const date = soilStudy.reportDate ? new Date(soilStudy.reportDate).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }) : 'Undated';
  reportEl.innerHTML = `<h4>Science center soil report · ${date}</h4>${soilReportTableHtml()}`;
}

function soilWorkBlocked() { return soilStudy.mailRead && soilStudy.report && !soilReportStatus(soilStudy.report).workable; }

function soilReportTableHtml() {
  const analysis = soilReportStatus(soilStudy.report);
  const rows = analysis.results.map(({ label, unit, value, min, max, optimum, workable, ideal }) => `<tr class="${workable ? ideal ? 'soil-ideal' : 'soil-workable' : 'soil-blocked'}"><th scope="row">${label}</th><td>${label === 'pH' ? value.toFixed(1) : value} ${unit}</td><td>${min}–${max} ${unit}</td><td>${optimum} ${unit}</td></tr>`).join('');
  return `<p class="soil-verdict ${analysis.workable ? 'is-workable' : 'is-blocked'}">${analysis.workable ? 'Field cleared for work' : 'Field work paused · result outside the game limits'}</p><div class="soil-report-scroll"><table class="soil-report-table"><thead><tr><th>Measure</th><th>Result</th><th>Workable min–max</th><th>Winter wheat optimum</th></tr></thead><tbody>${rows}</tbody></table></div><p class="soil-report-note">Limits and optimums are Willow Creek game rules. Values are simulated soil readings in mg/kg except pH; real targets depend on the lab method and soil.</p>`;
}

function refreshSoilStudyHud() {
  if (!soilJourneyHud) return;
  updateKnowledge();
  updateCleanupHUD();
  soilJourneyHud.hidden = !fieldBounds || !cleanupReady() || (soilStudy.phase === 'received' && !soilWorkBlocked());
  mailAlert.hidden = soilStudy.phase !== 'mail-ready';
  drivePhone.hidden = !['driving-out', 'driving-back'].includes(soilStudy.phase);
  if (soilJourneyHud.hidden) return;
  const phase = soilStudy.phase;
  const messages = {
    'not-started': 'The cleared field needs a soil study. Plan where John will collect five samples.',
    planning: soilStudy.points.length === 5 ? (soilCoveragePercent(fieldBounds, soilStudy.points) === 100 ? 'The W represents the whole field. Begin sampling.' : 'Coverage is incomplete. Undo a point and move it toward the marked ring.') : `Choose point ${soilStudy.points.length + 1} of 5 on the ${soilStudy.points.length % 2 ? 'far' : 'near'} field edge, moving left to right.`,
    sampling: `John is scooping soil into a plastic sample bag (${soilStudy.sampleIndex}/5).`,
    'to-car': 'Samples collected. John is taking them to the car.',
    'driving-out': 'Drive to the science center. Follow the road guide at the lower right.',
    'lab-arrived': `You reached the science center. Testing costs ${SOIL_LAB_COST} coins.`,
    'ready-to-return': 'The lab has the sample. Drive John back to the farmhouse.',
    'driving-back': 'Drive home. The lab is already testing the soil.',
    processing: 'The science center is testing the soil. Results arrive by mail after one game day.',
    'mail-ready': 'The soil report has arrived. Click the farmhouse mailbox to read it.',
    received: 'A reading is outside the workable range. Field tasks are on hold; review the report in Knowledge.',
  };
  soilJourneyTitle.textContent = phase === 'mail-ready' ? 'You have mail' : soilWorkBlocked() ? 'Field on hold' : 'Soil study';
  soilJourneyStatus.textContent = messages[phase] ?? 'Preparing to collect soil samples.';
  const actions = { 'not-started': 'Plan sample points', planning: 'Begin sampling', 'lab-arrived': `Send sample · ${SOIL_LAB_COST} coins`, 'ready-to-return': 'Drive home', processing: 'Read wheat guide', 'mail-ready': 'Open mailbox', received: 'Review soil report' };
  soilJourneyAction.hidden = !actions[phase];
  soilJourneyAction.textContent = actions[phase] || '';
  soilJourneyAction.disabled = (phase === 'planning' && (soilStudy.points.length !== 5 || soilCoveragePercent(fieldBounds, soilStudy.points) < 100)) || (phase === 'lab-arrived' && coins < SOIL_LAB_COST);
  if (phase === 'lab-arrived') soilJourneyAction.title = coins < SOIL_LAB_COST ? `Need ${SOIL_LAB_COST - coins} more coins. Sell supplies in the farmhouse shop.` : `${SOIL_LAB_COST} coins will be taken when the bag is handed over.`;
  else soilJourneyAction.removeAttribute('title');
  soilPlanUndo.hidden = phase !== 'planning' || !soilStudy.points.length;
  soilCoverageHud.hidden = phase !== 'planning';
  if (phase === 'planning') {
    const coverage = soilCoveragePercent(fieldBounds, soilStudy.points);
    document.querySelector('#soil-coverage-label').textContent = `${coverage}% of field represented`;
    document.querySelector('#soil-coverage-fill').style.width = `${coverage}%`;
  }
  const testing = Number.isFinite(soilStudy.submittedAt) && !['mail-ready', 'received'].includes(phase);
  labProgressHud.hidden = !testing;
  if (testing) {
    const progress = Math.max(0, Math.min(100, Math.floor((getGameDate().getTime() - soilStudy.submittedAt) / SOIL_LAB_DAY_MS * 100)));
    document.querySelector('#lab-progress-label').textContent = `Science center test · ${progress}%`;
    document.querySelector('#lab-progress-fill').style.width = `${progress}%`;
  }
  mailboxFlag.rotation.z = phase === 'mail-ready' ? -0.65 : 0;
}

function showCropBook() {
  if (!cropBook) return;
  cropBook.hidden = false;
  playSound('book');
  cropBookClose?.focus({ preventScroll: true });
}

function readMailbox() {
  playSound('book');
  mailboxModal.hidden = false;
  const content = document.querySelector('#mailbox-content');
  if (soilStudy.phase !== 'mail-ready' && soilStudy.phase !== 'received') content.innerHTML = '<p>The mailbox is empty. Check again after the science center finishes its test.</p>';
  else if (soilStudy.phase === 'mail-ready') content.innerHTML = '<div class="mailbox-envelope"><strong>From Willow Creek Science Center</strong><br>To Farmer John</div><button id="mailbox-open-letter" type="button">Open soil report</button>';
  else content.innerHTML = reportMarkup();
  document.querySelector('#mailbox-close')?.focus({ preventScroll: true });
}

function reportMarkup() {
  const date = new Date(soilStudy.reportDate ?? getGameDate().getTime()).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
  return `<div class="mailbox-report"><p><strong>Soil analysis · ${date}</strong></p><p>Dear Farmer John, here are the simulated readings from your five-point field sample.</p>${soilReportTableHtml()}<p>Filed in Journal → Knowledge.</p></div>`;
}

function openSoilLetter() {
  if (soilStudy.phase === 'mail-ready') {
    soilStudy.phase = 'received';
    soilStudy.mailRead = true;
    soilStudy.reportDate ??= getGameDate().getTime();
    if (!soilWorkBlocked()) for (let index = 0; index < PLOT_COUNT; index += 1) {
      if (plotStates[index] === PLOT_STATE.CLEARED) { plotStates[index] = PLOT_STATE.TESTED; applyPlotVisual(index); }
    }
    status.textContent = soilWorkBlocked() ? 'Report filed in Knowledge. The field is on hold because a reading exceeds the game limits.' : 'Report read and filed in Knowledge. Cleared plots are ready to cultivate.';
    playSound('mail');
    updateFieldLedger();
    updateCanvasLabel();
    saveGameProgress();
  }
  refreshSoilStudyHud();
  document.querySelector('#mailbox-content').innerHTML = reportMarkup();
}

mailboxModal?.addEventListener('click', (event) => { if (event.target.id === 'mailbox-open-letter') openSoilLetter(); });
document.querySelector('#mailbox-close')?.addEventListener('click', () => { mailboxModal.hidden = true; canvas.focus({ preventScroll: true }); });
mailAlert?.addEventListener('click', readMailbox);

cropBookClose?.addEventListener('click', () => { cropBook.hidden = true; canvas.focus({ preventScroll: true }); });
document.querySelector('#crop-book-close-top')?.addEventListener('click', () => { cropBook.hidden = true; canvas.focus({ preventScroll: true }); });
document.addEventListener('farmhouse-modal-open', () => { if (cropBook) cropBook.hidden = true; });
window.addEventListener('farm-hands:menu-open', () => { if (cropBook) cropBook.hidden = true; driveKeys.clear(); touchDriveKeys.clear(); });
window.addEventListener('keydown', (event) => {
  if (!cropBook?.hidden && event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    cropBook.hidden = true;
    canvas.focus({ preventScroll: true });
  }
  if (!mailboxModal?.hidden && event.key === 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation(); mailboxModal.hidden = true; canvas.focus({ preventScroll: true });
  }
}, true);
let touchDriveStart = null;
driveMap?.addEventListener('pointerdown', (event) => {
  if (!carTrip) return;
  event.preventDefault();
  driveMap.setPointerCapture(event.pointerId);
  touchDriveStart = { x: event.clientX, y: event.clientY };
});
driveMap?.addEventListener('pointermove', (event) => {
  if (!touchDriveStart) return;
  touchDriveKeys.clear();
  const horizontal = event.clientX - touchDriveStart.x;
  const vertical = event.clientY - touchDriveStart.y;
  if (horizontal > 13) touchDriveKeys.add('right');
  if (horizontal < -13) touchDriveKeys.add('left');
  if (vertical < -13) touchDriveKeys.add('gas');
  if (vertical > 13) touchDriveKeys.add('brake');
});
const releaseTouchDrive = () => { touchDriveStart = null; touchDriveKeys.clear(); };
driveMap?.addEventListener('pointerup', releaseTouchDrive);
driveMap?.addEventListener('pointercancel', releaseTouchDrive);
driveMap?.addEventListener('lostpointercapture', releaseTouchDrive);
window.addEventListener('blur', () => { driveKeys.clear(); releaseTouchDrive(); });
document.addEventListener('click', (event) => { if (event.target.closest('button')) playSound('click'); }, true);
soilJourneyAction?.addEventListener('click', () => {
  if (soilStudy.phase === 'not-started') {
    soilStudy.phase = 'planning';
    soilStudy.points = [];
    updateCoverageOverlay();
    playSound('plan');
  } else if (soilStudy.phase === 'planning') {
    if (soilStudy.points.length !== 5 || soilCoveragePercent(fieldBounds, soilStudy.points) < 100) return;
    soilStudy.phase = 'sampling';
    soilStudy.sampleIndex = 0;
    clearCoverageOverlay();
    playSound('success');
  } else if (soilStudy.phase === 'lab-arrived') {
    if (coins < SOIL_LAB_COST) { status.textContent = `The test costs ${SOIL_LAB_COST} coins. Sell supplies in the farmhouse shop first.`; playSound('error'); return; }
    coins -= SOIL_LAB_COST;
    updateCoins();
    soilStudy.submittedAt = getGameDate().getTime();
    soilStudy.report = soilReportForField(fieldBounds);
    soilStudy.reportDate = soilStudy.submittedAt + SOIL_LAB_DAY_MS;
    soilStudy.phase = 'ready-to-return';
    status.textContent = `Paid ${SOIL_LAB_COST} coins for the soil test. Drive John home while the lab works.`;
    playSound('lab');
  } else if (soilStudy.phase === 'ready-to-return') {
    soilStudy.phase = 'driving-back';
    carTrip = { direction: 'back', ...(soilStudy.carPose ?? { x: LAB_PARK.x, z: LAB_PARK.z, heading: Math.PI / 2 }), speed: 0, steer: 0 };
    heldKeys.clear();
    playSound('engine');
  } else if (soilStudy.phase === 'processing') showCropBook();
  else if (soilStudy.phase === 'mail-ready') readMailbox();
  else if (soilStudy.phase === 'received' && soilWorkBlocked()) { window.FarmCalendar?.openFarmhouseMenu?.(); document.querySelector('#tab-knowledge')?.click(); }
  refreshSoilStudyHud();
  saveGameProgress();
});
soilPlanUndo?.addEventListener('click', () => { soilStudy.points.pop(); updateCoverageOverlay(); refreshSoilStudyHud(); playSound('book'); saveGameProgress(); });

function clearCoverageOverlay() { if (coverageOverlay) { scene.remove(coverageOverlay); coverageOverlay.traverse((item) => { item.geometry?.dispose(); item.material?.dispose(); }); coverageOverlay = null; } }

function updateCoverageOverlay() {
  clearCoverageOverlay();
  if (!fieldBounds || soilStudy.phase !== 'planning') return;
  const group = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = fieldBounds;
  const pieces = 18;
  const vertices = [], colors = [];
  for (let row = 0; row < pieces; row += 1) for (let col = 0; col < pieces; col += 1) {
    const x0 = minX + (maxX - minX) * col / pieces, x1 = minX + (maxX - minX) * (col + 1) / pieces;
    const z0 = minZ + (maxZ - minZ) * row / pieces, z1 = minZ + (maxZ - minZ) * (row + 1) / pieces;
    const value = soilCoverageAt(fieldBounds, soilStudy.points, (x0 + x1) / 2, (z0 + z1) / 2);
    const color = new THREE.Color().setRGB(0.84 - value * 0.55, 0.26 + value * 0.55, 0.16 + value * 0.13);
    for (const [x,z] of [[x0,z0],[x0,z1],[x1,z0],[x0,z1],[x1,z1],[x1,z0]]) { vertices.push(x, groundHeight(x,z) + 0.20, z); colors.push(color.r,color.g,color.b); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  group.add(mesh);
  const routePoints = soilStudy.points.map(({x,z}) => new THREE.Vector3(x,groundHeight(x,z)+0.27,z));
  if (routePoints.length > 1) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePoints), new THREE.LineBasicMaterial({ color: 0xfff0a8, depthTest: false })));
  for (const point of routePoints) { const marker = new THREE.Mesh(new THREE.SphereGeometry(0.14,8,6), new THREE.MeshBasicMaterial({ color: 0xfff0a8, depthTest: false })); marker.position.copy(point); group.add(marker); }
  if (soilStudy.points.length < 5) {
    const index = soilStudy.points.length;
    const x = minX + (maxX - minX) * index / 4;
    const z = index % 2 ? maxZ : minZ;
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.22,0.31,20), new THREE.MeshBasicMaterial({ color: 0xffe79a, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
    marker.rotation.x = -Math.PI / 2; marker.position.set(x,groundHeight(x,z)+0.3,z); group.add(marker);
  }
  coverageOverlay = group;
  scene.add(group);
}

function addSoilSamplePoint(raw) {
  const point = nextSoilSamplePoint(fieldBounds, soilStudy.points, raw);
  if (!point) { status.textContent = `Choose the highlighted ${soilStudy.points.length % 2 ? 'far' : 'near'} edge around the next quarter of the field.`; playSound('error'); return; }
  soilStudy.points.push(point);
  updateCoverageOverlay();
  refreshSoilStudyHud();
  status.textContent = soilStudy.points.length === 5 ? 'All points marked. Start sampling when the coverage meter is full.' : `Point ${soilStudy.points.length} marked. Choose the opposite edge next.`;
  playSound('plan');
  saveGameProgress();
}

// Translate saves from the former route-bound driving system to a road position.
function carRoutePoint(progress) {
  const along = THREE.MathUtils.clamp(progress, 0, 1);
  if (along < 0.07) {
    const t = along / 0.07;
    return { x: PARKED_CAR.x + (roadCenter(-1.8) - PARKED_CAR.x) * t, z: PARKED_CAR.z + (1.35 * t) };
  }
  if (along < 0.9) {
    const z = -1.8 + (TOWN_Z - 3.4 + 1.8) * (along - 0.07) / 0.83;
    return { x: roadCenter(z), z, turn: false };
  }
  const branch = (along - 0.9) / 0.1;
  return { x: roadCenter(TOWN_Z) + 3.2 * branch, z: TOWN_Z - 3.4, turn: true };
}

function drawDriveMap(pose) {
  const ctx = driveMap?.getContext('2d');
  if (!ctx) return;
  const project = (x,z) => ({ x: 9 + (x + 19) / 19 * 200, y: 224 - (z + 5) / 60 * 214 });
  const width = driveMap.width, height = driveMap.height;
  ctx.fillStyle = '#dbe9ce'; ctx.fillRect(0,0,width,height);
  ctx.fillStyle = '#c9ddb9';
  for (let z = -5; z < TOWN_Z; z += 8) for (let x = -20; x < 0; x += 7) {
    const point = project(x,z);
    ctx.fillRect(point.x,point.y,13,9);
  }
  const strokePath = (points, width, color) => {
    ctx.beginPath(); ctx.moveTo(points[0].x,points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x,point.y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  };
  const roadPoints = [];
  for (let z = -3.85; z <= TOWN_Z; z += 0.5) roadPoints.push(project(roadCenter(z),z));
  roadPoints.push(project(roadCenter(TOWN_Z),TOWN_Z));
  const driveway = [project(PARKED_CAR.x,PARKED_CAR.z), project(roadCenter(-1.8),-1.8)];
  const spur = [project(roadCenter(TOWN_Z - 3.4),TOWN_Z - 3.4),project(LAB_PARK.x,LAB_PARK.z)];
  for (const points of [roadPoints,driveway,spur]) { strokePath(points,10,'#bca47e'); strokePath(points,6,'#efe4c9'); }
  const destination = carTrip?.direction === 'back' ? PARKED_CAR : LAB_PARK;
  const marker = project(destination.x,destination.z);
  ctx.fillStyle = '#dd774c'; ctx.beginPath(); ctx.arc(marker.x,marker.y,6,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  const carPoint = project(pose.x,pose.z);
  ctx.save(); ctx.translate(carPoint.x,carPoint.y); ctx.rotate(pose.heading);
  ctx.fillStyle = '#246d91'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,-10); ctx.lineTo(-7,7); ctx.lineTo(0,4); ctx.lineTo(7,7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#38554c'; ctx.font = 'bold 10px sans-serif';
  ctx.fillText('FARM',12,231); ctx.fillText('TOWN HALL',8,19); ctx.fillText('LAB',155,19);
}

function updateDriving(now, deltaSeconds) {
  if (!['driving-out', 'driving-back'].includes(soilStudy.phase)) return;
  if (pauseMenuIsOpen() || document.querySelector('#farmhouse-modal')?.hidden === false) return;
  if (!carTrip) {
    const direction = soilStudy.phase === 'driving-out' ? 'out' : 'back';
    const initial = direction === 'out' ? PARKED_CAR : LAB_PARK;
    carTrip = { direction, x: initial.x, z: initial.z, heading: direction === 'out' ? 0.6 : Math.PI / 2, speed: 0, steer: 0, ...soilStudy.carPose };
  }
  const held = (key) => driveKeys.has(key) || touchDriveKeys.has(key);
  const onRoad = distanceToRoad(carTrip.x,carTrip.z,roadCenter,TOWN_Z,PARKED_CAR) < 1.1;
  const previous = carTrip;
  let next = advanceCar(carTrip,{ gas: held('gas'), brake: held('brake'), left: held('left'), right: held('right') },deltaSeconds,onRoad);
  next.x = THREE.MathUtils.clamp(next.x,-43,18);
  next.z = THREE.MathUtils.clamp(next.z,-11,59);
  const insideBuilding = (x,z) => (x > roadCenter(TOWN_Z)-8.5 && x < roadCenter(TOWN_Z)-1.1 && z > TOWN_Z-2.75 && z < TOWN_Z+2.9)
    || (x > roadCenter(TOWN_Z)+2.75 && x < roadCenter(TOWN_Z)+7.7 && z > TOWN_Z-2.15 && z < TOWN_Z+2.4)
    || (x > -9.2 && x < -2.4 && z > -7.75 && z < -3.85);
  if (insideBuilding(next.x,next.z)) { next = { ...previous, speed: 0, steer: next.steer }; if (Math.abs(previous.speed) > 0.8) playSound('brake'); }
  carTrip = next;
  soilStudy.carPose = { x: next.x, z: next.z, heading: next.heading, speed: next.speed, steer: next.steer };
  car.position.set(next.x,groundHeight(next.x,next.z)+0.12,next.z);
  car.rotation.y = next.heading;
  for (const wheel of carFrontWheels) wheel.rotation.y = next.steer * 0.55;
  for (const wheel of carWheelMeshes) wheel.rotation.x += next.speed * deltaSeconds / 0.17;
  const target = new THREE.Vector3(next.x,groundHeight(next.x,next.z)+0.9,next.z);
  const behind = new THREE.Vector3(-Math.sin(next.heading)*7,5.1,-Math.cos(next.heading)*7);
  controls.target.lerp(target,0.1);
  camera.position.lerp(target.clone().add(behind),0.1);
  controls.update();
  const destination = next.direction === 'out' ? LAB_PARK : PARKED_CAR;
  const remaining = Math.hypot(destination.x-next.x,destination.z-next.z);
  const roadDistance = distanceToRoad(next.x,next.z,roadCenter,TOWN_Z,PARKED_CAR);
  document.querySelector('#drive-distance').textContent = `${Math.ceil(remaining*12)} m`;
  document.querySelector('#drive-speed').textContent = `${Math.round(Math.abs(next.speed)*2.2)} mph`;
  document.querySelector('#drive-direction').textContent = remaining < 2.2 ? 'Stop at the marker' : roadDistance > 2 ? 'Return to the road' : next.direction === 'out' ? (next.z > TOWN_Z-7 ? 'Turn right to the lab' : 'Follow road to town') : (next.z < 1 ? 'Park beside farmhouse' : next.z > TOWN_Z-6 ? (next.x > roadCenter(TOWN_Z)+1.2 ? 'Reverse to main road' : 'Turn toward farmhouse') : 'Follow road home');
  drawDriveMap(next);
  if (held('gas') && now - lastEngineNote > 540) { playSound('engine'); lastEngineNote = now; }
  if (remaining < 2.2 && Math.abs(next.speed) < 1.4) {
    driveKeys.clear(); touchDriveKeys.clear(); carTrip = null;
    soilStudy.carPose.speed = 0; soilStudy.carPose.steer = 0;
    if (next.direction === 'out') { soilStudy.phase = 'lab-arrived'; status.textContent = 'Parked at the science center. Send the sample to the lab.'; }
    else {
      soilStudy.phase = soilReportDue(soilStudy.submittedAt,getGameDate().getTime()) ? 'mail-ready' : 'processing';
      farmerJohn.visible = true;
      farmerJohn.position.set(next.x + 1, groundHeight(next.x + 1,next.z),next.z);
      focusFarmhouse();
      status.textContent = 'John is home. Read the field guide while the lab runs the test.';
      if (!soilStudy.bookOpened) { soilStudy.bookOpened = true; showCropBook(); }
    }
    playSound('success'); refreshSoilStudyHud(); saveGameProgress();
  }
}

function updateSoilStudy(now, deltaSeconds) {
  if (!fieldBounds || !cleanupReady()) return;
  if (soilStudy.phase === 'planning' && !coverageOverlay) updateCoverageOverlay();
  if (soilStudy.phase === 'sampling' && !johnSleeping && !johnTravel) {
    if (scoopUntil > now) return;
    if (scoopUntil) {
      scoopUntil = 0;
      soilStudy.sampleIndex += 1;
      energy = Math.max(0,energy - 1); updateEnergy();
      const fillHeight = 0.03 + soilStudy.sampleIndex * 0.03;
      soilInBag.scale.y = fillHeight / 0.03;
      soilInBag.position.y = -0.27 + fillHeight / 2;
      sampleBag.visible = true;
      playSound('bag');
      status.textContent = `John sealed soil sample ${soilStudy.sampleIndex} of 5 in the bag.`;
      refreshSoilStudyHud(); saveGameProgress();
    }
    const route = soilStudy.points.length === 5 ? soilStudy.points : soilSampleRoute(fieldBounds);
    if (soilStudy.sampleIndex < route.length) {
      const point = route[soilStudy.sampleIndex];
      const distance = Math.hypot(point.x - farmerJohn.position.x, point.z - farmerJohn.position.z);
      sendJohnToPoint(point.x, point.z, THREE.MathUtils.clamp(distance * 460, 950, 3300), 'soil-sample');
    } else {
      soilStudy.phase = 'to-car';
      sendJohnToPoint(car.position.x + 0.9, car.position.z, 2200, 'board-car');
      status.textContent = 'Samples collected. John is walking to the car beside the house.';
      refreshSoilStudyHud();
      saveGameProgress();
    }
  }
  if (soilStudy.phase === 'to-car' && !johnSleeping && !johnTravel) {
    const boardingX = car.position.x + 0.9;
    if (Math.hypot(farmerJohn.position.x - boardingX, farmerJohn.position.z - car.position.z) > 0.25) {
      sendJohnToPoint(boardingX, car.position.z, 2200, 'board-car');
    } else {
      soilStudy.phase = 'driving-out';
      farmerJohn.visible = false;
      carTrip = { direction: 'out', x: car.position.x, z: car.position.z, heading: car.rotation.y, speed: 0, steer: 0 };
      soilStudy.carPose = { x: carTrip.x, z: carTrip.z, heading: carTrip.heading, speed: 0, steer: 0 };
      heldKeys.clear();
      status.textContent = 'You are driving. W accelerates, S brakes or reverses, and A/D steer toward the science center.';
      playSound('engine');
      refreshSoilStudyHud();
      saveGameProgress();
    }
  }
  updateDriving(now,deltaSeconds);
  if (soilStudy.phase === 'processing' && !soilStudy.bookOpened) {
    soilStudy.bookOpened = true;
    showCropBook();
    saveGameProgress();
  }
  if (soilStudy.phase === 'processing' && soilReportDue(soilStudy.submittedAt, getGameDate().getTime())) {
    soilStudy.phase = 'mail-ready';
    status.textContent = 'Mail has arrived! Click the farmhouse mailbox for the soil report.';
    playSound('mail');
    refreshSoilStudyHud();
    saveGameProgress();
  }
}

function addPathLantern(x, z) {
  const group = new THREE.Group();
  group.position.set(x, groundHeight(x, z), z);
  box(group, 0.09, 1.05, 0.09, material(0x5a3820), 0, 0.53, 0);
  box(group, 0.24, 0.07, 0.24, material(0x422a1b), 0, 1.12, 0);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffd583, emissive: 0xffa83d, emissiveIntensity: 0.6 });
  box(group, 0.17, 0.22, 0.17, lampMaterial, 0, 1.26, 0);
  box(group, 0.27, 0.06, 0.27, material(0x422a1b), 0, 1.40, 0);
  glowMaterials.push(lampMaterial);
  addWarmLight(group, 0, 1.28, 0, 5, 4.6);
  scene.add(group);
}
// The new homestead begins with only the house; field structures come later.

function updateChimneySmoke(deltaSeconds = 0) {
  for (let i = 0; i < chimneyPuffs.length; i += 1) {
    const puff = chimneyPuffs[i];
    puff.userData.offset += deltaSeconds * puff.userData.speed;
    const progress = (puff.userData.offset % 3.6) / 3.6;
    puff.position.y = puff.userData.baseY + progress * 1.8;
    puff.position.x = -0.65 + Math.sin(progress * Math.PI * 2) * 0.12 + progress * 0.2;
    const scale = (0.7 + progress * 1.1);
    puff.scale.set(scale, scale * 1.1, scale);
    puff.material.opacity = Math.sin(progress * Math.PI) * 0.55;
  }
}

// ==========================================================================
// RUSTIC FARM ENVIRONMENT: FENCE, PATH, TREES, HAY BALES, SIGNPOST
// ==========================================================================

// 1. Winding Cobblestone Garden Path (Farmhouse -> Wheat Field)
function addGardenPath() {
  const pathMat = material(0x8a8479, 0.95);
  for (let i = 0; i < GARDEN_PATH_STEPS.length; i += 1) {
    const [x, z] = GARDEN_PATH_STEPS[i];
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32 + (i % 2) * 0.08, 0.35 + (i % 2) * 0.08, 0.06, 7),
      pathMat
    );
    stone.position.set(x, groundHeight(x, z) + 0.015, z);
    stone.rotation.y = (i * 1.3);
    stone.receiveShadow = true;
    scene.add(stone);
  }
}

// 2. Rustic Split-Rail Wooden Fence around Wheat Plots
function addFence() {
  const fenceWood = material(0x764b28);
  const postGeom = new THREE.CylinderGeometry(0.06, 0.075, 0.72, 6);
  const railGeom = new THREE.BoxGeometry(1.22, 0.05, 0.09);

  // Fence posts around field boundary
  const posts = [
    // Top boundary (z = -2.35)
    [-1.25, -2.35], [0, -2.35], [1.25, -2.35], [2.35, -2.35],
    // Right boundary (x = 2.35)
    [2.35, -1.2], [2.35, 0], [2.35, 1.2], [2.35, 2.35],
    // Bottom boundary (z = 2.35)
    [1.25, 2.35], [0, 2.35], [-1.25, 2.35], [-2.35, 2.35],
    // Left boundary (x = -2.35) - open gateway left near path!
    [-2.35, 1.2], [-2.35, 0]
  ];

  for (const [px, pz] of posts) {
    const post = new THREE.Mesh(postGeom, fenceWood);
    post.position.set(px, groundHeight(px, pz) + 0.3, pz);
    post.rotation.y = Math.sin(px * pz) * 0.3;
    post.castShadow = true;
    post.receiveShadow = true;
    scene.add(post);
  }

  // Horizontal rails connecting top
  for (let x = -0.6; x <= 1.8; x += 1.2) {
    for (const h of [0.18, 0.42]) {
      const rail = new THREE.Mesh(railGeom, fenceWood);
      rail.position.set(x, groundHeight(x, -2.35) + h, -2.35);
      rail.castShadow = true;
      scene.add(rail);
    }
  }
  // Horizontal rails connecting right
  for (let z = -0.6; z <= 1.8; z += 1.2) {
    for (const h of [0.18, 0.42]) {
      const rail = new THREE.Mesh(railGeom, fenceWood);
      rail.rotation.y = Math.PI / 2;
      rail.position.set(2.35, groundHeight(2.35, z) + h, z);
      rail.castShadow = true;
      scene.add(rail);
    }
  }
  // Horizontal rails connecting bottom
  for (let x = 1.8; x >= -1.8; x -= 1.2) {
    for (const h of [0.18, 0.42]) {
      const rail = new THREE.Mesh(railGeom, fenceWood);
      rail.position.set(x, groundHeight(x, 2.35) + h, 2.35);
      rail.castShadow = true;
      scene.add(rail);
    }
  }
}

// 3. Golden Hay Bales
function addHayBales() {
  const hayMat = material(0xd6a347);
  const twineMat = material(0x452e18);

  function createBale(x, z, rotY = 0) {
    const bale = new THREE.Group();
    bale.position.set(x, groundHeight(x, z) + 0.25, z);
    bale.rotation.y = rotY;

    box(bale, 0.95, 0.5, 0.58, hayMat, 0, 0, 0);
    // Twine bands
    box(bale, 0.97, 0.52, 0.04, twineMat, 0, 0, -0.16);
    box(bale, 0.97, 0.52, 0.04, twineMat, 0, 0, 0.16);

    scene.add(bale);
    return bale;
  }

  createBale(2.6, -1.8, 0.2);
  createBale(2.8, -1.2, -0.1);
  const topBale = createBale(2.7, -1.5, 0.08);
  topBale.position.y += 0.48;
}

// 4. Cozy Orchard Trees
function addTree(x, z, scale = 1) {
  const tree = new THREE.Group();
  tree.position.set(x, groundHeight(x, z), z);
  tree.scale.setScalar(scale);

  const trunkMat = material(0x56381d);
  const foliageMat = material(0x4a7c36);
  const appleMat = material(0xd9382b);

  // Trunk
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 2.4, 7), trunkMat);
  trunk.position.y = 1.2;
  trunk.castShadow = true;
  tree.add(trunk);

  // Foliage clusters (fluffy cloud shape)
  const canopyOffsets = [
    [0, 2.7, 0, 1.4],
    [-0.5, 2.5, 0.4, 1.0],
    [0.6, 2.6, -0.3, 1.1],
    [0.2, 3.2, 0.3, 1.0],
  ];
  for (const [cx, cy, cz, cr] of canopyOffsets) {
    const sphere = new THREE.Mesh(new THREE.DodecahedronGeometry(cr, 1), foliageMat);
    sphere.position.set(cx, cy, cz);
    sphere.castShadow = true;
    tree.add(sphere);
  }

  // Red Apples
  const appleOffsets = [
    [-0.5, 2.2, 0.7], [0.7, 2.3, 0.2], [-0.3, 2.8, -0.8], [0.4, 2.7, 0.7]
  ];
  for (const [ax, ay, az] of appleOffsets) {
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), appleMat);
    apple.position.set(ax, ay, az);
    tree.add(apple);
  }

  scene.add(tree);
}
addTree(-10.7, -7.4, 1.0); // Far enough from the farmhouse roof and hitbox
addTree(3.8, -5.6, 0.95);  // North edge of pasture

// 5. Wooden Farm Signpost
function addSignpost() {
  const signWood = material(0x6e4324);
  const signBoard = material(0xd7b483);
  const signpost = new THREE.Group();
  signpost.position.set(-2.1, groundHeight(-2.1, -1.9), -1.9);

  box(signpost, 0.08, 0.9, 0.08, signWood, 0, 0.45, 0);
  const board = box(signpost, 0.52, 0.22, 0.05, signBoard, 0.16, 0.75, 0);
  board.rotation.y = 0.35;

  scene.add(signpost);
}

// ==========================================================================
// INTERESTING TERRAIN: PINE FOREST AND BOULDERS
// ==========================================================================

function addPine(x, z, scale = 1) {
  const pine = new THREE.Group();
  pine.position.set(x, groundHeight(x, z), z);
  pine.scale.setScalar(scale);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.0, 6), material(0x4a3017));
  trunk.position.y = 0.5;
  trunk.castShadow = true;
  pine.add(trunk);

  const tiers = [
    [1.1, 1.6, 1.35],
    [0.8, 1.4, 1.95],
    [0.5, 1.1, 2.5],
  ];
  for (const [radius, height, centerY] of tiers) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), material(0x2f6b34));
    cone.position.y = centerY;
    cone.castShadow = true;
    pine.add(cone);
  }

  scene.add(pine);
}

function addBoulder(x, z, scale = 1) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34 * scale, 0), material(0x8a8578));
  rock.position.set(x, groundHeight(x, z) + 0.1 * scale, z);
  rock.rotation.set(Math.sin(x) * 0.6, z * 0.5, Math.cos(z) * 0.4);
  rock.scale.y = 0.7;
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
  return rock;
}

PINE_POSITIONS.forEach(([x, z], index) => addPine(x, z, 0.85 + (index % 3) * 0.15));
ROCK_POSITIONS.forEach(([x, z], index) => {
  const rock = addBoulder(x, z, 0.75 + (index % 3) * 0.3);
  rock.userData.cleanupRock = index;
  cleanupRocks[index] = rock;
});

// ==========================================================================
// SOIL AND PLANTING FIELD
// ==========================================================================

const workedGroundPatches = [];
function refreshWorkedGroundPatches() {
  for (const patch of workedGroundPatches) { scene.remove(patch); patch.geometry.dispose(); patch.material.dispose(); }
  workedGroundPatches.length = 0;
  if (!cleanup) return;
  const marks = [
    ...cleanup.dug.map((id) => ({ ...plotPositions[id], color: 0x886744, radius: 0.64 })),
    ...cleanup.filled.map((id) => ({ ...plotPositions[id], color: 0xa3825a, radius: 0.64 })),
    ...cleanup.removed.map((id) => ({ x: ROCK_POSITIONS[id]?.[0], z: ROCK_POSITIONS[id]?.[1], color: 0x927452, radius: 0.42 })),
  ];
  for (const mark of marks) {
    if (!Number.isFinite(mark.x) || !Number.isFinite(mark.z)) continue;
    const geometry = new THREE.CircleGeometry(mark.radius, 14);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, groundHeight(mark.x + positions.getX(index), mark.z + positions.getZ(index)) + 0.062);
    }
    geometry.computeVertexNormals();
    const patch = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: mark.color, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.86, depthWrite: false }));
    patch.position.set(mark.x, 0, mark.z);
    patch.receiveShadow = true;
    scene.add(patch);
    workedGroundPatches.push(patch);
  }
}

const plotMeshes = [];
const plotMaterials = [];
const plotPositions = [];
const ridgeGroups = [];
const weedGroups = [];

const weedMaterialDark = material(0x4c7c33);
const weedMaterialLight = material(0x6fa24a);

function conformPlotSoil(mesh, x, z, scaleX, scaleZ) {
  const positions = mesh.geometry.attributes.position;
  const original = mesh.userData.originalVertices;
  for (let i = 0; i < positions.count; i += 1) {
    const offset = i * 3;
    const worldX = x + original[offset] * scaleX;
    const worldZ = z + original[offset + 2] * scaleZ;
    positions.setY(i, groundHeight(worldX, worldZ) + (original[offset + 1] > 0 ? 0.09 : -0.055));
  }
  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

function conformPlotRidges(group, x, z, scaleX, scaleZ) {
  for (const feature of group.children) {
    const positions = feature.geometry.attributes.position;
    const original = feature.userData.originalVertices;
    for (let i = 0; i < positions.count; i += 1) {
      const offset = i * 3;
      const worldX = x + original[offset] * scaleX;
      const worldZ = z + original[offset + 2] * scaleZ;
      positions.setY(i, groundHeight(worldX, worldZ) + 0.18 + original[offset + 1]);
    }
    positions.needsUpdate = true;
    feature.geometry.computeVertexNormals();
    feature.geometry.computeBoundingSphere();
  }
}

function addPlotWeeds(index) {
  const { x, z } = plotPositions[index];
  const group = new THREE.Group();
  group.position.set(x, -0.06, z);
  let seed = (index + 1) * 733;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let w = 0; w < 7; w += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 0.1 + random() * 0.34;
    const height = 0.12 + random() * 0.22;
    const stem = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, height, 5),
      w % 2 === 0 ? weedMaterialDark : weedMaterialLight
    );
    stem.position.set(Math.cos(angle) * radius, height / 2 - 0.02, Math.sin(angle) * radius);
    stem.rotation.z = Math.cos(angle) * 0.32;
    stem.rotation.x = -Math.sin(angle) * 0.32;
    stem.castShadow = true;
    stem.userData.baseY = stem.position.y;
    group.add(stem);
  }
  scene.add(group);
  return group;
}

for (let row = 0; row < MAX_GRID; row += 1) {
  for (let column = 0; column < MAX_GRID; column += 1) {
    const index = row * MAX_GRID + column;
    const x = (column - 1) * 1.22;
    const z = (row - 1) * 1.22;
    const soilMaterial = material(0x945f3c);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.1, 1.06, 10, 1, 10), soilMaterial);
    soil.position.set(x, -0.11, z);
    soil.castShadow = true;
    soil.receiveShadow = true;
    soil.userData.originalVertices = new Float32Array(soil.geometry.attributes.position.array);
    scene.add(soil);
    soil.visible = false;
    soil.userData.plotIndex = index;
    plotMeshes.push(soil);
    plotMaterials.push(soilMaterial);
    plotPositions.push({ x, z });

    // Raised rows and shadowed grooves give the seedbed readable depth.
    const ridges = new THREE.Group();
    for (let furrow = -2; furrow <= 2; furrow += 1) {
      const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.91, 8), ridgeMaterial);
      mound.rotation.z = Math.PI / 2;
      mound.position.set(0, -0.032, furrow * 0.19);
      mound.castShadow = true;
      mound.receiveShadow = true;
      ridges.add(mound);
      if (furrow < 2) box(ridges, 0.88, 0.018, 0.055, furrowMaterial, 0, -0.049, furrow * 0.19 + 0.095);
    }
    for (let clump = 0; clump < 7; clump += 1) {
      const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.025 + (clump % 3) * 0.009, 0), clump % 2 ? ridgeMaterial : furrowMaterial);
      pebble.position.set(((clump * 37 + index * 17) % 75) / 100 - 0.37, 0.035, ((clump * 23 + index * 11) % 80) / 100 - 0.4);
      pebble.castShadow = true;
      ridges.add(pebble);
    }
    // Bake each row's local transform once, then bend its vertices to the
    // sampled ground whenever the field is placed or reshaped.
    for (const feature of ridges.children) {
      feature.updateMatrix();
      feature.geometry.applyMatrix4(feature.matrix);
      feature.position.set(0, 0, 0);
      feature.rotation.set(0, 0, 0);
      feature.scale.set(1, 1, 1);
      feature.userData.originalVertices = new Float32Array(feature.geometry.attributes.position.array);
    }
    ridges.position.set(x, 0, z);
    ridges.visible = false;
    scene.add(ridges);
    ridgeGroups.push(ridges);

    // Overgrown weeds — shown until the plot is cleared.
    weedGroups.push(addPlotWeeds(index));
    weedGroups[index].visible = false;
  }
}

function cleanupPlan(bounds, columns, rows) {
  const heights = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
    const x = bounds.minX + (col + 0.5) * (bounds.maxX - bounds.minX) / columns;
    const z = bounds.minZ + (row + 0.5) * (bounds.maxZ - bounds.minZ) / rows;
    heights.push(groundHeight(x, z));
  }
  const average = heights.reduce((sum, h) => sum + h, 0) / heights.length;
  const high = [], low = [];
  heights.forEach((height, index) => {
    const col = index % columns, row = Math.floor(index / columns);
    const x = bounds.minX + (col + 0.5) * CELL_SIZE, z = bounds.minZ + (row + 0.5) * CELL_SIZE;
    if (cellBlockedByTree(x, z)) return;
    if (height > average + 0.13) high.push(index);
    else if (height < average - 0.13) low.push(index);
  });
  const rocks = ROCK_POSITIONS.flatMap(([x, z], index) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ ? [index] : []);
  return { rocks, high, low, removed: [], dug: [], filled: [], dirt: 0, shovel: false };
}

function cleanupReady() {
  return !cleanup || (cleanup.rocks.every((id) => cleanup.removed?.includes(id)) && cleanup.high.every((id) => cleanup.dug.includes(id)) && (cleanup.low.every((id) => cleanup.filled.includes(id)) || cleanup.dirt === 0));
}

function refreshCleanupVisuals() {
  for (const marker of cleanupPatches) {
    scene.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
  }
  cleanupPatches.length = 0;
  if (!fieldBounds || !cleanup) return;
  johnShovel.visible = Boolean(cleanup.shovel) && !cleanupReady();
  for (const [kind, ids, done] of [['high', cleanup.high, cleanup.dug], ['low', cleanup.low, cleanup.filled]]) {
    for (const id of ids) {
      if (done.includes(id)) continue;
      const { x, z } = plotPositions[id];
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9), new THREE.MeshBasicMaterial({ color: kind === 'high' ? 0xd8914a : 0x69a7cb, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false }));
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(x, groundHeight(x, z) + 0.19, z);
      marker.userData.cleanupKind = kind;
      marker.userData.cleanupId = id;
      cleanupPatches.push(marker);
      scene.add(marker);
    }
  }
  for (const id of cleanup.rocks) {
    const rock = cleanupRocks[id];
    rock.visible = !cleanup.removed?.includes(id);
    rock.material.color.setHex(0xc4b090);
    if (rock.visible) {
      const [x, z] = ROCK_POSITIONS[id];
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.55, 24), new THREE.MeshBasicMaterial({ color: 0xf3c768, side: THREE.DoubleSide, depthTest: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, groundHeight(x, z) + 0.17, z);
      ring.userData.cleanupKind = 'rock';
      ring.userData.cleanupId = id;
      cleanupPatches.push(ring);
      scene.add(ring);
    }
  }
  for (let index = 0; index < MAX_GRID * MAX_GRID; index += 1) applyPlotVisual(index);
  updateCleanupHUD();
}

function updateCleanupHUD() {
  const hud = document.querySelector('#cleanup-hud');
  if (!hud) return;
  hud.hidden = !fieldBounds;
  hud.classList.toggle('is-complete', cleanupReady());
  if (!cleanup) return;
  const removed = cleanup.removed?.length ?? 0;
  const rockTotal = cleanup.rocks.length;
  const effortTotal = cleanup.high.length + cleanup.low.length;
  const effortDone = cleanup.dug.length + cleanup.filled.length;
  document.querySelector('#ground-cleanliness').textContent = `${rockTotal ? Math.round(100 * removed / rockTotal) : 100}%`;
  document.querySelector('#ground-flatness').textContent = `${effortTotal ? Math.round(35 + 53 * effortDone / effortTotal) : 88}%`;
  document.querySelector('#ground-dirt').textContent = `${cleanup.dirt}`;
  const instruction = document.querySelector('#cleanup-instruction');
  const remainingLows = cleanup.low.length - cleanup.filled.length;
  if (instruction) instruction.textContent = cleanupReady()
    ? `${remainingLows ? `${remainingLows} shallow spots remain without enough dirt.` : 'Ground prepared by hand.'} ${soilStudy.phase === 'mail-ready' ? 'The soil report is in the mailbox.' : soilStudy.phase === 'received' ? 'Continue plot work.' : soilStudy.phase === 'not-started' || soilStudy.phase === 'planning' ? 'Plan five sampling points on the field edges.' : 'Soil study in progress.'}`
    : rockTotal > removed ? 'Click highlighted stones: 2 coins and energy each.'
    : cleanup.high.length > cleanup.dug.length ? 'Click orange high ground. John will fetch a shovel, then dig: 2 coins each.'
      : cleanup.dirt > 0 && cleanup.low.length > cleanup.filled.length ? 'Click blue low ground to fill it with dug soil: 2 coins each.'
        : 'No more usable soil. Remaining low spots will stay shallow.';
}

function placeField(bounds, savedCleanup = null) {
  fieldBounds = bounds;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  COLUMNS = THREE.MathUtils.clamp(Math.round(width / CELL_SIZE), 2, MAX_GRID);
  ROWS = THREE.MathUtils.clamp(Math.round(depth / CELL_SIZE), 2, MAX_GRID);
  PLOT_COUNT = COLUMNS * ROWS;
  cleanup = savedCleanup ?? cleanupPlan(bounds, COLUMNS, ROWS);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  blockedPlots.clear();
  if (fieldBorder) { scene.remove(fieldBorder); fieldBorder.geometry.dispose(); fieldBorder.material.dispose(); }
  fieldBorder = dottedRectangle(bounds, 0xffe2a1, 0.19);
  if (fieldGrid) { scene.remove(fieldGrid); fieldGrid.geometry.dispose(); fieldGrid.material.dispose(); }
  const gridPoints = [];
  const dashed = (ax, az, bx, bz) => {
    const length = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < length; d += 0.14) {
      const end = Math.min(length, d + 0.08);
      for (const distance of [d, end]) {
        const x = ax + (bx - ax) * distance / length;
        const z = az + (bz - az) * distance / length;
        gridPoints.push(new THREE.Vector3(x, groundHeight(x, z) + 0.13, z));
      }
    }
  };
  for (let col = 1; col < COLUMNS; col += 1) dashed(bounds.minX + width * col / COLUMNS, bounds.minZ, bounds.minX + width * col / COLUMNS, bounds.maxZ);
  for (let row = 1; row < ROWS; row += 1) dashed(bounds.minX, bounds.minZ + depth * row / ROWS, bounds.maxX, bounds.minZ + depth * row / ROWS);
  fieldGrid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), new THREE.LineBasicMaterial({ color: 0xe2cf9c, depthTest: false }));
  scene.add(fieldGrid);
  for (let index = 0; index < MAX_GRID * MAX_GRID; index += 1) {
    plotMeshes[index].visible = false;
    ridgeGroups[index].visible = false;
    weedGroups[index].visible = false;
    if (index >= PLOT_COUNT) continue;
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = bounds.minX + (column + 0.5) * width / COLUMNS;
    const z = bounds.minZ + (row + 0.5) * depth / ROWS;
    plotPositions[index] = { x, z };
    const halfWidth = width / COLUMNS / 2;
    const halfDepth = depth / ROWS / 2;
    if (cellBlockedByTree(x, z, halfWidth, halfDepth)) blockedPlots.add(index);
    const scaleX = (width / COLUMNS) / 1.06;
    const scaleZ = (depth / ROWS) / 1.06;
    plotMeshes[index].position.set(x, 0, z);
    plotMeshes[index].scale.set(scaleX, 1, scaleZ);
    conformPlotSoil(plotMeshes[index], x, z, scaleX, scaleZ);
    ridgeGroups[index].position.set(x, 0, z);
    ridgeGroups[index].scale.set(scaleX, 1, scaleZ);
    conformPlotRidges(ridgeGroups[index], x, z, scaleX, scaleZ);
    weedGroups[index].position.set(x, 0, z);
    weedGroups[index].scale.set(scaleX, 1, scaleZ);
    for (const weed of weedGroups[index].children) {
      const worldX = x + weed.position.x * scaleX;
      const worldZ = z + weed.position.z * scaleZ;
      weed.position.y = groundHeight(worldX, worldZ) + 0.055 + weed.userData.baseY;
    }
    applyPlotVisual(index);
  }
  refreshWorkedGroundPatches();
  refreshCleanupVisuals();
  updateFarmMap();
  render();
}

function fieldAreaIsValid(bounds) {
  if (!bounds) return false;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  if (width < CELL_SIZE * 2 || depth < CELL_SIZE * 2 || width > CELL_SIZE * MAX_GRID || depth > CELL_SIZE * MAX_GRID) return false;
  if (bounds.minX < RANCH.minX || bounds.maxX > RANCH.maxX || bounds.minZ < RANCH.minZ || bounds.maxZ > RANCH.maxZ) return false;
  const obstacles = [{ x: -5.8, z: -5.1, radius: 3.2 }];
  if (obstacles.some(({ x, z, radius }) => x + radius > bounds.minX && x - radius < bounds.maxX && z + radius > bounds.minZ && z - radius < bounds.maxZ)) return false;
  return true;
}

function render() {
  renderer.render(scene, camera);
}

// ==========================================================================
// WEATHER SYSTEM
// ==========================================================================

const weatherSettings = {
  sunny: {
    description: 'Clear skies and warm sunlight.',
    sky: 0xa2d3e9,
    ambient: 2.5,
    sun: 3.4,
    rain: 0,
    speed: 0,
    opacity: 0,
    length: 0,
    fog: 130,
  },
  light: {
    description: 'A light shower is falling.',
    sky: 0xabc8ce,
    ambient: 2.1,
    sun: 2.0,
    rain: 1600,
    speed: 9,
    opacity: 0.45,
    length: 0.32,
    fog: 105,
  },
  moderate: {
    description: 'Steady rain is falling.',
    sky: 0x85a2ad,
    ambient: 1.7,
    sun: 1.2,
    rain: 3000,
    speed: 13,
    opacity: 0.56,
    length: 0.44,
    fog: 85,
  },
  heavy: {
    description: 'A heavy downpour is falling.',
    sky: 0x667f8f,
    ambient: 1.3,
    sun: 0.7,
    rain: 5000,
    speed: 18,
    opacity: 0.68,
    length: 0.58,
    fog: 68,
  },
};

const MAX_RAIN_DROPS = weatherSettings.heavy.rain;
const RAIN_SPAN = 28;
let rainSeed = 9247;
const randomRain = () => ((rainSeed = (rainSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rainDrops = Array.from({ length: MAX_RAIN_DROPS }, () => ({
  x: controls.target.x + (randomRain() - 0.5) * RAIN_SPAN,
  y: randomRain() * 20,
  z: controls.target.z + (randomRain() - 0.5) * RAIN_SPAN,
}));
const rainPositions = new Float32Array(MAX_RAIN_DROPS * 6);
const rainGeometry = new THREE.BufferGeometry();
const rainPositionAttribute = new THREE.BufferAttribute(rainPositions, 3);
rainPositionAttribute.setUsage(THREE.DynamicDrawUsage);
rainGeometry.setAttribute('position', rainPositionAttribute);
rainGeometry.setDrawRange(0, 0);
const rainMaterial = new THREE.LineBasicMaterial({
  color: 0xd9effa,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  fog: true,
});
const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
rain.frustumCulled = false;
rain.visible = false;
scene.add(rain);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentWeather = weatherSettings.sunny;
let currentWeatherName = 'sunny';
let lastTickTime = performance.now();

function updateRain(deltaSeconds = 0) {
  for (let index = 0; index < currentWeather.rain; index += 1) {
    const drop = rainDrops[index];
    if (drop.x - controls.target.x > RAIN_SPAN / 2) drop.x -= RAIN_SPAN;
    else if (controls.target.x - drop.x > RAIN_SPAN / 2) drop.x += RAIN_SPAN;
    if (drop.z - controls.target.z > RAIN_SPAN / 2) drop.z -= RAIN_SPAN;
    else if (controls.target.z - drop.z > RAIN_SPAN / 2) drop.z += RAIN_SPAN;
    drop.y -= currentWeather.speed * deltaSeconds;
    if (drop.y < groundHeight(drop.x, drop.z) + currentWeather.length) {
      drop.y = 18 + randomRain() * 2;
    }
    const offset = index * 6;
    rainPositions[offset] = drop.x;
    rainPositions[offset + 1] = drop.y;
    rainPositions[offset + 2] = drop.z;
    rainPositions[offset + 3] = drop.x - currentWeather.length * 0.22;
    rainPositions[offset + 4] = drop.y - currentWeather.length;
    rainPositions[offset + 5] = drop.z;
  }
  rainPositionAttribute.needsUpdate = true;
}

function setWeather(name) {
  currentWeatherName = weatherSettings[name] ? name : 'sunny';
  currentWeather = weatherSettings[name] || weatherSettings.sunny;
  // Sky, fog, and light intensities are driven by updateDaylight().
  rain.visible = currentWeather.rain > 0;
  rainGeometry.setDrawRange(0, currentWeather.rain * 2);
  rainMaterial.opacity = currentWeather.opacity;
  if (rain.visible) updateRain();
  render();
}

// ==========================================================================
// PROGRESS PERSISTENCE
// ==========================================================================

// Existing saves without a layout keep the original field; new saves begin
// without one until the player draws a site for Farmer John.
const STORAGE_FARM_KEY = 'farm-hands-seasonal-farm-v3';

function saveGameProgress() {
  if (window.__farmHandsResetting) return;
  try {
    localStorage.setItem(STORAGE_FARM_KEY, JSON.stringify({ layoutVersion: 5, fieldBounds, cleanup, terrainEdits, plotStates, plotCare, inventory, coins, energy, soilStudy, johnPosition: { x: farmerJohn.position.x, z: farmerJohn.position.z, facing: farmerJohn.rotation.y }, johnSleeping, sleepMorningAt, pendingJobs }));
  } catch {
    // Storage unavailable (e.g. private browsing); the game keeps running.
  }
}

function restoreGameProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_FARM_KEY);
    const legacyRaw = raw ? null : localStorage.getItem('farm-hands-seasonal-farm-v2');
    const saved = raw ? JSON.parse(raw) : legacyRaw ? JSON.parse(legacyRaw) : null;
    const legacyStates = saved ? null : JSON.parse(localStorage.getItem('farm-hands-plot-states-v1') || 'null');
    if (Array.isArray(saved?.terrainEdits)) {
      for (const edit of saved.terrainEdits) if (Number.isFinite(edit?.x) && Number.isFinite(edit?.z) && Number.isFinite(edit?.delta) && Math.abs(edit.delta) < 1) terrainEdits.push(edit);
      refreshRanchTerrain();
    }
    if (saved?.layoutVersion >= 2) {
      const bounds = saved.fieldBounds;
      if (bounds && ['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(bounds[key])) && fieldAreaIsValid(bounds)) {
        const legacyCleanup = { rocks: [], high: [], low: [], removed: [], dug: [], filled: [], dirt: 0, shovel: true };
        placeField(bounds, saved.layoutVersion >= 3 && saved.cleanup ? saved.cleanup : legacyCleanup);
      }
    } else if (saved || Array.isArray(legacyStates)) {
      placeField({ minX: -1.9, maxX: 1.9, minZ: -1.9, maxZ: 1.9 }, { rocks: [], high: [], low: [], removed: [], dug: [], filled: [], dirt: 0, shovel: true });
    }
    if (Array.isArray(saved?.plotStates) || Array.isArray(legacyStates)) {
      for (let index = 0; index < PLOT_COUNT; index += 1) {
        const state = saved?.plotStates?.[index] ?? legacyStates?.[index];
        if (Object.values(PLOT_STATE).includes(state)) {
          plotStates[index] = !raw && !legacyRaw && state === PLOT_STATE.PLANTED ? PLOT_STATE.WEEDY : state;
          const care = saved?.plotCare?.[index];
          if (care && typeof care === 'object') plotCare[index] = care;
        }
      }
    }
    if (saved?.soilStudy && ['not-started', 'planning', 'sampling', 'to-car', 'driving-out', 'lab-stop', 'lab-arrived', 'ready-to-return', 'driving-back', 'processing', 'mail-ready', 'received'].includes(saved.soilStudy.phase)) {
      soilStudy = {
        phase: saved.soilStudy.phase === 'lab-stop' ? 'ready-to-return' : saved.soilStudy.phase,
        points: Array.isArray(saved.soilStudy.points) ? saved.soilStudy.points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.z)).slice(0,5) : [],
        sampleIndex: THREE.MathUtils.clamp(Math.floor(Number(saved.soilStudy.sampleIndex) || 0), 0, 5),
        submittedAt: Number.isFinite(saved.soilStudy.submittedAt) ? saved.soilStudy.submittedAt : null,
        report: fieldBounds && saved.soilStudy.report
          ? (['ph','phosphorus','potassium','magnesium'].every((key) => Number.isFinite(Number(saved.soilStudy.report[key])))
            ? saved.soilStudy.report : soilReportForField(fieldBounds)) : null,
        reportDate: Number.isFinite(saved.soilStudy.reportDate) ? saved.soilStudy.reportDate : Number.isFinite(saved.soilStudy.submittedAt) ? saved.soilStudy.submittedAt + SOIL_LAB_DAY_MS : null,
        mailRead: saved.soilStudy.mailRead === true,
        bookOpened: saved.soilStudy.bookOpened === true,
        carProgress: Number.isFinite(saved.soilStudy.carProgress) ? THREE.MathUtils.clamp(saved.soilStudy.carProgress,0,1) : 0,
        carPose: saved.soilStudy.carPose && ['x','z','heading'].every((key) => Number.isFinite(saved.soilStudy.carPose[key])) ? { x: saved.soilStudy.carPose.x, z: saved.soilStudy.carPose.z, heading: saved.soilStudy.carPose.heading, speed: Number(saved.soilStudy.carPose.speed) || 0, steer: Number(saved.soilStudy.carPose.steer) || 0 } : null,
      };
      if (fieldBounds && soilStudy.phase === 'sampling' && soilStudy.points.length !== 5) soilStudy.points = soilSampleRoute(fieldBounds);
      if (soilStudy.phase === 'driving-back' && !Number.isFinite(saved.soilStudy.carProgress)) soilStudy.carProgress = 1;
      if (soilStudy.sampleIndex > 0 && ['sampling','to-car'].includes(soilStudy.phase)) {
        const fillHeight = 0.03 + soilStudy.sampleIndex * 0.03;
        soilInBag.scale.y = fillHeight / 0.03;
        soilInBag.position.y = -0.27 + fillHeight / 2;
        sampleBag.visible = true;
      }
    } else if (fieldBounds && plotStates.slice(0, PLOT_COUNT).some((state) => ![PLOT_STATE.WEEDY, PLOT_STATE.CLEARED].includes(state))) {
      // Keep older farms playable without retroactively requiring a lab trip.
      soilStudy = { phase: 'received', points: soilSampleRoute(fieldBounds), sampleIndex: 5, submittedAt: null, report: soilReportForField(fieldBounds), reportDate: getGameDate().getTime(), mailRead: true, bookOpened: true, carProgress: 0 };
    }
    if (raw) {
      for (const key of Object.keys(inventory)) {
        const value = saved?.inventory?.[key];
        if (Number.isInteger(value) && value >= 0) inventory[key] = value;
      }
      if (Number.isInteger(saved?.coins) && saved.coins >= 0) coins = saved.coins;
      if (Number.isFinite(saved?.energy)) energy = THREE.MathUtils.clamp(saved.energy, 0, 100);
      const savedJohn = saved?.johnPosition;
      if (savedJohn && Number.isFinite(savedJohn.x) && Number.isFinite(savedJohn.z) && Math.abs(savedJohn.x) < 100 && Math.abs(savedJohn.z) < 100) {
        farmerJohn.position.set(savedJohn.x, groundHeight(savedJohn.x, savedJohn.z), savedJohn.z);
        if (Number.isFinite(savedJohn.facing)) farmerJohn.rotation.y = savedJohn.facing;
      }
      if (['driving-out','driving-back','lab-arrived','ready-to-return'].includes(soilStudy.phase)) {
        farmerJohn.visible = false;
        const legacyPosition = carRoutePoint(soilStudy.carProgress);
        const legacyNearby = carRoutePoint(THREE.MathUtils.clamp(soilStudy.carProgress + (soilStudy.phase === 'driving-back' ? -0.002 : 0.002),0,1));
        const position = soilStudy.carPose ?? { x: legacyPosition.x, z: legacyPosition.z, heading: soilStudy.phase === 'lab-arrived' || soilStudy.phase === 'ready-to-return' ? Math.PI / 2 : Math.atan2(legacyNearby.x - legacyPosition.x,legacyNearby.z - legacyPosition.z), speed: 0, steer: 0 };
        soilStudy.carPose = position;
        car.position.set(position.x,groundHeight(position.x,position.z)+0.12,position.z);
        car.rotation.y = position.heading;
      }
      if (Array.isArray(saved?.pendingJobs)) pendingJobs = saved.pendingJobs.filter((job) => job && ['plot', 'cleanup'].includes(job.kind)).slice(0, 4);
      if (saved?.johnSleeping === true) {
        johnSleeping = true;
        farmerJohn.visible = false;
        sleepWakeAt = performance.now() + 1400;
        if (Number.isFinite(saved.sleepMorningAt)) sleepMorningAt = saved.sleepMorningAt;
      }
    }
  } catch {
    // Fall through to a fresh field.
  }

  for (let index = 0; index < PLOT_COUNT; index += 1) {
    applyPlotVisual(index);
    if (blockedPlots.has(index)) { plotStates[index] = PLOT_STATE.WEEDY; plotCare[index] = {}; }
    if (fieldBounds && plotStates[index] === PLOT_STATE.PLANTED) addWheatSeedlings(index, false);
  }

  setWeather('sunny');
  refreshStatus();
  updateFieldLedger();
  updateInventory();
  updateCoins();
  updateEnergy();
  refreshSoilStudyHud();
  saveGameProgress();
  if (fieldBounds && !johnSleeping) setGamePaused(false);
}

reducedMotion.addEventListener('change', () => setWeather(currentWeatherName));
restoreGameProgress();

// ─── Daylight cycle ──────────────────────────────────────────────────────
// Each keyframe is keyed by fractional hour (0–24).
// Fields: sky, fog colour, fog far distance, ambient intensity,
//         sun colour, sun intensity, sun position [x,y,z].
const daylightKeyframes = [
  { hour:  0,   sky: 0x050a14, fog: 0x081020, fogFar: 48,  ambient: 0.09, sunColor: 0x8899bb, sunIntensity: 0.0,  sunPos: [-5, -4,  7] },
  { hour:  5,   sky: 0x101a2d, fog: 0x101a2d, fogFar: 54,  ambient: 0.12, sunColor: 0x99aabb, sunIntensity: 0.05, sunPos: [-8,  0,  7] },
  { hour:  6,   sky: 0x5e4a5e, fog: 0x5e4a5e, fogFar: 75,  ambient: 0.85, sunColor: 0xffb87a, sunIntensity: 0.9,  sunPos: [-9,  2,  7] },
  { hour:  7,   sky: 0xe8a87a, fog: 0xdaa07a, fogFar: 90,  ambient: 1.4,  sunColor: 0xffc88e, sunIntensity: 1.8,  sunPos: [-8,  5,  7] },
  { hour:  8.5, sky: 0xb8e1df, fog: 0xb8e1df, fogFar: 150, ambient: 2.4,  sunColor: 0xfff1cd, sunIntensity: 3.2,  sunPos: [-5, 11,  7] },
  { hour: 12,   sky: 0xb8e1df, fog: 0xb8e1df, fogFar: 150, ambient: 2.4,  sunColor: 0xfff8e0, sunIntensity: 3.4,  sunPos: [ 0, 14,  2] },
  { hour: 16,   sky: 0xb8e1df, fog: 0xb8e1df, fogFar: 150, ambient: 2.3,  sunColor: 0xfff1cd, sunIntensity: 3.0,  sunPos: [ 5, 11, -5] },
  { hour: 18,   sky: 0xe8a87a, fog: 0xdaa07a, fogFar: 90,  ambient: 1.4,  sunColor: 0xffad6e, sunIntensity: 1.6,  sunPos: [ 8,  4, -7] },
  { hour: 19.5, sky: 0x6e4a5e, fog: 0x6e4a5e, fogFar: 75,  ambient: 0.7,  sunColor: 0xe08855, sunIntensity: 0.5,  sunPos: [ 9,  1, -7] },
  { hour: 20.5, sky: 0x101a2d, fog: 0x101a2d, fogFar: 54,  ambient: 0.12, sunColor: 0x8899bb, sunIntensity: 0.05, sunPos: [ 8, -1, -7] },
  { hour: 24,   sky: 0x050a14, fog: 0x081020, fogFar: 48,  ambient: 0.09, sunColor: 0x8899bb, sunIntensity: 0.0,  sunPos: [-5, -4,  7] },
];

// Weather acts as a multiplier on top of the daylight base values.
const weatherDaylightMult = {
  sunny:    { ambient: 1.0, sun: 1.0,   fogFar: 1.0  },
  light:    { ambient: 0.83, sun: 0.59, fogFar: 0.83 },
  moderate: { ambient: 0.67, sun: 0.36, fogFar: 0.67 },
  heavy:    { ambient: 0.52, sun: 0.20, fogFar: 0.54 },
};

const _skyA = new THREE.Color();
const _skyB = new THREE.Color();
const _fogA = new THREE.Color();
const _fogB = new THREE.Color();
const _sunA = new THREE.Color();
const _sunB = new THREE.Color();

function updateDaylight() {
  const date = getGameDate();
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Find the two keyframes we sit between.
  let lo = daylightKeyframes[0];
  let hi = daylightKeyframes[1];
  for (let i = 1; i < daylightKeyframes.length; i++) {
    if (daylightKeyframes[i].hour >= hour) {
      hi = daylightKeyframes[i];
      lo = daylightKeyframes[i - 1];
      break;
    }
  }

  const span = hi.hour - lo.hour || 1;
  const t = THREE.MathUtils.clamp((hour - lo.hour) / span, 0, 1);
  // Smooth-step for more natural transitions
  const s = t * t * (3 - 2 * t);

  // Interpolate colours
  _skyA.setHex(lo.sky);
  _skyB.setHex(hi.sky);
  _skyA.lerp(_skyB, s);

  _fogA.setHex(lo.fog);
  _fogB.setHex(hi.fog);
  _fogA.lerp(_fogB, s);

  _sunA.setHex(lo.sunColor);
  _sunB.setHex(hi.sunColor);
  _sunA.lerp(_sunB, s);

  // Scalar lerps
  const baseFogFar     = THREE.MathUtils.lerp(lo.fogFar, hi.fogFar, s);
  const baseAmbient    = THREE.MathUtils.lerp(lo.ambient, hi.ambient, s);
  const baseSunInt     = THREE.MathUtils.lerp(lo.sunIntensity, hi.sunIntensity, s);
  const sunX           = THREE.MathUtils.lerp(lo.sunPos[0], hi.sunPos[0], s);
  const sunY           = THREE.MathUtils.lerp(lo.sunPos[1], hi.sunPos[1], s);
  const sunZ           = THREE.MathUtils.lerp(lo.sunPos[2], hi.sunPos[2], s);

  // Apply weather multiplier
  const wName = currentWeatherName;
  const wm = weatherDaylightMult[wName] || weatherDaylightMult.sunny;

  // If raining, tint the sky/fog slightly towards the rain palette colour
  if (wName !== 'sunny') {
    const rainSky = new THREE.Color(currentWeather.sky);
    _skyA.lerp(rainSky, 0.4);
    _fogA.lerp(rainSky, 0.4);
  }

  scene.background.copy(_skyA);
  scene.fog.color.copy(_fogA);
  scene.fog.far = baseFogFar * wm.fogFar;
  ambientLight.intensity = baseAmbient * wm.ambient;
  const night = 1 - THREE.MathUtils.clamp((baseSunInt - 0.05) / 0.85, 0, 1);
  ambientLight.color.setHex(0xe8f4ff).lerp(_skyB.setHex(0x8395bf), night);
  ambientLight.groundColor.setHex(0x6e945c).lerp(_fogB.setHex(0x19271e), night);
  for (const { light, intensity } of warmLightSources) light.intensity = intensity * night;
  for (const glow of glowMaterials) glow.emissiveIntensity = 0.45 + night * 2.3;
  sunlight.color.copy(_sunA);
  sunlight.intensity = baseSunInt * wm.sun;
  sunlight.position.set(sunX, sunY, sunZ);
  updateSkyObjects(sunX, sunY, sunZ);
}

// ==========================================================================
// SMOOTH WASD CAMERA MOVEMENT
// ==========================================================================

// Continuous, frame-based camera panning. Instead of teleporting the camera by a
// fixed amount on each keydown event, we track which movement keys are held and
// move a little every animation frame, scaling by elapsed time so the speed stays
// constant regardless of frame rate. Velocity eases toward the requested direction
// and eases back to zero on release, which removes the old "steppy" key-repeat feel.
const MOVE_SPEED = 9; // world units per second at full speed
const MOVE_DAMPING = 12; // higher = snappier acceleration / deceleration
// Held movement is tracked per action (not per physical key) so rebinding a
// key in Settings takes effect immediately. The order below keeps the spoken
// key hint reading "WASD".
const MOVE_ACTIONS = ['moveForward', 'moveLeft', 'moveBackward', 'moveRight'];
const heldKeys = new Set();
const moveVelocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const moveForward = new THREE.Vector3();
const moveRight = new THREE.Vector3();

function pauseMenuIsOpen() {
  return document.querySelector('#pause-modal')?.hasAttribute('hidden') === false;
}

function desiredMoveDirection() {
  camera.getWorldDirection(moveForward);
  moveForward.y = 0;
  moveForward.normalize();
  moveRight.crossVectors(moveForward, camera.up).normalize();

  moveDirection.set(0, 0, 0);
  if (heldKeys.has('moveForward')) moveDirection.add(moveForward);
  if (heldKeys.has('moveBackward')) moveDirection.sub(moveForward);
  if (heldKeys.has('moveRight')) moveDirection.add(moveRight);
  if (heldKeys.has('moveLeft')) moveDirection.sub(moveRight);
  if (moveDirection.lengthSq() > 0) moveDirection.normalize();
  return moveDirection;
}

function updateCameraMovement(deltaSeconds) {
  if (carTrip || ['driving-out','driving-back'].includes(soilStudy.phase)) { moveVelocity.set(0,0,0); return false; }
  const targetVelocity = desiredMoveDirection().multiplyScalar(MOVE_SPEED);
  const blend = 1 - Math.exp(-MOVE_DAMPING * deltaSeconds);
  moveVelocity.lerp(targetVelocity, blend);

  if (moveVelocity.lengthSq() < 0.0004) {
    moveVelocity.set(0, 0, 0);
    return false;
  }

  camera.position.addScaledVector(moveVelocity, deltaSeconds);
  controls.target.addScaledVector(moveVelocity, deltaSeconds);
  controls.update();
  return true;
}

// Persist the camera a few times a second while it is being moved (and on
// page hide) instead of writing to storage on every single frame.
let cameraSaveCooldown = 0;
function updateCameraMemory(deltaSeconds) {
  cameraSaveCooldown += deltaSeconds;
  if (cameraSaveCooldown < 0.6) return;
  cameraSaveCooldown = 0;
  saveCameraState();
  if (johnTravel || carTrip) saveGameProgress();
}

// Unified Animation Loop
let lastCropDay = '';
let lastMapDraw = 0;
let lastLabHudDraw = 0;
function animateScene(now) {
  const deltaSeconds = Math.min((now - lastTickTime) / 1000, 0.06);
  lastTickTime = now;

  updateHomeTransition(now);
  updateNightRoutine(now, getGameDate(), deltaSeconds);
  updateFarmerJohn(now);
  updateSoilStudy(now,deltaSeconds);
  if (now - lastLabHudDraw > 1000 && Number.isFinite(soilStudy.submittedAt) && !soilStudy.mailRead) { lastLabHudDraw = now; refreshSoilStudyHud(); }
  if (!johnSleeping) { updatePlotWork(now); updateCleanupWork(now); }
  updateDirtMound();
  if (energy < 100 && !johnSleeping && !cleanupWork && !activeWork.size && getGameDate().getUTCHours() < 22) {
    const before = Math.floor(energy);
    energy = Math.min(100, energy + deltaSeconds * 0.55);
    if (Math.floor(energy) !== before) updateEnergy();
  }
  positionPlotActionMenu();
  updateDaylight();
  const gameDay = getGameDate().toISOString().slice(0, 10);
  if (gameDay !== lastCropDay) {
    lastCropDay = gameDay;
    updateCropVisuals();
    refreshStatus();
  }
  if (!reducedMotion.matches) updateChimneySmoke(deltaSeconds);
  if (rain.visible && !reducedMotion.matches) updateRain(deltaSeconds);
  if (updateCameraMovement(deltaSeconds)) {
    if (rain.visible) updateRain(0);
  }
  updateCameraMemory(deltaSeconds);
  if (!document.querySelector('#farmhouse-modal')?.hidden && !document.querySelector('#tab-map-panel')?.hidden && now - lastMapDraw > 150) {
    lastMapDraw = now;
    updateFarmMap();
  }
  render();
  requestAnimationFrame(animateScene);
}
requestAnimationFrame(animateScene);

// ==========================================================================
// WHEAT SEEDLING GROWTH
// ==========================================================================

function addWheatSeedlings(index, animateGrowth = true) {
  if (blockedPlots.has(index)) return;
  if (wheatGroups[index]) return;
  const { x, z } = plotPositions[index];
  const cluster = new THREE.Group();
  cluster.position.set(x, groundHeight(x, z) + 0.16, z);
  if (fieldBounds) cluster.scale.set((fieldBounds.maxX - fieldBounds.minX) / COLUMNS / 1.22, 1, (fieldBounds.maxZ - fieldBounds.minZ) / ROWS / 1.22);
  const offsets = [
    [-0.24, -0.19, 0.48], [0.22, -0.18, 0.56], [0, 0.04, 0.63],
    [-0.22, 0.25, 0.52], [0.24, 0.24, 0.49],
  ];
  for (const [stemX, stemZ, height] of offsets) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.032, height, 5), stemMaterial);
    stem.position.set(stemX, height / 2, stemZ);
    stem.castShadow = true;
    cluster.add(stem);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.19, 5), headMaterial);
    head.position.set(stemX, height + 0.06, stemZ);
    head.castShadow = true;
    cluster.add(head);

    for (const direction of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.3, 3), leafMaterial);
      leaf.position.set(stemX + direction * 0.1, height * 0.46, stemZ);
      leaf.rotation.z = direction * -1.08;
      leaf.castShadow = true;
      cluster.add(leaf);
    }
  }
  scene.add(cluster);
  wheatGroups[index] = cluster;

  if (!animateGrowth) {
    updateCropVisuals();
    render();
    return;
  }
  if (reducedMotion.matches) {
    render();
    return;
  }
  const start = performance.now();
  function animate(now) {
    const progress = Math.min((now - start) / 320, 1);
    cluster.scale.y = 0.02 + 0.98 * (1 - (1 - progress) ** 3);
    render();
    if (progress < 1) requestAnimationFrame(animate);
    else updateCropVisuals();
  }
  cluster.scale.y = 0.02;
  requestAnimationFrame(animate);
}

function updateCropVisuals() {
  const date = getGameDate();
  const phase = farmPhase(date);
  const height = {
    drilling: 0.2, establishing: 0.34, dormant: 0.34,
    tillering: 0.58, 'stem-extension': 0.8, flowering: 1,
    ripening: 1.08, 'harvest-prep': 1.08,
  }[phase];
  for (const group of wheatGroups) if (group) group.scale.y = height;
  const year = date.getUTCFullYear();
  const ripenStart = Date.UTC(year, 5, 15);
  const ripenEnd = Date.UTC(year, 6, 20);
  const gold = date.getUTCMonth() >= 8 ? 0 : THREE.MathUtils.clamp((date.getTime() - ripenStart) / (ripenEnd - ripenStart), 0, 1);
  stemMaterial.color.copy(new THREE.Color(0x4a8c54)).lerp(new THREE.Color(0xc8a654), gold);
  leafMaterial.color.copy(new THREE.Color(0x6fae63)).lerp(new THREE.Color(0xd8ba6e), gold);
  headMaterial.color.copy(new THREE.Color(0x79ad64)).lerp(new THREE.Color(0xe7c261), gold);
}

// ==========================================================================
// VIEWPORT & RESIZE
// ==========================================================================

let fittedDistance = null;
// A remembered camera keeps its own zoom distance. If the very first resize
// arrives before the canvas has been measured (fittedDistance still null), the
// restored distance must be kept instead of being snapped to the fit distance.
let cameraStateRestored = false;
function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const aspect = width / height;
  const fit = Math.max(13, 12.2 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect));
  const distance = fittedDistance === null
    ? (cameraStateRestored
      ? THREE.MathUtils.clamp(controls.getDistance(), controls.minDistance, controls.maxDistance)
      : fit)
    : THREE.MathUtils.clamp((controls.getDistance() * fit) / fittedDistance, controls.minDistance, controls.maxDistance);
  fittedDistance = fit;
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  controls.update();
  renderer.setSize(width, height, false);
  render();
}
new ResizeObserver(resize).observe(canvas);

// ==========================================================================
// INTERACTION & RAYCASTING (PLOTS + FARMHOUSE CLICK)
// ==========================================================================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const plotActionMenu = document.querySelector('#plot-action-menu');
const onboarding = document.querySelector('#farm-onboarding');
const placementPanel = document.querySelector('#field-placement');
const placementStatus = document.querySelector('#placement-status');
const placementConfirm = document.querySelector('#placement-confirm');
let placementMode = false;
let placementStart = null;
let pendingFieldBounds = null;
const placementSurface = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0x81a75e, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
);
placementSurface.rotation.x = -Math.PI / 2;
placementSurface.visible = false;
scene.add(placementSurface);
const placementEdge = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffe69a, linewidth: 2, depthTest: false }),
);
placementEdge.visible = false;
scene.add(placementEdge);
const placementGrid = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffe6a3, depthTest: false }),
);
placementGrid.visible = false;
scene.add(placementGrid);
const zoningPoints = [];
const zoningColors = [];
for (let x = RANCH.minX; x <= RANCH.maxX + 0.01; x += CELL_SIZE) {
  for (let z = RANCH.minZ; z < RANCH.maxZ; z += 0.3) {
    const end = Math.min(RANCH.maxZ, z + 0.3);
    zoningPoints.push(new THREE.Vector3(x, groundHeight(x, z) + 0.14, z), new THREE.Vector3(x, groundHeight(x, end) + 0.14, end));
    const color = Math.abs(groundHeight(x, end) - groundHeight(x, z)) > 0.06 ? new THREE.Color(0xe7a65f) : new THREE.Color(0xe5e1a6);
    zoningColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
}
for (let z = RANCH.minZ; z <= RANCH.maxZ + 0.01; z += CELL_SIZE) {
  for (let x = RANCH.minX; x < RANCH.maxX; x += 0.3) {
    const end = Math.min(RANCH.maxX, x + 0.3);
    zoningPoints.push(new THREE.Vector3(x, groundHeight(x, z) + 0.14, z), new THREE.Vector3(end, groundHeight(end, z) + 0.14, z));
    const color = Math.abs(groundHeight(end, z) - groundHeight(x, z)) > 0.06 ? new THREE.Color(0xe7a65f) : new THREE.Color(0xe5e1a6);
    zoningColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
}
const zoningGeometry = new THREE.BufferGeometry().setFromPoints(zoningPoints);
zoningGeometry.setAttribute('color', new THREE.Float32BufferAttribute(zoningColors, 3));
const zoningGrid = new THREE.LineSegments(zoningGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthTest: false }));
zoningGrid.visible = false;
scene.add(zoningGrid);

function groundFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(ranchGround, false)[0]?.point
    ?? raycaster.intersectObject(terrain, false)[0]?.point
    ?? null;
}

function updatePlacementPreview(from, to) {
  const edge = (value) => RANCH.minX + Math.floor((value - RANCH.minX) / CELL_SIZE) * CELL_SIZE;
  const startX = edge(from.x), endX = edge(to.x);
  const startZ = edge(from.z), endZ = edge(to.z);
  const bounds = { minX: Math.min(startX, endX), maxX: Math.max(startX, endX) + CELL_SIZE, minZ: Math.min(startZ, endZ), maxZ: Math.max(startZ, endZ) + CELL_SIZE };
  const valid = fieldAreaIsValid(bounds);
  const columns = Math.round((bounds.maxX - bounds.minX) / CELL_SIZE);
  const rows = Math.round((bounds.maxZ - bounds.minZ) / CELL_SIZE);
  const plan = valid ? cleanupPlan(bounds, columns, rows) : null;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const y = groundHeight(cx, cz) + 0.25;
  placementSurface.position.set(cx, y, cz);
  placementSurface.scale.set(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);
  placementSurface.material.color.setHex(valid ? 0x8fba65 : 0xca795b);
  placementSurface.visible = false;
  placementEdge.geometry.dispose();
  placementEdge.visible = false;
  const gridPoints = [];
  const addLine = (ax, az, bx, bz) => {
    const length = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < length; d += 0.25) {
      const end = Math.min(length, d + 0.25);
      for (const distance of [d, end]) {
        const x = ax + (bx - ax) * distance / length;
        const z = az + (bz - az) * distance / length;
        gridPoints.push(new THREE.Vector3(x, groundHeight(x, z) + 0.2, z));
      }
    }
  };
  for (let part = 0; part <= columns; part += 1) {
    const x = bounds.minX + part * CELL_SIZE;
    addLine(x, bounds.minZ, x, bounds.maxZ);
  }
  for (let part = 0; part <= rows; part += 1) {
    const z = bounds.minZ + part * CELL_SIZE;
    addLine(bounds.minX, z, bounds.maxX, z);
  }
  placementGrid.geometry.dispose();
  placementGrid.geometry = new THREE.BufferGeometry().setFromPoints(gridPoints);
  placementGrid.material.color.setHex(valid ? 0xffe6a3 : 0xee886b);
  placementGrid.visible = true;
  pendingFieldBounds = valid ? bounds : null;
  if (placementConfirm) placementConfirm.disabled = !valid;
  const blockedCount = Array.from({ length: columns * rows }, (_, index) => {
    const x = bounds.minX + (index % columns + 0.5) * CELL_SIZE;
    const z = bounds.minZ + (Math.floor(index / columns) + 0.5) * CELL_SIZE;
    return cellBlockedByTree(x, z);
  }).filter(Boolean).length;
  if (placementStatus) placementStatus.textContent = valid
    ? `${columns} × ${rows} crop cells · ${blockedCount} tree-blocked cells stay empty · ${plan.rocks.length} stones · ${plan.high.length} high and ${plan.low.length} low patches. About ${(plan.rocks.length + plan.high.length + Math.min(plan.high.length, plan.low.length)) * 2} coins and ${(plan.rocks.length + plan.high.length + Math.min(plan.high.length, plan.low.length)) * 4 + (plan.high.length ? 2 : 0)} seconds of work.${plan.low.length > plan.high.length ? ` ${plan.low.length - plan.high.length} low spots may remain.` : ''}`
    : 'Draw 2–6 cells per side inside the ranch boundary, clear of the house. Tree cells stay empty.';
}

function beginFieldPlacement() {
  onboarding.hidden = true;
  placementPanel.hidden = false;
  placementMode = true;
  document.querySelector('.farm')?.classList.add('is-placing');
  controls.enabled = false;
  zoningGrid.visible = true;
  controls.minPolarAngle = THREE.MathUtils.degToRad(25);
  transitionCamera(new THREE.Vector3(0, -0.18, 0), new THREE.Vector3(13, 22, 16));
  canvas.style.cursor = 'crosshair';
}

function showOnboarding() {
  if (fieldBounds) return;
  setGamePaused(true);
  onboarding.hidden = false;
  placementPanel.hidden = true;
  document.querySelector('#onboarding-start')?.focus();
}

document.querySelector('#onboarding-start')?.addEventListener('click', beginFieldPlacement);
canvas.addEventListener('pointerdown', (event) => {
  if (!placementMode || event.button !== 0) return;
  event.stopImmediatePropagation();
  placementStart = groundFromPointer(event);
  if (placementStart) canvas.setPointerCapture(event.pointerId);
}, true);
canvas.addEventListener('pointermove', (event) => {
  if (!placementMode) return;
  event.stopImmediatePropagation();
  if (placementStart) {
    const current = groundFromPointer(event);
    if (current) updatePlacementPreview(placementStart, current);
  }
}, true);
canvas.addEventListener('pointerup', (event) => {
  if (!placementMode) return;
  event.stopImmediatePropagation();
  if (placementStart) {
    const current = groundFromPointer(event);
    if (current) updatePlacementPreview(placementStart, current);
    placementStart = null;
  }
}, true);
canvas.addEventListener('click', (event) => { if (placementMode) event.stopImmediatePropagation(); }, true);
placementConfirm?.addEventListener('click', () => {
  if (!pendingFieldBounds) return;
  const bounds = pendingFieldBounds;
  placementMode = false;
  placementPanel.hidden = true;
  document.querySelector('.farm')?.classList.remove('is-placing');
  placementSurface.visible = false;
  placementEdge.visible = false;
  placementGrid.visible = false;
  zoningGrid.visible = false;
  controls.minPolarAngle = THREE.MathUtils.degToRad(25);
  controls.enabled = true;
  placeField(bounds);
  refreshSoilStudyHud();
  setGamePaused(false);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const target = new THREE.Vector3(cx, groundHeight(cx, cz), cz);
  transitionCamera(target, target.clone().add(new THREE.Vector3(7, 10, 13)));
  canvas.style.cursor = 'grab';
  status.textContent = cleanupReady() ? 'Plan soil sampling in the soil study card.' : 'Follow the highlighted cleanup tasks in the ground panel.';
  updateCanvasLabel();
  updateHelpText();
  updateFieldLedger();
  saveGameProgress();
});
const plotActions = [
  ['clear', 'Clear field'],
  ['test', 'Test soil'],
  ['cultivate', 'Cultivate'],
  ['drill', 'Drill wheat'],
  ['protect', 'Control pests'],
  ['fertilize', 'Apply fertiliser'],
  ['treat', 'Treat crop'],
  ['harvest', 'Harvest'],
];
const actionSeason = { clear: 'Jul–Aug', test: 'Jul–Aug', cultivate: 'Jul–Aug', drill: 'Sep–Oct', protect: 'Oct–Nov', fertilize: 'Feb–Mar', treat: 'May–Jun', harvest: 'From Jul 20' };
const actionSupply = { drill: 'seed', fertilize: 'fertiliser', treat: 'treatment' };
const actionDurations = { clear: 3000, test: 2400, cultivate: 3600, drill: 3200, protect: 2500, fertilize: 2800, treat: 2800, harvest: 4000 };
const activeWork = new Map();
const plotCooldownUntil = new Array(PLOT_COUNT).fill(0);
const plotStopwatch = document.querySelector('#plot-stopwatch');
const plotStopwatchTime = document.querySelector('#plot-stopwatch-time');
let lastLateNoticeDay = '';

function putJohnToBed(now) {
  if (johnSleeping) return;
  if (cleanupWork) {
    pendingJobs.push({ kind: 'cleanup', taskKind: cleanupWork.kind, id: cleanupWork.id });
    cleanupWork = null;
    temporaryTerrainEdit = null;
    refreshRanchTerrain();
  }
  for (const [index, work] of activeWork) {
    pendingJobs.push({ kind: 'plot', index, action: work.action });
    scene.remove(work.effect);
    work.effect.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  }
  activeWork.clear();
  johnSleeping = true;
  sleepWakeAt = now + 3600;
  const bedtime = getGameDate();
  sleepMorningAt = Date.UTC(bedtime.getUTCFullYear(), bedtime.getUTCMonth(), bedtime.getUTCDate() + (bedtime.getUTCHours() >= 8 ? 1 : 0), 8);
  setGamePaused(true);
  sendJohnToPoint(-5.15, -3.05, 1400);
  if (plotStopwatch) plotStopwatch.hidden = true;
  status.textContent = pendingJobs.length ? 'John is going home to sleep. He will resume this job at 8 AM.' : 'John is going home to sleep until 8 AM.';
  updateEnergy();
  saveGameProgress();
}

function updateNightRoutine(now, date, deltaSeconds) {
  if (johnSleeping) {
    if (now > sleepWakeAt - 2000 && !johnTravel) farmerJohn.visible = false;
    if (now < sleepWakeAt) return;
    if (!document.querySelector('#pause-modal')?.hidden) return;
    advanceToMorning(sleepMorningAt);
    sleepMorningAt = null;
    setGamePaused(false);
    johnSleeping = false;
    farmerJohn.position.set(-5.15, groundHeight(-5.15, -3.05), -3.05);
    farmerJohn.visible = true;
    energy = 100;
    updateEnergy();
    status.textContent = pendingJobs.length ? 'John is rested and returning to his unfinished work.' : 'John is rested and ready for a new day.';
    saveGameProgress();
    return;
  }
  if (['driving-out', 'lab-arrived', 'ready-to-return', 'driving-back'].includes(soilStudy.phase)) return;
  const hour = date.getUTCHours();
  const hasWork = Boolean(cleanupWork || activeWork.size || ['sampling', 'to-car'].includes(soilStudy.phase));
  if (hour >= 22 && hasWork) {
    const day = date.toISOString().slice(0, 10);
    if (lastLateNoticeDay !== day) { status.textContent = 'It is past 10 PM. John is tiring quickly and needs sleep.'; lastLateNoticeDay = day; }
    energy = Math.max(0, energy - deltaSeconds * 10);
    updateEnergy();
  }
  if ((hour >= 22 && !hasWork) || (hour < 8 && fieldBounds) || (hasWork && energy <= 0)) putJohnToBed(now);
  if (!johnSleeping && pendingJobs.length && !hasWork && hour >= 8 && hour < 22) {
    const job = pendingJobs.shift();
    if (job.kind === 'cleanup' && ['rock', 'high', 'low'].includes(job.taskKind) && Number.isInteger(job.id)) startCleanupWork(job.taskKind, job.id);
    if (job.kind === 'plot' && Number.isInteger(job.index) && typeof job.action === 'string') startPlotWork(job.index, job.action);
    saveGameProgress();
  }
}

function startCleanupWork(kind, id) {
  if (johnSleeping) { status.textContent = 'John is asleep until 8 AM.'; return; }
  if (!cleanup || cleanupReady() || cleanupWork || activeWork.size) return;
  if (kind !== 'rock' && cleanup.rocks.some((rockId) => !cleanup.removed.includes(rockId))) { status.textContent = 'Move the field stones before grading the ground.'; return; }
  if (kind === 'low' && cleanup.high.some((patchId) => !cleanup.dug.includes(patchId))) { status.textContent = 'Dig the high ground before filling low patches.'; return; }
  if (kind === 'rock' && (!cleanup.rocks.includes(id) || cleanup.removed.includes(id))) return;
  if (kind === 'high' && (!cleanup.high.includes(id) || cleanup.dug.includes(id))) return;
  if (kind === 'low' && (!cleanup.low.includes(id) || cleanup.filled.includes(id))) return;
  if (kind === 'low' && cleanup.dirt < 1) { status.textContent = 'John needs soil from a high patch before filling this hollow.'; return; }
  const cost = 2;
  if (coins < cost) { status.textContent = `This cleanup job needs ${cost} coins.`; return; }
  if (energy < 8) { status.textContent = 'John needs to rest before doing more cleanup. His energy recovers over time.'; return; }
  const [x, z] = kind === 'rock' ? ROCK_POSITIONS[id] : [plotPositions[id].x, plotPositions[id].z];
  const fetchShovel = kind !== 'rock' && !cleanup.shovel;
  cleanupWork = { kind, id, x, z, started: performance.now(), duration: fetchShovel ? 6200 : 3900, fetchShovel, fetched: false, cost };
  playSound('work');
  if (fetchShovel) {
    sendJohnToPoint(-5.4, -3.2, 1700);
    status.textContent = 'Farmer John is fetching a shovel from the house.';
  } else {
    sendJohnToPoint(x - 0.35, z + 0.35, 2400);
    status.textContent = kind === 'rock' ? 'Farmer John is carrying away a stone.' : kind === 'high' ? 'Farmer John is digging the high ground.' : 'Farmer John is filling a low patch.';
  }
}

function updateCleanupWork(now) {
  if (!cleanupWork) return;
  const work = cleanupWork;
  const elapsed = now - work.started;
  if (work.kind !== 'rock' && elapsed > (work.fetchShovel ? 4300 : 2400)) {
    const progress = THREE.MathUtils.clamp((elapsed - (work.fetchShovel ? 4300 : 2400)) / (work.duration - (work.fetchShovel ? 4300 : 2400)), 0, 1);
    temporaryTerrainEdit = { x: work.x, z: work.z, delta: (work.kind === 'high' ? -0.18 : 0.18) * progress };
    if (now - lastTerrainRefresh > 80) { refreshRanchTerrain(); lastTerrainRefresh = now; }
  }
  if (work.fetchShovel && !work.fetched && elapsed > 1900) {
    work.fetched = true;
    cleanup.shovel = true;
    johnShovel.visible = true;
    sendJohnToPoint(work.x - 0.35, work.z + 0.35, 2400);
    status.textContent = 'John has the shovel. He is heading to the marked ground.';
  }
  if (plotStopwatch) {
    plotStopwatch.hidden = false;
    plotStopwatchTime.textContent = `${Math.max(0, (work.duration - elapsed) / 1000).toFixed(1)}s`;
    plotStopwatch.style.setProperty('--timer-progress', `${Math.round(100 * elapsed / work.duration)}%`);
    const projected = new THREE.Vector3(work.x, groundHeight(work.x, work.z) + 0.85, work.z).project(camera);
    const rect = canvas.getBoundingClientRect();
    plotStopwatch.style.left = `${THREE.MathUtils.clamp((projected.x + 1) * rect.width / 2, 50, rect.width - 50)}px`;
    plotStopwatch.style.top = `${THREE.MathUtils.clamp((1 - projected.y) * rect.height / 2 - 30, 100, rect.height - 65)}px`;
  }
  if (elapsed < work.duration) return;
  cleanupWork = null;
  temporaryTerrainEdit = null;
  if (plotStopwatch) plotStopwatch.hidden = true;
  coins -= work.cost;
  energy = Math.max(0, energy - 8);
  if (work.kind === 'rock') cleanup.removed.push(work.id);
  else if (work.kind === 'high') { cleanup.dug.push(work.id); cleanup.dirt += 1; terrainEdits.push({ x: work.x, z: work.z, delta: -0.18 }); }
  else { cleanup.filled.push(work.id); cleanup.dirt -= 1; terrainEdits.push({ x: work.x, z: work.z, delta: 0.18 }); }
  playSound('success');
  if (work.kind !== 'rock') refreshRanchTerrain();
  spreadExcessDirt();
  updateCoins();
  updateEnergy();
  if (work.kind === 'rock') { refreshWorkedGroundPatches(); refreshCleanupVisuals(); }
  else placeField(fieldBounds, cleanup);
  updateFarmMap();
  status.textContent = cleanupReady() ? 'Ground cleanup is complete. Use the soil study card to plan sampling.' : 'Cleanup progress saved. Click the next highlighted area.';
  refreshSoilStudyHud();
  saveGameProgress();
}
let openPlotIndex = null;
let hoveredPlotIndex = -1;
let selectedIndex = 0;
let keyboardFocus = false;
let activePointer = null;
let dragged = false;
let suppressClick = false;

function pickTarget(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);

  // Interactive objects take priority; the ground is the fallback destination.
  const targets = fieldBounds && !cleanupReady()
    ? [mailboxHitbox, houseHitbox, ...cleanup.rocks.filter((id) => !cleanup.removed.includes(id)).map((id) => cleanupRocks[id]), ...cleanupPatches]
    : fieldBounds ? [mailboxHitbox, houseHitbox, ...plotMeshes.slice(0, PLOT_COUNT)] : [mailboxHitbox, houseHitbox];
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) {
    const ground = raycaster.intersectObject(ranchGround, false)[0]
      ?? raycaster.intersectObject(terrain, false)[0];
    return ground ? { type: 'ground', point: ground.point } : null;
  }

  const first = hits[0].object;
  if (first === mailboxHitbox) return { type: 'mailbox' };
  if (first.userData.isFarmhouse) {
    return { type: 'farmhouse' };
  }
  if (first.userData.cleanupRock !== undefined) return { type: 'cleanup', kind: 'rock', id: first.userData.cleanupRock };
  if (first.userData.cleanupKind) return { type: 'cleanup', kind: first.userData.cleanupKind, id: first.userData.cleanupId };
  if (first.userData.plotIndex !== undefined) {
    return { type: 'plot', index: first.userData.plotIndex };
  }
  return null;
}

function summonJohnToGround(point) {
  if (johnSleeping) { status.textContent = 'John is asleep until 8 AM.'; return; }
  if (['sampling', 'to-car', 'driving-out', 'lab-arrived', 'ready-to-return', 'driving-back'].includes(soilStudy.phase)) { status.textContent = 'John is busy with the soil samples.'; return; }
  if (cleanupWork || activeWork.size || pendingJobs.length) { status.textContent = 'John will be free to walk after his current job.'; return; }
  const distance = Math.hypot(point.x - farmerJohn.position.x, point.z - farmerJohn.position.z);
  if (distance < 0.4) { status.textContent = 'Farmer John is already at that spot.'; return; }
  sendJohnToPoint(point.x, point.z, THREE.MathUtils.clamp(distance / 2 * 1000, 500, 30000), 'summoned');
  status.textContent = 'Farmer John is walking to the spot you chose.';
}

function positionPlotActionMenu() {
  if (openPlotIndex === null || !plotActionMenu || plotActionMenu.hidden) return;
  const { x, z } = plotPositions[openPlotIndex];
  const projected = new THREE.Vector3(x, groundHeight(x, z) + 0.4, z).project(camera);
  const farm = document.querySelector('.farm');
  const farmBounds = farm.getBoundingClientRect();
  const canvasBounds = canvas.getBoundingClientRect();
  const screenX = canvasBounds.left - farmBounds.left + (projected.x + 1) * canvasBounds.width / 2;
  const screenY = canvasBounds.top - farmBounds.top + (1 - projected.y) * canvasBounds.height / 2;
  const width = plotActionMenu.offsetWidth;
  const height = plotActionMenu.offsetHeight;
  plotActionMenu.style.left = `${THREE.MathUtils.clamp(screenX, width / 2 + 8, farmBounds.width - width / 2 - 8)}px`;
  plotActionMenu.style.top = `${Math.max(height + 8, screenY - 14)}px`;
}

function closePlotActionMenu(returnFocus = false) {
  if (!plotActionMenu || plotActionMenu.hidden) return;
  plotActionMenu.hidden = true;
  openPlotIndex = null;
  if (returnFocus) canvas.focus({ preventScroll: true });
}

function openPlotActionMenu(index) {
  if (!fieldBounds || !cleanupReady() || !Number.isInteger(index) || index < 0 || index >= PLOT_COUNT) return;
  openPlotIndex = index;
  if (blockedPlots.has(index)) {
    plotActionMenu.setAttribute('aria-label', `Plot ${index + 1} blocked by a tree`);
    plotActionMenu.innerHTML = `<div class="plot-action-header"><strong>Plot ${index + 1}</strong><button type="button" class="plot-action-close" aria-label="Close plot actions">×</button></div><p class="plot-action-note">A standing tree occupies this crop cell. It will stay empty until the farm has tree-removal equipment.</p>`;
    plotActionMenu.hidden = false;
    positionPlotActionMenu();
    plotActionMenu.querySelector('.plot-action-close')?.focus({ preventScroll: true });
    return;
  }
  const rawAvailable = allowedAction(getGameDate(), plotStates[index], plotCare[index]);
  const available = soilWorkBlocked() || (rawAvailable === 'test' && !soilStudy.mailRead) ? null : rawAvailable;
  const missionBusy = ['sampling', 'to-car', 'driving-out', 'lab-arrived', 'ready-to-return', 'driving-back'].includes(soilStudy.phase);
  const supply = actionSupply[available];
  const needsStock = supply && inventory[supply] < 1;
  const work = activeWork.get(index);
  const cooldown = Math.max(0, plotCooldownUntil[index] - performance.now());
  const note = soilWorkBlocked() ? 'A soil reading is outside the workable range. The field cannot be worked.'
    : missionBusy ? 'John is collecting and delivering the field soil samples.'
    : rawAvailable === 'test' && !soilStudy.mailRead ? 'The field soil report must arrive by mail before cultivation.'
    : johnSleeping ? 'John is asleep until 8 AM.'
    : work ? 'Farmer John is working on this plot.'
    : cooldown ? 'Farmer John is getting ready for the next task.'
      : needsStock ? 'Buy supplies in the farmhouse shop before doing this work.'
        : available ? 'Choose the available field action.' : phaseMessage(getGameDate());
  const state = plotStates[index];
  const care = plotCare[index];
  const completed = new Set();
  const stage = [PLOT_STATE.WEEDY, PLOT_STATE.CLEARED, PLOT_STATE.TESTED, PLOT_STATE.CULTIVATED, PLOT_STATE.PLANTED, PLOT_STATE.HARVESTED].indexOf(state);
  for (const [action, threshold] of [['clear', 1], ['test', 2], ['cultivate', 3], ['drill', 4]]) if (stage >= threshold) completed.add(action);
  if (care.protected) completed.add('protect');
  if (care.fertilized) completed.add('fertilize');
  if (care.treated) completed.add('treat');
  if (state === PLOT_STATE.HARVESTED) completed.add('harvest');
  plotActionMenu.setAttribute('aria-label', `Plot ${index + 1} actions`);
  plotActionMenu.innerHTML = `<div class="plot-action-header"><strong>Plot ${index + 1}</strong><button type="button" class="plot-action-close" aria-label="Close plot actions">×</button></div><p class="plot-action-state">${describePlotState(index)}</p><div class="plot-action-grid">${plotActions.map(([action, label]) => {
    const done = completed.has(action);
    const ready = action === available && !missionBusy && !johnSleeping && !work && !cooldown && !needsStock;
    const className = done ? 'is-complete' : ready ? 'is-available' : action === available && needsStock ? 'needs-supply' : 'is-future';
    const hint = done ? 'Done' : soilWorkBlocked() ? 'Field on hold' : action === 'test' && !soilStudy.mailRead ? 'Await report' : ready ? 'Do now' : action === available && needsStock ? 'Need supplies' : actionSeason[action];
    return `<button type="button" class="${className}" data-action="${action}" title="${hint}" ${ready ? '' : 'disabled'}><span class="action-label">${label}</span><small>${hint}</small></button>`;
  }).join('')}</div><p class="plot-action-note">${note}</p>`;
  plotActionMenu.hidden = false;
  positionPlotActionMenu();
  (plotActionMenu.querySelector('button[data-action]:not([disabled])') || plotActionMenu.querySelector('.plot-action-close'))?.focus({ preventScroll: true });
}

plotActionMenu?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.classList.contains('plot-action-close')) {
    closePlotActionMenu(true);
    return;
  }
  const index = openPlotIndex;
  const action = button.dataset.action;
  if (index !== null && action) startPlotWork(index, action);
});

function startPlotWork(index, action) {
  if (soilWorkBlocked()) { status.textContent = 'The soil report places this field on hold. Review it in Knowledge.'; playSound('error'); return; }
  if (blockedPlots.has(index) || johnSleeping || cleanupWork || activeWork.size) return;
  if (['sampling', 'to-car', 'driving-out', 'lab-arrived', 'ready-to-return', 'driving-back'].includes(soilStudy.phase) || (action === 'test' && !soilStudy.mailRead)) return;
  if (activeWork.has(index) || performance.now() < plotCooldownUntil[index]) return;
  if (!cleanupReady() || energy < 5) { status.textContent = energy < 5 ? 'Farmer John needs to rest before working another plot.' : 'Finish ground cleanup first.'; return; }
  if (allowedAction(getGameDate(), plotStates[index], plotCare[index]) !== action) return;
  const supply = actionSupply[action];
  if (supply && inventory[supply] < 1) return;
  const { x, z } = plotPositions[index];
  const effect = new THREE.Group();
  effect.position.set(x, groundHeight(x, z) + 0.28, z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.45, 32), new THREE.MeshBasicMaterial({ color: 0xf5d17d, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  effect.add(ring);
  for (let i = 0; i < 5; i += 1) {
    const mote = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), new THREE.MeshBasicMaterial({ color: 0xe8cb93, transparent: true, opacity: 0.45, depthWrite: false }));
    const angle = i * Math.PI * 2 / 5;
    mote.position.set(Math.cos(angle) * 0.31, 0.12, Math.sin(angle) * 0.31);
    effect.add(mote);
  }
  scene.add(effect);
  sendJohnToPlot(index, actionDurations[action]);
  activeWork.set(index, { action, started: performance.now(), duration: actionDurations[action], effect });
  playSound('work');
  status.textContent = `Working on plot ${index + 1}: ${plotActions.find(([key]) => key === action)?.[1]}.`;
  openPlotActionMenu(index);
}

function updatePlotWork(now) {
  for (const [index, work] of activeWork) {
    const progress = THREE.MathUtils.clamp((now - work.started) / work.duration, 0, 1);
    work.effect.rotation.y = progress * Math.PI * 2;
    work.effect.children[0].material.opacity = 0.3 + Math.sin(progress * Math.PI * 5) * 0.2;
    work.effect.children.slice(1).forEach((mote, i) => {
      mote.position.y = 0.1 + progress * 0.22 + Math.sin(progress * 12 + i) * 0.05;
      mote.material.opacity = (1 - progress) * 0.55;
    });
    if (progress < 1) continue;
    scene.remove(work.effect);
    work.effect.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    activeWork.delete(index);
    playSound('success');
    plotCooldownUntil[index] = now + 800;
    if (allowedAction(getGameDate(), plotStates[index], plotCare[index]) === work.action) handlePlotAction(index, work.action);
    else status.textContent = `The season changed before work on plot ${index + 1} finished.`;
    if (openPlotIndex === index) openPlotActionMenu(index);
    energy = Math.max(0, energy - 5);
    updateEnergy();
    saveGameProgress();
  }
  if (openPlotIndex !== null && !activeWork.has(openPlotIndex)) {
    const remaining = plotCooldownUntil[openPlotIndex] - now;
    if (remaining <= 0 && plotCooldownUntil[openPlotIndex] !== 0) {
      plotCooldownUntil[openPlotIndex] = 0;
      openPlotActionMenu(openPlotIndex);
    }
  }
  const running = activeWork.entries().next().value;
  const timerIndex = running?.[0] ?? (openPlotIndex !== null && plotCooldownUntil[openPlotIndex] > now ? openPlotIndex : null);
  if (plotStopwatch) {
    plotStopwatch.hidden = timerIndex === null;
    if (timerIndex !== null) {
      const remaining = running ? Math.max(0, (running[1].duration - (now - running[1].started)) / 1000) : Math.max(0, (plotCooldownUntil[timerIndex] - now) / 1000);
      if (plotStopwatchTime) plotStopwatchTime.textContent = `${remaining.toFixed(1)}s`;
      plotStopwatch.style.setProperty('--timer-progress', `${running ? Math.round((1 - remaining * 1000 / running[1].duration) * 100) : 100}%`);
      const { x, z } = plotPositions[timerIndex];
      const projected = new THREE.Vector3(x, groundHeight(x, z) + 0.55, z).project(camera);
      const farmRect = document.querySelector('.farm').getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      plotStopwatch.style.left = `${THREE.MathUtils.clamp(canvasRect.left - farmRect.left + (projected.x + 1) * canvasRect.width / 2, 50, farmRect.width - 50)}px`;
      const projectedY = canvasRect.top - farmRect.top + (1 - projected.y) * canvasRect.height / 2;
      const menuBottom = openPlotIndex === timerIndex && !plotActionMenu.hidden ? Number.parseFloat(plotActionMenu.style.top) : -Infinity;
      plotStopwatch.style.top = `${Math.max(projectedY + 42, menuBottom + 40)}px`;
    }
  }
}

document.addEventListener('pointerdown', (event) => {
  if (openPlotIndex !== null && !plotActionMenu.contains(event.target)) closePlotActionMenu();
});
window.addEventListener('keydown', (event) => {
  if (openPlotIndex !== null && event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePlotActionMenu(true);
  }
}, true);
document.addEventListener('farmhouse-modal-open', () => closePlotActionMenu());
window.addEventListener('farm-hands:menu-open', () => closePlotActionMenu());

function updateHighlights() {
  for (let index = 0; index < PLOT_COUNT; index += 1) {
    const active = index === hoveredPlotIndex || (keyboardFocus && index === selectedIndex);
    const prepared = plotStates[index] === PLOT_STATE.CULTIVATED || plotStates[index] === PLOT_STATE.PLANTED;
    plotMaterials[index].color.setHex(active ? (prepared ? 0x9d6943 : 0xbd8052) : (prepared ? 0x774a32 : 0x945f3c));
    plotMaterials[index].emissive.setHex(active ? 0x38220b : 0x000000);
  }
  render();
}

function describePlotState(index) {
  const state = plotStates[index];
  if (state === PLOT_STATE.WEEDY) return 'overgrown with weeds';
  if (state === PLOT_STATE.CLEARED) return 'cleared, awaiting the field soil report';
  if (state === PLOT_STATE.TESTED) return 'soil tested, ready to cultivate';
  if (state === PLOT_STATE.CULTIVATED) return 'cultivated, ready to drill';
  if (state === PLOT_STATE.HARVESTED) return 'harvested, ready to clear';
  return 'planted with winter wheat';
}

function updateCanvasLabel() {
  if (!fieldBounds) {
    canvas.setAttribute('aria-label', 'Willow Creek Homestead. Meet Farmer John and draw a field to begin farming.');
    return;
  }
  const state = describePlotState(selectedIndex);
  const movementKeys = MOVE_ACTIONS.map((action) => bindingLabel(action)).join('');
  canvas.setAttribute(
    'aria-label',
    `3D wheat field. Plot ${selectedIndex + 1} of ${PLOT_COUNT} is ${state}. `
    + `Use ${movementKeys} to move camera, ${bindingSummary('selectUp')}/${bindingSummary('selectDown')}/`
    + `${bindingSummary('selectLeft')}/${bindingSummary('selectRight')} to select a plot, `
    + `${bindingSummary('plant')} to open plot actions. Click bare ground to send Farmer John there. Click the farmhouse or press ${bindingSummary('calendar')} `
    + `to view the journal, and press ${bindingSummary('openMenu')} for the menu, credits, and keybind settings.`
  );
}

function updateHelpText() {
  const helpEl = document.querySelector('#field-help');
  if (!helpEl) return;
  if (!fieldBounds) {
    helpEl.textContent = 'Meet Farmer John, then drag across the meadow to mark your first field.';
    return;
  }
  const movementKeys = MOVE_ACTIONS.map((action) => bindingLabel(action)).join('');
  helpEl.textContent = `After site cleanup, plan five points on alternating field edges, then send John to collect samples. Drive to the science center with W/S to accelerate and brake, and A/D to steer. Drag on the phone map for touch driving. Read the mailed report in the separate mailbox. Click or tap a plot for its seasonal field action. Click bare ground to send Farmer John there. Drag to rotate. Scroll or pinch to zoom. `
    + `Use ${movementKeys} to move the camera across the farm, `
    + `${bindingSummary('selectLeft')}/${bindingSummary('selectRight')}/${bindingSummary('selectUp')}/${bindingSummary('selectDown')} `
    + `to select a plot, and ${bindingSummary('plant')} to open plot actions. `
    + `Click the farmhouse or press ${bindingSummary('calendar')} to open the farming journal. `
    + `Press ${bindingSummary('openMenu')} for the menu, credits, and keybind settings.`;
}

function countState(state) {
  let count = 0;
  for (let index = 0; index < PLOT_COUNT; index += 1) {
    if (!blockedPlots.has(index) && plotStates[index] === state) count += 1;
  }
  return count;
}

function fieldSummary() {
  if (!fieldBounds) return 'No field allocated yet';
  return `${blockedPlots.size} tree-blocked · ${countState(PLOT_STATE.WEEDY)} weedy · ${countState(PLOT_STATE.CLEARED)} cleared · ${countState(PLOT_STATE.TESTED)} tested · ${countState(PLOT_STATE.CULTIVATED)} ready · ${countState(PLOT_STATE.PLANTED)} drilled · ${countState(PLOT_STATE.HARVESTED)} harvested`;
}

function updateFieldLedger() {
  const ledgerEl = document.querySelector('#farm-planted-count');
  if (ledgerEl) ledgerEl.textContent = fieldSummary();
  updateFarmMap();
}

function applyPlotVisual(index) {
  const state = plotStates[index];
  const ready = Boolean(fieldBounds) && index < PLOT_COUNT && cleanupReady();
  const usable = ready && !blockedPlots.has(index);
  if (plotMeshes[index]) {
    plotMeshes[index].visible = ready;
    plotMeshes[index].castShadow = usable && state !== PLOT_STATE.WEEDY;
  }
  if (ridgeGroups[index]) ridgeGroups[index].visible = usable && (state === PLOT_STATE.CULTIVATED || state === PLOT_STATE.PLANTED);
  if (weedGroups[index]) weedGroups[index].visible = usable && state === PLOT_STATE.WEEDY;
  if (plotMaterials[index]) {
    plotMaterials[index].color.setHex(state === PLOT_STATE.CULTIVATED || state === PLOT_STATE.PLANTED ? 0x774a32 : 0x945f3c);
    plotMaterials[index].transparent = !usable || state === PLOT_STATE.WEEDY;
    plotMaterials[index].opacity = !usable || state === PLOT_STATE.WEEDY ? 0 : 1;
    plotMaterials[index].depthWrite = usable && state !== PLOT_STATE.WEEDY;
  }
}

function refreshStatus() {
  status.textContent = !fieldBounds ? 'Help Farmer John choose a place for the first field.'
    : soilStudy.phase === 'mail-ready' ? 'Mail has arrived! Click the farmhouse mailbox for the soil report.' : '';
}

function clearWeeds(index) {
  if (allowedAction(getGameDate(), plotStates[index], plotCare[index]) !== 'clear') return;
  plotStates[index] = soilStudy.mailRead ? PLOT_STATE.TESTED : PLOT_STATE.CLEARED;
  plotCare[index] = {};
  applyPlotVisual(index);
  status.textContent = soilStudy.mailRead ? `Plot ${index + 1} cleared. The field soil report is ready; cultivate next.` : `Plot ${index + 1} cleared. Await the field soil report before cultivation.`;
  updateCanvasLabel();
  updateFieldLedger();
  saveGameProgress();
}

function testSoil(index) {
  if (!soilStudy.mailRead) return;
  if (allowedAction(getGameDate(), plotStates[index], plotCare[index]) !== 'test') return;
  plotStates[index] = PLOT_STATE.TESTED;
  status.textContent = `Soil tested in plot ${index + 1}. Cultivate the seedbed next.`;
  updateCanvasLabel();
  updateFieldLedger();
  saveGameProgress();
}

function cultivate(index) {
  if (allowedAction(getGameDate(), plotStates[index], plotCare[index]) !== 'cultivate') return;
  plotStates[index] = PLOT_STATE.CULTIVATED;
  applyPlotVisual(index);
  status.textContent = `Plot ${index + 1} cultivated — seedbed ready.`;
  updateCanvasLabel();
  updateFieldLedger();
  saveGameProgress();
}

function drillWheat(index) {
  if (allowedAction(getGameDate(), plotStates[index], plotCare[index]) !== 'drill') return;
  if (inventory.seed < 1) { status.textContent = 'No winter wheat seed remains in inventory.'; return; }
  inventory.seed -= 1;
  plotStates[index] = PLOT_STATE.PLANTED;
  plotCare[index] = { drilledYear: getGameDate().getUTCFullYear() };
  applyPlotVisual(index);
  addWheatSeedlings(index);
  const drilled = countState(PLOT_STATE.PLANTED);
  status.textContent = drilled === PLOT_COUNT - blockedPlots.size
    ? 'Every plot has winter wheat drilled.'
    : `Winter wheat drilled in plot ${index + 1}.`;
  updateCanvasLabel();
  updateFieldLedger();
  updateInventory();
  saveGameProgress();
}

function handlePlotAction(index, requestedAction = null) {
  if (!fieldBounds || !Number.isInteger(index) || index < 0 || index >= PLOT_COUNT) return;
  if (blockedPlots.has(index)) return;
  const action = allowedAction(getGameDate(), plotStates[index], plotCare[index]);
  if (requestedAction !== null && requestedAction !== action) return;
  if (action === 'clear') return clearWeeds(index);
  if (action === 'test') return testSoil(index);
  if (action === 'cultivate') return cultivate(index);
  if (action === 'drill') return drillWheat(index);
  if (action === 'protect') plotCare[index].protected = true;
  else if (action === 'fertilize') {
    if (!inventory.fertiliser) { status.textContent = 'No spring fertiliser remains in inventory.'; return; }
    inventory.fertiliser -= 1;
    plotCare[index].fertilized = true;
  } else if (action === 'treat') {
    if (!inventory.treatment) { status.textContent = 'No crop treatment remains in inventory.'; return; }
    inventory.treatment -= 1;
    plotCare[index].treated = true;
  } else if (action === 'harvest') {
    plotStates[index] = PLOT_STATE.HARVESTED;
    inventory.grain += 4;
    inventory.straw += 2;
    inventory.seed += 1; // Keep back enough seed for the next growing year.
    scene.remove(wheatGroups[index]);
    wheatGroups[index] = null;
    applyPlotVisual(index);
  } else {
    status.textContent = phaseMessage(getGameDate());
    return;
  }
  const labels = { protect: 'checked for weeds and pests', fertilize: 'given spring fertiliser', treat: 'treated during flowering', harvest: 'harvested' };
  status.textContent = `Plot ${index + 1} ${labels[action]}.`;
  updateCanvasLabel();
  updateFieldLedger();
  updateInventory();
  saveGameProgress();
}

function itemIcon(key) {
  const start = '<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">';
  const end = '</svg>';
  const art = {
    seed: '<path d="M18 37h44l-5 29H23z" fill="#b98651" stroke="#6b472b" stroke-width="3"/><path d="M19 37q21 8 42 0" fill="none" stroke="#e5bd79" stroke-width="4"/><path d="M40 47V17m0 20-12-14m12 9 13-13" stroke="#5f7538" stroke-width="3" fill="none"/><path d="M40 16l-4-7m4 7 4-7M28 23l-7-5m7 5-1-8m26 4 6-6m-6 6 2-8" stroke="#dcb45f" stroke-width="4" stroke-linecap="round"/>',
    fertiliser: '<path d="M21 18h38l4 47H17z" fill="#e6d9ad" stroke="#7d6847" stroke-width="3"/><path d="M21 27h38M24 53h32" stroke="#aa9368" stroke-width="3"/><path d="M41 49q-13-18 5-22 8 15-5 22z" fill="#72924f"/><path d="M40 49q2-15 13-18" stroke="#47683c" stroke-width="2" fill="none"/>',
    treatment: '<path d="M32 13h16v9H32z" fill="#6d785e" stroke="#455344" stroke-width="3"/><path d="M27 24h26l6 38H21z" fill="#76a08a" stroke="#405f56" stroke-width="3"/><path d="M27 38h26v13H27z" fill="#dfebd4"/><path d="M40 40v9m-5-5h10" stroke="#53715d" stroke-width="3"/>',
    grain: '<path d="M18 38h44l-6 28H24z" fill="#bd9057" stroke="#6b472b" stroke-width="3"/><path d="M23 45h34" stroke="#e7c386" stroke-width="3"/><path d="M33 34V15m7 19V10m8 24V17" stroke="#78944a" stroke-width="3"/><path d="M30 19l-4-5m8 3 4-6m1 8-5-5m8 1 4-5m1 12 5-5" stroke="#e4bd64" stroke-width="5" stroke-linecap="round"/>',
    straw: '<rect x="13" y="31" width="54" height="32" rx="5" fill="#d7aa57" stroke="#805c32" stroke-width="3"/><path d="M18 38h43M17 50h46M25 32v30m30-30v30" stroke="#f1d080" stroke-width="3"/><path d="M29 31v32m22-32v32" stroke="#6d4c2e" stroke-width="3"/>',
  };
  return `${start}${art[key] || ''}${end}`;
}

function updateInventory() {
  const container = document.querySelector('#farm-inventory');
  if (!container) return;
  const items = [...shopSupplies, ...sellableGoods].filter(({ key }) => inventory[key] > 0);
  container.innerHTML = items.length
    ? items.map(({ key, label, unit }) => `<div class="inventory-item" tabindex="0" role="img" aria-label="${label}: ${inventory[key]} ${unit}" title="${label}"><span class="inventory-art">${itemIcon(key)}</span><strong class="inventory-quantity">×${inventory[key]}</strong><span class="inventory-tooltip">${label} · ${unit}</span></div>`).join('')
    : '<p class="inventory-empty">Your inventory is empty.</p>';
  const shop = document.querySelector('#farm-shop');
  if (shop) {
    const buyRows = shopSupplies.map(({ key, label, price }) => `<div class="shop-row"><span class="shop-item-label"><span class="shop-item-art">${itemIcon(key)}</span>${label}</span><div class="shop-buttons"><button type="button" data-buy="${key}" data-count="1" ${coins < price ? 'disabled' : ''}>Buy 1 · ${price} coins</button><button type="button" data-buy="${key}" data-count="9" ${coins < price * 9 ? 'disabled' : ''}>Buy 9 · ${price * 9} coins</button><button type="button" data-sell="${key}" data-count="1" ${inventory[key] < 1 ? 'disabled' : ''}>Sell 1 · +${price} coins</button><button type="button" data-sell="${key}" data-count="9" ${inventory[key] < 9 ? 'disabled' : ''}>Sell 9 · +${price * 9} coins</button></div></div>`);
    const sellRows = sellableGoods.map(({ key, label, price }) => `<div class="shop-row"><span class="shop-item-label"><span class="shop-item-art">${itemIcon(key)}</span>${label}</span><div class="shop-buttons"><button type="button" data-sell="${key}" data-count="1" ${inventory[key] < 1 ? 'disabled' : ''}>Sell 1 · +${price} coins</button><button type="button" data-sell="${key}" data-count="9" ${inventory[key] < 9 ? 'disabled' : ''}>Sell 9 · +${price * 9} coins</button></div></div>`);
    shop.innerHTML = [...buyRows, ...sellRows].join('');
  }
}

function updateCoins() {
  const display = document.querySelector('#hud-coins');
  if (display) display.textContent = String(coins);
}

function updateEnergy() {
  const display = document.querySelector('#hud-energy');
  const fill = document.querySelector('#energy-fill');
  if (display) display.textContent = johnSleeping ? `${Math.round(energy)}% · asleep` : `${Math.round(energy)}%`;
  if (fill) fill.style.width = `${Math.round(energy)}%`;
}

document.querySelector('#farm-shop')?.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const buy = shopSupplies.find(({ key }) => key === button.dataset.buy);
  const sell = [...shopSupplies, ...sellableGoods].find(({ key }) => key === button.dataset.sell);
  if (buy) {
    const amount = Number(button.dataset.count);
    if (![1, 9].includes(amount) || coins < buy.price * amount) return;
    coins -= buy.price * amount;
    inventory[buy.key] += amount;
    status.textContent = `Bought ${amount} ${buy.label.toLowerCase()} for ${buy.price * amount} coins.`;
    playSound('success');
  } else if (sell) {
    const amount = Number(button.dataset.count);
    if (![1, 9].includes(amount) || inventory[sell.key] < amount) return;
    inventory[sell.key] -= amount;
    coins += sell.price * amount;
    status.textContent = `Sold ${amount} ${sell.label.toLowerCase()} for ${sell.price * amount} coins.`;
    playSound('success');
  } else return;
  updateInventory();
  updateCoins();
  if (soilStudy.phase === 'lab-arrived') refreshSoilStudyHud();
  saveGameProgress();
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  dragged = false;
  suppressClick = false;
});

canvas.addEventListener('pointermove', (event) => {
  if (
    activePointer?.id === event.pointerId &&
    Math.hypot(event.clientX - activePointer.x, event.clientY - activePointer.y) > 6
  ) {
    dragged = true;
  }
  if (dragged) {
    canvas.style.cursor = 'grabbing';
    if (hoveredPlotIndex !== -1) {
      hoveredPlotIndex = -1;
      updateHighlights();
    }
    return;
  }

  const target = pickTarget(event);
  if (target?.type === 'farmhouse') {
    canvas.style.cursor = 'pointer';
    if (hoveredPlotIndex !== -1) {
      hoveredPlotIndex = -1;
      updateHighlights();
    }
  } else if (target?.type === 'mailbox' || target?.type === 'cleanup') {
    canvas.style.cursor = 'pointer';
    if (hoveredPlotIndex !== -1) { hoveredPlotIndex = -1; updateHighlights(); }
  } else if (target?.type === 'plot') {
    canvas.style.cursor = 'pointer';
    if (target.index !== hoveredPlotIndex) {
      hoveredPlotIndex = target.index;
      updateHighlights();
    }
  } else if (target?.type === 'ground') {
    canvas.style.cursor = 'crosshair';
    if (hoveredPlotIndex !== -1) { hoveredPlotIndex = -1; updateHighlights(); }
  } else {
    canvas.style.cursor = 'grab';
    if (hoveredPlotIndex !== -1) {
      hoveredPlotIndex = -1;
      updateHighlights();
    }
  }
});

canvas.addEventListener('pointerleave', () => {
  hoveredPlotIndex = -1;
  canvas.style.cursor = 'grab';
  updateHighlights();
});

canvas.addEventListener('pointerup', (event) => {
  if (activePointer?.id === event.pointerId) {
    activePointer = null;
    suppressClick = dragged;
    dragged = false;
  }
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('pointercancel', () => {
  activePointer = null;
  dragged = false;
  suppressClick = false;
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('click', (event) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const target = pickTarget(event);
  if (target) playSound('click');
  if (soilStudy.phase === 'planning') {
    const ground = raycaster.intersectObject(ranchGround,false)[0] ?? raycaster.intersectObject(terrain,false)[0];
    if (ground) addSoilSamplePoint(ground.point);
    return;
  }
  if (!target) return;

  if (target.type === 'farmhouse') {
    updateFieldLedger();
    window.FarmCalendar?.openFarmhouseMenu?.();
    return;
  }

  if (target.type === 'mailbox') {
    readMailbox();
    return;
  }

  if (target.type === 'cleanup') {
    startCleanupWork(target.kind, target.id);
    return;
  }

  if (target.type === 'ground') {
    summonJohnToGround(target.point);
    return;
  }

  if (target.type === 'plot') {
    selectedIndex = target.index;
    canvas.focus({ preventScroll: true });
    openPlotActionMenu(target.index);
    focusPlot(target.index);
  }
});

canvas.addEventListener('focus', () => {
  keyboardFocus = true;
  updateCanvasLabel();
  updateHighlights();
});

canvas.addEventListener('blur', () => {
  keyboardFocus = false;
  updateHighlights();
});

canvas.addEventListener('keydown', (event) => {
  if (['driving-out','driving-back'].includes(soilStudy.phase)) return;
  if (pauseMenuIsOpen() || !fieldBounds || !cleanupReady()) return;
  let next = selectedIndex;
  if (eventMatches(event, 'selectLeft') && selectedIndex % COLUMNS > 0) next -= 1;
  else if (eventMatches(event, 'selectRight') && selectedIndex % COLUMNS < COLUMNS - 1) next += 1;
  else if (eventMatches(event, 'selectUp') && selectedIndex >= COLUMNS) next -= COLUMNS;
  else if (eventMatches(event, 'selectDown') && selectedIndex < PLOT_COUNT - COLUMNS) next += COLUMNS;
  else if (eventMatches(event, 'plant')) openPlotActionMenu(selectedIndex);
  else return;
  event.preventDefault();
  selectedIndex = next;
  updateCanvasLabel();
  updateHighlights();
});

window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
  if (pauseMenuIsOpen()) return;
  if (soilStudy.phase === 'driving-out' || soilStudy.phase === 'driving-back') {
    const drive = { w:'gas', ArrowUp:'gas', s:'brake', ArrowDown:'brake', a:'left', ArrowLeft:'left', d:'right', ArrowRight:'right' }[event.key];
    if (drive) { event.preventDefault(); driveKeys.add(drive); return; }
  }
  for (const action of MOVE_ACTIONS) {
    if (eventMatches(event, action)) {
      event.preventDefault();
      heldKeys.add(action);
      return;
    }
  }
});

window.addEventListener('keyup', (event) => {
  const drive = { w:'gas', ArrowUp:'gas', s:'brake', ArrowDown:'brake', a:'left', ArrowLeft:'left', d:'right', ArrowRight:'right' }[event.key];
  if (drive) driveKeys.delete(drive);
  for (const action of MOVE_ACTIONS) {
    if (eventMatches(event, action)) heldKeys.delete(action);
  }
});

// Clear held keys if the window loses focus so the camera never keeps drifting.
window.addEventListener('blur', () => heldKeys.clear());

// Re-render the on-screen/assistive hints whenever keys are rebound, and stop
// the camera if a rebind happens while a movement key is still held down.
onKeybindsChange(() => {
  heldKeys.clear();
  updateCanvasLabel();
  updateHelpText();
});

// The Escape menu pauses the farm and takes over the keyboard.
window.addEventListener('farm-hands:menu-open', () => heldKeys.clear());
window.addEventListener('farm-hands:menu-close', () => { if (!fieldBounds) setGamePaused(true); });
window.addEventListener('farm-hands:camera-memory-change', (event) => {
  setCameraMemoryEnabled(event.detail?.enabled !== false);
});
window.addEventListener('farm-hands:camera-reset', () => resetCameraToDefault());
window.addEventListener('farm-hands:plot-focus-change', (event) => setPlotFocusEnabled(event.detail?.enabled !== false));

// Remember the camera when the page is hidden or closed.
window.addEventListener('pagehide', () => { saveCameraState(true); saveGameProgress(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { saveCameraState(true); saveGameProgress(); }
});

// ==========================================================================
// FARM MAP (top-down map shown in the farmhouse modal)
// ==========================================================================

function updateFarmMap() {
  if (!mapContext) return;
  const { width, height } = mapCanvas;
  const ctx = mapContext;
  const sx = (x) => Math.round(width / 2 + (x - mapView.centerX) * mapView.zoom);
  const sy = (z) => Math.round(height / 2 + (z - mapView.centerZ) * mapView.zoom);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#a5bd79';
  ctx.fillRect(0, 0, width, height);
  // Sample the same terrain height used by the 3D world into chunky map tiles.
  for (let py = 0; py < height; py += 7) {
    for (let px = 0; px < width; px += 7) {
      const x = mapView.centerX + (px - width / 2) / mapView.zoom;
      const z = mapView.centerZ + (py - height / 2) / mapView.zoom;
      const h = groundHeight(x, z);
      const noise = Math.sin(x * 8.31 + z * 17.19) * Math.cos(z * 9.41 - x * 5.7);
      ctx.fillStyle = h > 6 ? '#ddd9b5' : h > 2 ? '#8caa70' : noise > 0.45 ? '#b9c98b' : noise < -0.55 ? '#98b773' : '#a8c482';
      ctx.fillRect(px, py, 7, 7);
    }
  }
  const square = (x, z, size, color) => { ctx.fillStyle = color; ctx.fillRect(sx(x) - size / 2, sy(z) - size / 2, size, size); };
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#f4e4b3';
  ctx.lineWidth = 2;
  ctx.strokeRect(sx(RANCH.minX), sy(RANCH.minZ), sx(RANCH.maxX) - sx(RANCH.minX), sy(RANCH.maxZ) - sy(RANCH.minZ));
  ctx.restore();
  ctx.strokeStyle = '#94714c';
  ctx.lineWidth = Math.max(3, mapView.zoom * 1.4);
  ctx.beginPath();
  for (let z = -3.85; z <= TOWN_Z; z += 0.65) {
    if (z === -3.85) ctx.moveTo(sx(roadCenter(z)), sy(z));
    else ctx.lineTo(sx(roadCenter(z)), sy(z));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx(roadCenter(TOWN_Z)), sy(TOWN_Z - 1.4));
  ctx.lineTo(sx(roadCenter(TOWN_Z) + 5.2), sy(TOWN_Z - 1.4));
  ctx.stroke();
  square(roadCenter(TOWN_Z) - 4.7, TOWN_Z, Math.max(12, mapView.zoom * 3), '#bcb08f');
  square(roadCenter(TOWN_Z) + 5.2, TOWN_Z, Math.max(12, mapView.zoom * 3), '#587b83');
  square(car.position.x, car.position.z, 7, '#985b43');
  for (const [x, z] of PINE_POSITIONS) {
    square(x, z, 12, '#335c39'); square(x, z - 0.3, 6, '#4d7d43');
  }
  for (const [x, z] of [[-10.7, -7.4], [3.8, -5.6]]) {
    square(x, z, 14, '#49783e'); square(x + 0.25, z - 0.2, 7, '#68964b');
  }
  ROCK_POSITIONS.forEach(([x, z], id) => { if (!cleanup?.removed?.includes(id)) square(x, z, 5, '#837f70'); });
  if (fieldBounds) {
    const x = sx(fieldBounds.minX), y = sy(fieldBounds.minZ);
    const w = sx(fieldBounds.maxX) - x, h = sy(fieldBounds.maxZ) - y;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#513a24';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    for (let index = 0; index < PLOT_COUNT; index += 1) {
      const px = sx(plotPositions[index].x), py = sy(plotPositions[index].z);
      const pw = Math.max(5, Math.floor(w / COLUMNS) - 3), ph = Math.max(5, Math.floor(h / ROWS) - 3);
      const colors = { weedy: '#648342', cleared: '#ae8053', tested: '#c19760', cultivated: '#855232', planted: '#59804a', harvested: '#caa56f' };
      if (cleanup?.high.includes(index) && !cleanup.dug.includes(index)) ctx.fillStyle = '#d8914a';
      else if (cleanup?.low.includes(index) && !cleanup.filled.includes(index)) ctx.fillStyle = '#69a7cb';
      else ctx.fillStyle = blockedPlots.has(index) ? '#365b38' : colors[plotStates[index]];
      ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
      if (cleanup?.dug.includes(index) || cleanup?.filled.includes(index)) square(plotPositions[index].x, plotPositions[index].z, Math.max(3, Math.min(pw, ph) / 3), '#9a734b');
      if (!blockedPlots.has(index) && (plotStates[index] === PLOT_STATE.CULTIVATED || plotStates[index] === PLOT_STATE.PLANTED)) {
        ctx.fillStyle = plotStates[index] === PLOT_STATE.PLANTED ? '#9dbb5e' : '#a86e45';
        for (let stripe = -1; stripe <= 1; stripe += 1) ctx.fillRect(px - pw / 2 + 2, py + stripe * ph / 4, Math.max(1, pw - 4), 1);
      }
    }
    for (const id of cleanup?.removed ?? []) {
      const point = ROCK_POSITIONS[id];
      if (point) square(point[0], point[1], 4, '#9a734b');
    }
  }
  square(-5.8, -5.1, Math.max(16, Math.round(mapView.zoom * 2.6)), '#5b3928');
  square(-5.8, -5.35, Math.max(12, Math.round(mapView.zoom * 2.2)), '#a7563b');
  ctx.fillStyle = '#f3e1ac'; ctx.fillRect(sx(-5.8) - 3, sy(-5.1) + 3, 6, 5);
  square(farmerJohn.position.x, farmerJohn.position.z, 5, '#e1c27c');
  ctx.fillStyle = '#453d2b'; ctx.font = 'bold 9px monospace';
  ctx.fillText('HOME', sx(-5.8) - 12, sy(-5.1) + 24);
  ctx.fillText('JOHN', sx(farmerJohn.position.x) + 5, sy(farmerJohn.position.z) - 4);
  ctx.fillText('TOWN', sx(roadCenter(TOWN_Z) - 4.7) - 14, sy(TOWN_Z) + 18);
  ctx.fillText('SCIENCE', sx(roadCenter(TOWN_Z) + 5.2) - 18, sy(TOWN_Z) + 18);
  if (soilStudy.phase === 'mail-ready') { square(MAILBOX_X, MAILBOX_Z, 6, '#f5d36b'); ctx.fillText('MAIL', sx(MAILBOX_X) + 5, sy(MAILBOX_Z) - 4); }
  ctx.strokeStyle = '#594c2d'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
  mapCanvas.setAttribute('aria-label', `Interactive farm map. ${fieldSummary()}. Farmer John is near ${fieldBounds ? 'the field' : 'the farmhouse'}. Drag to pan; use the buttons or scroll to zoom.`);
}

function buildFarmMap() {
  if (!mapCanvas) return;
  let drag = null;
  mapCanvas.addEventListener('pointerdown', (event) => {
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    mapCanvas.setPointerCapture(event.pointerId);
    mapCanvas.style.cursor = 'grabbing';
  });
  mapCanvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const rect = mapCanvas.getBoundingClientRect();
    mapView.centerX -= (event.clientX - drag.x) * mapCanvas.width / rect.width / mapView.zoom;
    mapView.centerZ -= (event.clientY - drag.y) * mapCanvas.height / rect.height / mapView.zoom;
    drag.x = event.clientX; drag.y = event.clientY;
    updateFarmMap();
  });
  const stopDrag = () => { drag = null; mapCanvas.style.cursor = 'grab'; };
  mapCanvas.addEventListener('pointerup', stopDrag);
  mapCanvas.addEventListener('pointercancel', stopDrag);
  mapCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    mapView.zoom = THREE.MathUtils.clamp(mapView.zoom * (event.deltaY < 0 ? 1.16 : 1 / 1.16), 4, 22);
    updateFarmMap();
  }, { passive: false });
  document.querySelector('#map-zoom-in')?.addEventListener('click', () => { mapView.zoom = Math.min(22, mapView.zoom * 1.25); updateFarmMap(); });
  document.querySelector('#map-zoom-out')?.addEventListener('click', () => { mapView.zoom = Math.max(4, mapView.zoom / 1.25); updateFarmMap(); });
  document.querySelector('#map-recenter')?.addEventListener('click', () => {
    mapView.centerX = fieldBounds ? (fieldBounds.minX + fieldBounds.maxX) / 2 : -3;
    mapView.centerZ = fieldBounds ? (fieldBounds.minZ + fieldBounds.maxZ) / 2 : -2;
    mapView.zoom = 8;
    updateFarmMap();
  });
  updateFarmMap();
}

function updateMapPlots() { updateFarmMap(); }

updateCanvasLabel();
updateHelpText();
resize();
// Restore the remembered camera only after the first fit-to-window resize,
// otherwise that resize would overwrite the saved distance.
const restoredCameraState = fieldBounds ? readSavedCameraState() : null;
if (restoredCameraState) applyCameraState(restoredCameraState);
if (['driving-out','driving-back','lab-arrived','ready-to-return'].includes(soilStudy.phase)) {
  const target = new THREE.Vector3(car.position.x,car.position.y + 0.85,car.position.z);
  controls.target.copy(target);
  camera.position.copy(target).add(new THREE.Vector3(-Math.sin(car.rotation.y)*7,5.1,-Math.cos(car.rotation.y)*7));
  controls.update();
}
lastSavedCameraState = JSON.stringify(cameraStateSnapshot());
buildFarmMap();
if (!fieldBounds) showOnboarding();

function resetEverything() {
  window.__farmHandsResetting = true;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('farm-hands-')) localStorage.removeItem(key);
    }
  } catch {
    window.__farmHandsResetting = false;
    return false;
  }
  window.location.reload();
  return true;
}

// Expose on window for debugging and test verification
window.FarmGame = {
  scene,
  camera,
  controls,
  plotStates,
  plotCare,
  inventory,
  handlePlotAction,
  clearWeeds,
  testSoil,
  cultivate,
  drillWheat,
  updateFarmMap,
  updateInventory,
  pickTarget,
  weatherSettings,
  setWeather,
  sunGlow,
  sunCore,
  horizonGlow,
  stars,
  starMaterial,
  heldKeys,
  readSavedCameraState,
  saveCameraState,
  applyCameraState,
  resetCameraToDefault,
  isCameraMemoryEnabled,
  setCameraMemoryEnabled,
  isPlotFocusEnabled: () => plotFocusEnabled,
  isJohnSleeping: () => johnSleeping,
  setPlotFocusEnabled,
  focusPlot,
  buildFarmMap,
  updateMapPlots,
  resetEverything,
};
