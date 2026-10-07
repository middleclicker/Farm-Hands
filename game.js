import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const COLUMNS = 4;
const ROWS = 3;
const PLOT_COUNT = COLUMNS * ROWS;
const canvas = document.querySelector('#field');
const rainCanvas = document.querySelector('#rain-overlay');
const rainContext = rainCanvas.getContext('2d');
const status = document.querySelector('#field-status');
const weatherSelect = document.querySelector('#weather-select');
const weatherDescription = document.querySelector('#weather-description');
const plantedPlots = new Set();

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
scene.background = new THREE.Color(0xb8e1df);
scene.fog = new THREE.Fog(0xb8e1df, 27, 120);
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
controls.addEventListener('change', render);

const ambientLight = new THREE.HemisphereLight(0xffffff, 0x739367, 2.4);
scene.add(ambientLight);
const sunlight = new THREE.DirectionalLight(0xfff1cd, 3.2);
sunlight.position.set(-5, 11, 7);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
sunlight.shadow.camera.left = -10;
sunlight.shadow.camera.right = 10;
sunlight.shadow.camera.top = 10;
sunlight.shadow.camera.bottom = -10;
sunlight.shadow.normalBias = 0.025;
scene.add(sunlight);

const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
const soilBaseMaterial = material(0x795039);
const ridgeMaterial = material(0xb77a4c);
const stemMaterial = material(0x488f54);
const leafMaterial = material(0x6eae65);
const headMaterial = material(0xa6c979);

function box(parent, width, height, depth, meshMaterial, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), meshMaterial);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function groundHeight(x, z) {
  const distance = Math.hypot(x, z);
  const hills = THREE.MathUtils.smoothstep(distance, 7, 28);
  return -0.18 + hills * (
    0.32 * Math.sin(x * 0.09) * Math.cos(z * 0.075) +
    0.19 * Math.sin(x * 0.19 + z * 0.14) +
    0.12 * Math.cos(z * 0.16)
  );
}

