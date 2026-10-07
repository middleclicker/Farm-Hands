import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const COLUMNS = 4;
const ROWS = 3;
const PLOT_COUNT = COLUMNS * ROWS;
const canvas = document.querySelector('#field');
const count = document.querySelector('#planted-count');
const status = document.querySelector('#field-status');
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
camera.position.set(8, 8, 13);
camera.lookAt(0, 0.25, 0);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.25, 0);
controls.enablePan = false;
controls.enableZoom = false;
controls.minPolarAngle = THREE.MathUtils.degToRad(25);
controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
controls.rotateSpeed = 0.8;
controls.update();
controls.addEventListener('change', render);

scene.add(new THREE.HemisphereLight(0xffffff, 0x739367, 2.4));
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
const woodMaterial = material(0xb98150);
const woodLightMaterial = material(0xd5a36c);
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

let grassSeed = 317;
const randomGrass = () => ((grassSeed = (grassSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
const tuftCount = 750;
const tufts = new THREE.InstancedMesh(
  new THREE.ConeGeometry(0.055, 0.32, 3),
  material(0x70a865),
  tuftCount,
);
const tuftTransform = new THREE.Object3D();
for (let index = 0; index < tuftCount; index += 1) {
  const angle = randomGrass() * Math.PI * 2;
  const radius = index < 330 ? 5.5 + randomGrass() * 24 : 25 + Math.sqrt(randomGrass()) * 105;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const height = 0.5 + randomGrass() * 1.15;
  tuftTransform.position.set(x, groundHeight(x, z) + height * 0.16, z);
  tuftTransform.rotation.set((randomGrass() - 0.5) * 0.3, angle, (randomGrass() - 0.5) * 0.35);
  tuftTransform.scale.set(0.7 + randomGrass(), height, 0.7 + randomGrass());
  tuftTransform.updateMatrix();
  tufts.setMatrixAt(index, tuftTransform.matrix);
  tufts.setColorAt(index, new THREE.Color().setHSL(0.28 + randomGrass() * 0.04, 0.28, 0.46 + randomGrass() * 0.1));
}
tufts.instanceMatrix.needsUpdate = true;
tufts.instanceColor.needsUpdate = true;
scene.add(tufts);

box(scene, 7.75, 0.38, 6.15, woodMaterial, 0, 0.02, 0);
box(scene, 7.15, 0.08, 5.55, soilBaseMaterial, 0, 0.25, 0);
box(scene, 7.65, 0.16, 0.18, woodLightMaterial, 0, 0.33, -2.97);
box(scene, 7.65, 0.16, 0.18, woodLightMaterial, 0, 0.33, 2.97);
box(scene, 0.18, 0.16, 5.8, woodLightMaterial, -3.77, 0.33, 0);
box(scene, 0.18, 0.16, 5.8, woodLightMaterial, 3.77, 0.33, 0);

for (let x = -4.8; x <= 4.8; x += 1.6) {
  box(scene, 0.13, 0.87, 0.13, woodLightMaterial, x, 0.27, -3.78);
}
box(scene, 9.7, 0.1, 0.1, woodLightMaterial, 0, 0.15, -3.78);
box(scene, 9.7, 0.1, 0.1, woodLightMaterial, 0, 0.48, -3.78);

const plotMeshes = [];
const plotMaterials = [];
const plotPositions = [];
for (let row = 0; row < ROWS; row += 1) {
  for (let column = 0; column < COLUMNS; column += 1) {
    const index = row * COLUMNS + column;
    const x = (column - 1.5) * 1.68;
    const z = (row - 1) * 1.7;
    const soilMaterial = material(0x98613f);
    const soil = box(scene, 1.48, 0.22, 1.43, soilMaterial, x, 0.42, z);
    soil.userData.plotIndex = index;
    plotMeshes.push(soil);
    plotMaterials.push(soilMaterial);
    plotPositions.push({ x, z });
    for (let furrow = -1; furrow <= 1; furrow += 1) {
      box(scene, 1.25, 0.045, 0.12, ridgeMaterial, x, 0.555, z + furrow * 0.38);
    }
  }
}

function render() {
  renderer.render(scene, camera);
}

function addWheatSeedlings(index) {
  const { x, z } = plotPositions[index];
  const cluster = new THREE.Group();
  cluster.position.set(x, 0.55, z);
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

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const aspect = width / height;
  const distance = Math.max(12.5, 10.8 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect));
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  controls.update();
  renderer.setSize(width, height, false);
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
  count.textContent = `${plantedPlots.size} / ${PLOT_COUNT}`;
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
