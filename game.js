import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { getGameDate } from './calendar.js';

const COLUMNS = 3;
const ROWS = 3;
const PLOT_COUNT = COLUMNS * ROWS;
const canvas = document.querySelector('#field');
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

const material = (color, roughness = 1, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

const soilBaseMaterial = material(0x714831);
const ridgeMaterial = material(0xb37648);
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
  for (let index = 0; index < 450; index += 1) {
    const x = random() * 128;
    const y = random() * 128;
    context.strokeStyle = random() > 0.4 ? '#b0ce9e' : '#d2e4c2';
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
const grassLight = new THREE.Color(0x94c47b);
const grassShade = new THREE.Color(0x73a869);
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
    const angle = (blade * Math.PI * 2) / 5;
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
  } while (x > -7.8 && x < -3.8 && z > -7.2 && z < -3.2);
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

// ==========================================================================
// WILDFLOWERS (COZY PASTORAL MEADOW)
// ==========================================================================
function addWildflowers() {
  const flowerGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 6);
  const flowerMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const flowerCount = 420;
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
      (x > -7.8 && x < -3.8 && z > -7.2 && z < -3.2)   // Avoid house
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
let houseHitbox;

function addFarmhouse() {
  const house = farmhouseGroup;
  house.position.set(-5.8, groundHeight(-5.8, -5.1), -5.1);
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
    roughness: 0.25,
    metalness: 0.1,
  });

  box(house, 2.9, 0.22, 2.7, foundation, 0, 0.08, 0);
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
  box(house, 1.05, 0.14, 0.6, foundation, 0, 0.13, 1.5);

  // Front Porch Lantern
  const lanternBracket = box(house, 0.06, 0.15, 0.12, material(0x2d1f14), 0.46, 1.25, 1.25);
  const lanternLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffe285, emissive: 0xffaa2b, roughness: 0.3 })
  );
  lanternLight.position.set(0.46, 1.18, 1.31);
  house.add(lanternLight);

  // Front Windows with Cozy Flower Boxes
  for (const x of [-0.87, 0.87]) {
    box(house, 0.54, 0.68, 0.07, trim, x, 1.25, 1.23);
    box(house, 0.44, 0.56, 0.08, warmGlass, x, 1.25, 1.28);
    box(house, 0.05, 0.58, 0.09, trim, x, 1.25, 1.33);
    box(house, 0.48, 0.05, 0.09, trim, x, 1.25, 1.33);

    // Flower Box
    box(house, 0.56, 0.12, 0.14, material(0x5a391e), x, 0.86, 1.33);
    // Flowers in box
    const flowerColors = [0xde4337, 0xf6d148, 0xeb7b9b, 0xffffff];
    for (let f = -2; f <= 2; f += 1) {
      const petal = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 5, 4),
        material(flowerColors[(f + 4) % flowerColors.length])
      );
      petal.position.set(x + f * 0.09, 0.96, 1.35);
      house.add(petal);
    }
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
  const pathSteps = [
    [-5.8, -3.9], [-5.2, -3.6], [-4.6, -3.2],
    [-3.9, -2.9], [-3.2, -2.6], [-2.5, -2.4], [-1.9, -2.2]
  ];
  for (let i = 0; i < pathSteps.length; i += 1) {
    const [x, z] = pathSteps[i];
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
addGardenPath();

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
addFence();

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
addHayBales();

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
addTree(-8.5, -6.6, 1.15); // Behind farmhouse on hill
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
addSignpost();

// ==========================================================================
// SOIL AND PLANTING FIELD
// ==========================================================================

const fieldOutline = new THREE.Shape();
fieldOutline.moveTo(-1.7, -1.9);
fieldOutline.lineTo(1.7, -1.9);
fieldOutline.quadraticCurveTo(1.9, -1.9, 1.9, -1.7);
fieldOutline.lineTo(1.9, 1.7);
fieldOutline.quadraticCurveTo(1.9, 1.9, 1.7, 1.9);
fieldOutline.lineTo(-1.7, 1.9);
fieldOutline.quadraticCurveTo(-1.9, 1.9, -1.9, 1.7);
fieldOutline.lineTo(-1.9, -1.7);
fieldOutline.quadraticCurveTo(-1.9, -1.9, -1.7, -1.9);
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
    const x = (column - 1) * 1.22;
    const z = (row - 1) * 1.22;
    const soilMaterial = material(0x945f3c);
    const soil = box(scene, 1.06, 0.1, 1.06, soilMaterial, x, -0.11, z);
    soil.userData.plotIndex = index;
    plotMeshes.push(soil);
    plotMaterials.push(soilMaterial);
    plotPositions.push({ x, z });
    for (let furrow = -1; furrow <= 1; furrow += 1) {
      box(scene, 0.88, 0.035, 0.09, ridgeMaterial, x, -0.04, z + furrow * 0.28);
    }
  }
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
  currentWeather = weatherSettings[name] || weatherSettings.sunny;
  if (weatherDescription) weatherDescription.textContent = currentWeather.description;
  const modalWeather = document.querySelector('#farm-modal-weather');
  if (modalWeather) modalWeather.textContent = currentWeather.description;
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