function grassTexture() {
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const context = tile.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 128, 128);
  let seed = 19;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let index = 0; index < 420; index += 1) {
    const x = random() * 128;
    const y = random() * 128;
    context.strokeStyle = random() > 0.45 ? '#b6d1a9' : '#d7e7ca';
    context.lineWidth = random() > 0.7 ? 1.5 : 1;
    context.beginPath();
    context.moveTo(x, y + 2);
    context.lineTo(x + (random() - 0.5) * 4, y - 2 - random() * 4);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(tile);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(135, 135);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

const terrainGeometry = new THREE.PlaneGeometry(600, 600, 180, 180);
terrainGeometry.rotateX(-Math.PI / 2);
const terrainPositions = terrainGeometry.attributes.position;
const terrainColors = [];
const grassLight = new THREE.Color(0x91c17c);
const grassShade = new THREE.Color(0x77ac70);
for (let index = 0; index < terrainPositions.count; index += 1) {
  const x = terrainPositions.getX(index);
  const z = terrainPositions.getZ(index);
  terrainPositions.setY(index, groundHeight(x, z));
  const variation = (Math.sin(x * 0.12 + z * 0.035) * Math.cos(z * 0.11) + 1) / 2;
  const color = grassShade.clone().lerp(grassLight, variation);
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

function grassClumpGeometry() {
  const vertices = [];
  for (let blade = 0; blade < 5; blade += 1) {
    const angle = blade * Math.PI * 2 / 5;
    const spread = 0.11 + (blade % 2) * 0.04;
    const sideX = -Math.sin(angle) * 0.026;
    const sideZ = Math.cos(angle) * 0.026;
    const tipX = Math.cos(angle) * spread;
    const tipZ = Math.sin(angle) * spread;
    vertices.push(
      sideX, 0, sideZ,
      -sideX, 0, -sideZ,
      tipX, 0.36 + (blade % 3) * 0.045, tipZ,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

let grassSeed = 317;
const randomGrass = () => ((grassSeed = (grassSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
const tuftCount = 2600;
const tufts = new THREE.InstancedMesh(
  grassClumpGeometry(),
  new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  tuftCount,
);
const tuftTransform = new THREE.Object3D();
for (let index = 0; index < tuftCount; index += 1) {
  let x;
  let z;
  do {
    const angle = randomGrass() * Math.PI * 2;
    const radius = index < 1900 ? 5.5 + randomGrass() * 26 : 26 + Math.sqrt(randomGrass()) * 105;
    x = Math.cos(angle) * radius;
    z = Math.sin(angle) * radius;
  } while (x > -7.5 && x < -4.1 && z > -6.7 && z < -3.5);
  const height = 0.65 + randomGrass() * 1.05;
  const width = 0.8 + randomGrass() * 0.7;
  tuftTransform.position.set(x, groundHeight(x, z) + 0.012, z);
  tuftTransform.rotation.set(0, randomGrass() * Math.PI * 2, 0);
  tuftTransform.scale.set(width, height, width);
  tuftTransform.updateMatrix();
  tufts.setMatrixAt(index, tuftTransform.matrix);
  tufts.setColorAt(index, new THREE.Color().setHSL(0.27 + randomGrass() * 0.055, 0.34 + randomGrass() * 0.13, 0.43 + randomGrass() * 0.13));
}
tufts.instanceMatrix.needsUpdate = true;
tufts.instanceColor.needsUpdate = true;
scene.add(tufts);

function addFarmhouse() {
  const house = new THREE.Group();
  house.position.set(-5.8, groundHeight(-5.8, -5.1), -5.1);
  scene.add(house);

  const foundation = material(0xa99a81);
  const siding = material(0xf0e3c6);
  const trim = material(0xfff4dc);
  const roof = material(0x9b5849);
  const roofEdge = material(0x74483e);
  const door = material(0x805740);
  const glass = new THREE.MeshStandardMaterial({ color: 0x91bac0, roughness: 0.2, metalness: 0.05 });

  box(house, 2.85, 0.19, 2.65, foundation, 0, 0.08, 0);
  box(house, 2.55, 1.8, 2.35, siding, 0, 1.06, 0);
  box(house, 2.68, 0.12, 2.49, trim, 0, 0.23, 0);
  box(house, 2.68, 0.11, 2.49, trim, 0, 1.97, 0);

  const gableShape = new THREE.Shape();
  gableShape.moveTo(-1.28, 2.01);
  gableShape.lineTo(1.28, 2.01);
  gableShape.lineTo(0, 2.83);
  gableShape.closePath();
  const gableGeometry = new THREE.ShapeGeometry(gableShape);
  const gableMaterial = new THREE.MeshStandardMaterial({ color: 0xf0e3c6, roughness: 1, side: THREE.DoubleSide });
  for (const z of [-1.18, 1.18]) {
    const gable = new THREE.Mesh(gableGeometry, gableMaterial);
    gable.position.z = z;
    gable.castShadow = true;
    gable.receiveShadow = true;
    house.add(gable);
  }

  for (const side of [-1, 1]) {
    const panel = box(house, 1.58, 0.13, 2.82, roof, side * 0.72, 2.43, 0);
    panel.rotation.z = side * -0.59;
    const fascia = box(house, 1.58, 0.1, 0.08, roofEdge, side * 0.72, 2.44, 1.42);
    fascia.rotation.z = side * -0.59;
  }

  box(house, 0.39, 0.82, 0.39, roofEdge, -0.65, 2.76, -0.55);
  box(house, 0.53, 0.12, 0.53, foundation, -0.65, 3.2, -0.55);

  box(house, 0.72, 1.32, 0.06, trim, 0, 0.89, 1.21);
  box(house, 0.6, 1.22, 0.075, door, 0, 0.83, 1.26);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), material(0xe5bd66));
  knob.position.set(0.21, 0.84, 1.32);
  house.add(knob);
  box(house, 1.01, 0.13, 0.55, foundation, 0, 0.13, 1.47);

  for (const x of [-0.87, 0.87]) {
    box(house, 0.52, 0.66, 0.065, trim, x, 1.25, 1.22);
    box(house, 0.43, 0.55, 0.075, glass, x, 1.25, 1.27);
    box(house, 0.055, 0.58, 0.09, trim, x, 1.25, 1.32);
    box(house, 0.48, 0.055, 0.09, trim, x, 1.25, 1.32);
  }
  for (const side of [-1, 1]) {
    const x = side * 1.31;
    box(house, 0.07, 0.77, 0.75, trim, x, 1.23, -0.12);
    box(house, 0.08, 0.66, 0.65, glass, x + side * 0.05, 1.23, -0.12);
    box(house, 0.1, 0.7, 0.055, trim, x + side * 0.11, 1.23, -0.12);
  }
}
addFarmhouse();

// The field is a thin patch of worked earth level with the surrounding grass.
const fieldOutline = new THREE.Shape();
fieldOutline.moveTo(-3.55, -2.85);
fieldOutline.lineTo(3.55, -2.85);
fieldOutline.quadraticCurveTo(3.8, -2.85, 3.8, -2.6);
fieldOutline.lineTo(3.8, 2.6);
fieldOutline.quadraticCurveTo(3.8, 2.85, 3.55, 2.85);
fieldOutline.lineTo(-3.55, 2.85);
fieldOutline.quadraticCurveTo(-3.8, 2.85, -3.8, 2.6);
fieldOutline.lineTo(-3.8, -2.6);
fieldOutline.quadraticCurveTo(-3.8, -2.85, -3.55, -2.85);
const fieldSoil = new THREE.Mesh(new THREE.ShapeGeometry(fieldOutline), soilBaseMaterial);
fieldSoil.rotation.x = -Math.PI / 2;
fieldSoil.position.y = -0.17;
fieldSoil.receiveShadow = true;
scene.add(fieldSoil);

const plotMeshes = [];
const plotMaterials = [];
const plotPositions = [];
for (let row = 0; row < ROWS; row += 1) {
  for (let column = 0; column < COLUMNS; column += 1) {
    const index = row * COLUMNS + column;
    const x = (column - 1.5) * 1.68;
    const z = (row - 1) * 1.7;
    const soilMaterial = material(0x98613f);
    const soil = box(scene, 1.48, 0.1, 1.43, soilMaterial, x, -0.11, z);
    soil.userData.plotIndex = index;
    plotMeshes.push(soil);
    plotMaterials.push(soilMaterial);
    plotPositions.push({ x, z });
    for (let furrow = -1; furrow <= 1; furrow += 1) {
      box(scene, 1.25, 0.035, 0.12, ridgeMaterial, x, -0.04, z + furrow * 0.38);
    }
  }
}

function render() {
  renderer.render(scene, camera);
}

const weatherSettings = {
  sunny: {
    description: 'Clear skies and warm sunlight.', sky: 0xb8e1df,
    ambient: 2.4, sun: 3.2, rain: 0, speed: 0, opacity: 0, length: 0, fog: 120,
  },
  light: {
    description: 'A light shower is falling.', sky: 0xabc5c8,
    ambient: 2.0, sun: 1.9, rain: 55, speed: 170, opacity: 0.45, length: 12, fog: 100,
  },
  moderate: {
    description: 'Steady rain is falling.', sky: 0x829fa9,
    ambient: 1.6, sun: 1.15, rain: 120, speed: 300, opacity: 0.58, length: 18, fog: 80,
  },
  heavy: {
    description: 'A heavy downpour is falling.', sky: 0x637c8b,
    ambient: 1.25, sun: 0.65, rain: 220, speed: 470, opacity: 0.72, length: 24, fog: 65,
  },
};
const MAX_RAIN_DROPS = weatherSettings.heavy.rain;
let rainSeed = 9247;
const randomRain = () => ((rainSeed = (rainSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rainDrops = Array.from({ length: MAX_RAIN_DROPS }, () => ({
  x: randomRain(),
  y: randomRain(),
}));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentWeather = weatherSettings.sunny;
let rainFrame = 0;
let lastRainTime = 0;

function drawRain(deltaSeconds = 0) {
  const width = rainCanvas.clientWidth;
  const height = rainCanvas.clientHeight;
  rainContext.clearRect(0, 0, width, height);
  rainContext.strokeStyle = `rgba(217, 239, 250, ${currentWeather.opacity})`;
  rainContext.lineWidth = currentWeather.rain === weatherSettings.heavy.rain ? 1.7 : 1.3;
  rainContext.beginPath();
  for (let index = 0; index < currentWeather.rain; index += 1) {
    const drop = rainDrops[index];
    drop.y += currentWeather.speed * deltaSeconds / height;
    if (drop.y > 1.05) drop.y -= 1.1;
    const x = drop.x * width;
    const y = drop.y * height;
    rainContext.moveTo(x, y);
    rainContext.lineTo(x - currentWeather.length * 0.22, y + currentWeather.length);
  }
  rainContext.stroke();
}

function animateRain(now) {
  const deltaSeconds = lastRainTime ? Math.min((now - lastRainTime) / 1000, 0.05) : 0;
  lastRainTime = now;
  drawRain(deltaSeconds);
  rainFrame = requestAnimationFrame(animateRain);
}

function setWeather(name) {
  currentWeather = weatherSettings[name] || weatherSettings.sunny;
  weatherDescription.textContent = currentWeather.description;
  scene.background.setHex(currentWeather.sky);
  scene.fog.color.setHex(currentWeather.sky);
  scene.fog.far = currentWeather.fog;
  ambientLight.intensity = currentWeather.ambient;
  sunlight.intensity = currentWeather.sun;
  rainCanvas.hidden = currentWeather.rain === 0;
  if (rainFrame) cancelAnimationFrame(rainFrame);
  rainFrame = 0;
  lastRainTime = 0;
  if (!rainCanvas.hidden) {
    drawRain();
    if (!reducedMotion.matches) rainFrame = requestAnimationFrame(animateRain);
  }
  render();
}

weatherSelect.addEventListener('change', () => setWeather(weatherSelect.value));
reducedMotion.addEventListener('change', () => setWeather(weatherSelect.value));
setWeather(weatherSelect.value);

function addWheatSeedlings(index) {
  const { x, z } = plotPositions[index];
  const cluster = new THREE.Group();
  cluster.position.set(x, -0.02, z);
  const offsets = [
    [-0.34, -0.2, 0.58], [0.27, -0.23, 0.68], [0, 0.08, 0.78],
    [-0.29, 0.32, 0.62], [0.34, 0.31, 0.57],
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
  }
  cluster.scale.y = 0.02;
  requestAnimationFrame(animate);
}

let fittedDistance = null;
function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const aspect = width / height;
  const fit = Math.max(13, 12.2 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect));
  const distance = fittedDistance === null
    ? fit
    : THREE.MathUtils.clamp(controls.getDistance() * fit / fittedDistance, controls.minDistance, controls.maxDistance);
  fittedDistance = fit;
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  controls.update();
  renderer.setSize(width, height, false);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  rainCanvas.width = Math.round(width * pixelRatio);
  rainCanvas.height = Math.round(height * pixelRatio);
  rainContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (currentWeather.rain) drawRain();
  render();
}
new ResizeObserver(resize).observe(canvas);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredIndex = -1;
let selectedIndex = 0;
let keyboardFocus = false;
let activePointer = null;
let dragged = false;
let suppressClick = false;

function pickPlot(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(plotMeshes, false)[0]?.object.userData.plotIndex ?? -1;
}

function updateHighlights() {
  for (let index = 0; index < PLOT_COUNT; index += 1) {
    const active = index === hoveredIndex || (keyboardFocus && index === selectedIndex);
    plotMaterials[index].color.setHex(active ? 0xbd8052 : 0x98613f);
    plotMaterials[index].emissive.setHex(active ? 0x38220b : 0x000000);
  }
  render();
}

function updateCanvasLabel() {
  const state = plantedPlots.has(selectedIndex) ? 'already planted' : 'empty';
  canvas.setAttribute('aria-label', `3D wheat field. Plot ${selectedIndex + 1} of ${PLOT_COUNT} is ${state}. Use arrow keys to select a plot and Enter to plant wheat.`);
}

function plantWheat(index) {
  if (index < 0 || plantedPlots.has(index)) return;
  plantedPlots.add(index);
  addWheatSeedlings(index);
  status.textContent = plantedPlots.size === PLOT_COUNT
    ? 'Every plot has wheat planted.'
    : `Wheat planted in plot ${index + 1}.`;
  updateCanvasLabel();
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  dragged = false;
  suppressClick = false;
});
canvas.addEventListener('pointermove', (event) => {
  if (activePointer?.id === event.pointerId &&
      Math.hypot(event.clientX - activePointer.x, event.clientY - activePointer.y) > 6) {
    dragged = true;
  }
  if (dragged) {
    canvas.style.cursor = 'grabbing';
    if (hoveredIndex !== -1) {
      hoveredIndex = -1;
      updateHighlights();
    }
    return;
  }
  const index = pickPlot(event);
  canvas.style.cursor = index >= 0 && !plantedPlots.has(index) ? 'pointer' : 'grab';
  if (index !== hoveredIndex) {
    hoveredIndex = index;
    updateHighlights();
  }
});
canvas.addEventListener('pointerleave', () => {
  hoveredIndex = -1;
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
  const index = pickPlot(event);
  if (index < 0) return;
  selectedIndex = index;
  canvas.focus({ preventScroll: true });
  plantWheat(index);
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
  let next = selectedIndex;
  if (event.key === 'ArrowLeft' && selectedIndex % COLUMNS > 0) next -= 1;
  else if (event.key === 'ArrowRight' && selectedIndex % COLUMNS < COLUMNS - 1) next += 1;
  else if (event.key === 'ArrowUp' && selectedIndex >= COLUMNS) next -= COLUMNS;
  else if (event.key === 'ArrowDown' && selectedIndex < PLOT_COUNT - COLUMNS) next += COLUMNS;
  else if (event.key === 'Enter' || event.key === ' ') plantWheat(selectedIndex);
  else return;
  event.preventDefault();
  selectedIndex = next;
  updateCanvasLabel();
  updateHighlights();
});

updateCanvasLabel();
resize();
