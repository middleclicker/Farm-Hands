import * as THREE from 'three';

const timber = new THREE.MeshStandardMaterial({ color: 0x6b4930, roughness: 0.9 });
const plaster = new THREE.MeshStandardMaterial({ color: 0xdacba5, roughness: 1 });
const pine = new THREE.MeshStandardMaterial({ color: 0xb98752, roughness: 0.8 });
const oak = new THREE.MeshStandardMaterial({ color: 0x755039, roughness: 0.78 });
const mattressCloth = new THREE.MeshStandardMaterial({ color: 0xded4b8, roughness: 1 });

function box(parent, width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function room(width, depth, floorColor) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x5b4b37);
  scene.add(new THREE.HemisphereLight(0xffedcf, 0x69543d, 2.1));
  const lamp = new THREE.PointLight(0xffdca1, 22, 18);
  lamp.position.set(0, 4, 1);
  scene.add(lamp);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  for (let z = -depth / 2 + 0.4; z < depth / 2; z += 0.8) box(scene, width, 0.035, 0.025, timber, 0, 0.012, z);
  box(scene, width, 3.7, 0.2, plaster, 0, 1.85, -depth / 2);
  for (const side of [-1, 1]) box(scene, 0.2, 3.7, depth, plaster, side * width / 2, 1.85, 0);
  for (const side of [-1, 1]) {
    box(scene, 0.14, 3.8, 0.14, timber, side * (width / 2 - 0.12), 1.9, -depth / 2 + 0.12);
    box(scene, 0.14, 3.8, 0.14, timber, side * (width / 2 - 0.12), 1.9, depth / 2 - 0.1);
  }
  box(scene, width, 0.16, 0.18, timber, 0, 3.65, -depth / 2 + 0.05);
  box(scene, 0.95, 1.32, 0.06, timber, -width / 2 + 0.12, 1.75, -1.0);
  box(scene, 0.76, 1.14, 0.07, new THREE.MeshStandardMaterial({ color: 0x9ec4bc, emissive: 0x496e73, emissiveIntensity: 0.18 }), -width / 2 + 0.16, 1.75, -1.0);
  box(scene, 0.07, 1.18, 0.11, timber, -width / 2 + 0.2, 1.75, -1.0);
  // The front wall is cut away so the player can always see and walk inside.
  const door = box(scene, 1.25, 2.35, 0.13, timber, 0, 1.17, -depth / 2 + 0.14);
  box(scene, 1.45, 0.11, 0.21, pine, 0, 2.39, -depth / 2 + 0.23);
  door.userData.interiorDoor = true;
  return { scene, door };
}

function bed(parent, x, z, wood, style) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  box(group, 1.55, 0.18, 2.3, wood, 0, 0.35, 0);
  box(group, 1.4, 0.22, 2.05, mattressCloth, 0, 0.55, 0);
  box(group, 1.22, 0.12, 1.24, new THREE.MeshStandardMaterial({ color: style === 'oak' ? 0x849989 : 0xb6a26f, roughness: 1 }), 0, 0.68, 0.33);
  box(group, 1.12, 0.12, 0.46, new THREE.MeshStandardMaterial({ color: 0xf0e5ca, roughness: 1 }), 0, 0.7, -0.75);
  box(group, 1.65, style === 'oak' ? 0.84 : 0.62, 0.12, wood, 0, style === 'oak' ? 0.55 : 0.43, -1.18);
  for (const xLeg of [-0.64, 0.64]) for (const zLeg of [-1, 1]) box(group, 0.16, 0.38, 0.16, wood, xLeg, 0.19, zLeg);
  parent.add(group);
  const hitbox = box(group, 1.8, 1.1, 2.55, new THREE.MeshBasicMaterial({ visible: false }), 0, 0.65, 0);
  hitbox.userData.bedStyle = style;
  return { group, hitbox };
}

export function createInteriors() {
  const home = room(7.4, 6.8, 0x947451);
  const mattress = new THREE.Group();
  mattress.position.set(-1.25, 0, -1.35);
  box(mattress, 1.32, 0.19, 2.08, mattressCloth, 0, 0.13, 0);
  box(mattress, 1.12, 0.12, 0.43, new THREE.MeshStandardMaterial({ color: 0xf2e9d4 }), 0, 0.28, -0.71);
  box(mattress, 1.25, 0.05, 1.35, new THREE.MeshStandardMaterial({ color: 0x8ba18c }), 0, 0.25, 0.36);
  home.scene.add(mattress);
  const homeBed = bed(home.scene, -1.25, -1.35, pine, 'pine');
  homeBed.group.visible = false;
  const homeOakBed = bed(home.scene, -1.25, -1.35, oak, 'oak');
  homeOakBed.group.visible = false;
  // The room is intentionally spare while John has just moved in.
  const shop = room(9, 8.2, 0xb89b73);
  const pineDisplay = bed(shop.scene, -2.0, -1.0, pine, 'pine');
  const oakDisplay = bed(shop.scene, 2.0, -1.0, oak, 'oak');
  box(shop.scene, 2.2, 1.0, 0.8, timber, 0, 0.5, -3.2);
  const avatar = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0x587b70 });
  box(avatar, 0.48, 0.77, 0.3, shirt, 0, 0.97, 0);
  for (const side of [-1, 1]) {
    box(avatar, 0.16, 0.57, 0.2, timber, side * 0.14, 0.3, 0);
    box(avatar, 0.15, 0.6, 0.18, shirt, side * 0.32, 0.97, 0);
  }
  box(avatar, 0.48, 0.49, 0.43, new THREE.MeshStandardMaterial({ color: 0xd7a674 }), 0, 1.6, 0);
  box(avatar, 0.78, 0.09, 0.67, timber, 0, 1.89, 0);
  box(avatar, 0.45, 0.23, 0.47, timber, 0, 2.04, 0);
  home.scene.add(avatar);
  return { home, shop, mattress, homeBed, homeOakBed, pineDisplay, oakDisplay, avatar };
}