const STORAGE_PLOTS_KEY = 'farm-hands-planted-plots-v1';
const STORAGE_WEATHER_KEY = 'farm-hands-weather-v1';

function saveGameProgress() {
  try {
    localStorage.setItem(STORAGE_PLOTS_KEY, JSON.stringify([...plantedPlots]));
    localStorage.setItem(STORAGE_WEATHER_KEY, weatherSelect.value);
  } catch {
    // Storage unavailable (e.g. private browsing); the game keeps running.
  }
}

function restoreGameProgress() {
  let savedPlots = null;
  try {
    const raw = localStorage.getItem(STORAGE_PLOTS_KEY);
    savedPlots = raw ? JSON.parse(raw) : null;
  } catch {
    savedPlots = null;
  }
  if (Array.isArray(savedPlots)) {
    for (const value of savedPlots) {
      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < PLOT_COUNT && !plantedPlots.has(index)) {
        plantedPlots.add(index);
        addWheatSeedlings(index, false);
      }
    }
  }

  let savedWeather = null;
  try {
    savedWeather = localStorage.getItem(STORAGE_WEATHER_KEY);
  } catch {
    savedWeather = null;
  }
  if (savedWeather && weatherSettings[savedWeather]) {
    weatherSelect.value = savedWeather;
  }
  setWeather(weatherSelect.value);
  updatePlantedCountLedger();
}

weatherSelect.addEventListener('change', () => {
  setWeather(weatherSelect.value);
  saveGameProgress();
});
reducedMotion.addEventListener('change', () => setWeather(weatherSelect.value));
restoreGameProgress();

// ─── Daylight cycle ──────────────────────────────────────────────────────
// Each keyframe is keyed by fractional hour (0–24).
// Fields: sky, fog colour, fog far distance, ambient intensity,
//         sun colour, sun intensity, sun position [x,y,z].
const daylightKeyframes = [
  { hour:  0,   sky: 0x0c1524, fog: 0x0c1524, fogFar: 55,  ambient: 0.35, sunColor: 0x8899bb, sunIntensity: 0.0,  sunPos: [-5, -4,  7] },
  { hour:  5,   sky: 0x1a2438, fog: 0x1a2438, fogFar: 60,  ambient: 0.4,  sunColor: 0x99aabb, sunIntensity: 0.05, sunPos: [-8,  0,  7] },
  { hour:  6,   sky: 0x5e4a5e, fog: 0x5e4a5e, fogFar: 75,  ambient: 0.85, sunColor: 0xffb87a, sunIntensity: 0.9,  sunPos: [-9,  2,  7] },
  { hour:  7,   sky: 0xe8a87a, fog: 0xdaa07a, fogFar: 90,  ambient: 1.4,  sunColor: 0xffc88e, sunIntensity: 1.8,  sunPos: [-8,  5,  7] },
  { hour:  8.5, sky: 0xb8e1df, fog: 0xb8e1df, fogFar: 120, ambient: 2.4,  sunColor: 0xfff1cd, sunIntensity: 3.2,  sunPos: [-5, 11,  7] },
  { hour: 12,   sky: 0xb8e1df, fog: 0xb8e1df, fogFar: 120, ambient: 2.4,  sunColor: 0xfff8e0, sunIntensity: 3.4,  sunPos: [ 0, 14,  2] },
  { hour: 16,   sky: 0xb8e1df, fog: 0xb8e1df, fogFar: 120, ambient: 2.3,  sunColor: 0xfff1cd, sunIntensity: 3.0,  sunPos: [ 5, 11, -5] },
  { hour: 18,   sky: 0xe8a87a, fog: 0xdaa07a, fogFar: 90,  ambient: 1.4,  sunColor: 0xffad6e, sunIntensity: 1.6,  sunPos: [ 8,  4, -7] },
  { hour: 19.5, sky: 0x6e4a5e, fog: 0x6e4a5e, fogFar: 75,  ambient: 0.7,  sunColor: 0xe08855, sunIntensity: 0.5,  sunPos: [ 9,  1, -7] },
  { hour: 20.5, sky: 0x1a2438, fog: 0x1a2438, fogFar: 60,  ambient: 0.4,  sunColor: 0x8899bb, sunIntensity: 0.05, sunPos: [ 8, -1, -7] },
  { hour: 24,   sky: 0x0c1524, fog: 0x0c1524, fogFar: 55,  ambient: 0.35, sunColor: 0x8899bb, sunIntensity: 0.0,  sunPos: [-5, -4,  7] },
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
  const wName = weatherSelect.value;
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
  sunlight.color.copy(_sunA);
  sunlight.intensity = baseSunInt * wm.sun;
  sunlight.position.set(sunX, sunY, sunZ);
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
const heldKeys = new Set();
const moveVelocity = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const moveForward = new THREE.Vector3();
const moveRight = new THREE.Vector3();

function desiredMoveDirection() {
  camera.getWorldDirection(moveForward);
  moveForward.y = 0;
  moveForward.normalize();
  moveRight.crossVectors(moveForward, camera.up).normalize();

  moveDirection.set(0, 0, 0);
  if (heldKeys.has('w')) moveDirection.add(moveForward);
  if (heldKeys.has('s')) moveDirection.sub(moveForward);
  if (heldKeys.has('d')) moveDirection.add(moveRight);
  if (heldKeys.has('a')) moveDirection.sub(moveRight);
  if (moveDirection.lengthSq() > 0) moveDirection.normalize();
  return moveDirection;
}

function updateCameraMovement(deltaSeconds) {
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

// Unified Animation Loop
function animateScene(now) {
  const deltaSeconds = Math.min((now - lastTickTime) / 1000, 0.06);
  lastTickTime = now;

  updateDaylight();
  if (!reducedMotion.matches) updateChimneySmoke(deltaSeconds);
  if (rain.visible && !reducedMotion.matches) updateRain(deltaSeconds);
  if (updateCameraMovement(deltaSeconds)) {
    if (rain.visible) updateRain(0);
  }
  render();
  requestAnimationFrame(animateScene);
}
requestAnimationFrame(animateScene);

// ==========================================================================
// WHEAT SEEDLING GROWTH
// ==========================================================================

function addWheatSeedlings(index, animateGrowth = true) {
  const { x, z } = plotPositions[index];
  const cluster = new THREE.Group();
  cluster.position.set(x, -0.02, z);
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

  if (!animateGrowth) {
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
  }
  cluster.scale.y = 0.02;
  requestAnimationFrame(animate);
}

// ==========================================================================
// VIEWPORT & RESIZE
// ==========================================================================

let fittedDistance = null;
function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const aspect = width / height;
  const fit = Math.max(13, 12.2 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect));
  const distance = fittedDistance === null
    ? fit
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

  // Check plot meshes and farmhouse hitbox
  const targets = [houseHitbox, ...plotMeshes];
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return null;

  const first = hits[0].object;
  if (first.userData.isFarmhouse) {
    return { type: 'farmhouse' };
  }
  if (first.userData.plotIndex !== undefined) {
    return { type: 'plot', index: first.userData.plotIndex };
  }
  return null;
}

function updateHighlights() {
  for (let index = 0; index < PLOT_COUNT; index += 1) {
    const active = index === hoveredPlotIndex || (keyboardFocus && index === selectedIndex);
    plotMaterials[index].color.setHex(active ? 0xbd8052 : 0x945f3c);
    plotMaterials[index].emissive.setHex(active ? 0x38220b : 0x000000);
  }
  render();
}

function updateCanvasLabel() {
  const state = plantedPlots.has(selectedIndex) ? 'already planted' : 'empty';
  canvas.setAttribute(
    'aria-label',
    `3D wheat field. Plot ${selectedIndex + 1} of ${PLOT_COUNT} is ${state}. Use WASD to move camera, arrow keys to select a plot, Enter to plant wheat. Click the farmhouse to view the calendar.`
  );
}

function updatePlantedCountLedger() {
  const ledgerEl = document.querySelector('#farm-planted-count');
  if (ledgerEl) {
    ledgerEl.textContent = `${plantedPlots.size} / ${PLOT_COUNT} plots planted`;
  }
}

function plantWheat(index) {
  if (index < 0 || plantedPlots.has(index)) return;
  plantedPlots.add(index);
  addWheatSeedlings(index);
  status.textContent = plantedPlots.size === PLOT_COUNT
    ? 'Every plot has wheat planted.'
    : `Wheat planted in plot ${index + 1}.`;
  updateCanvasLabel();
  updatePlantedCountLedger();
  saveGameProgress();
}

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
  } else if (target?.type === 'plot') {
    canvas.style.cursor = !plantedPlots.has(target.index) ? 'pointer' : 'grab';
    if (target.index !== hoveredPlotIndex) {
      hoveredPlotIndex = target.index;
      updateHighlights();
    }
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
  if (!target) return;

  if (target.type === 'farmhouse') {
    updatePlantedCountLedger();
    window.FarmCalendar?.openFarmhouseMenu?.();
    return;
  }

  if (target.type === 'plot') {
    selectedIndex = target.index;
    canvas.focus({ preventScroll: true });
    plantWheat(target.index);
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

window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (!['w', 'a', 's', 'd'].includes(key)) return;
  event.preventDefault();
  heldKeys.add(key);
});

window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) heldKeys.delete(key);
});

// Clear held keys if the window loses focus so the camera never keeps drifting.
window.addEventListener('blur', () => heldKeys.clear());

updateCanvasLabel();
resize();

// Expose on window for debugging and test verification
window.FarmGame = {
  scene,
  camera,
  controls,
  plantWheat,
  pickTarget,
  plantedPlots,
  weatherSettings,
  setWeather,
};
