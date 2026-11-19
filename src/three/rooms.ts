import * as THREE from 'three';
import { SceneRoomId } from '../game/types';
import {
  createBoldWallSignTexture,
  createLaptopScreenTexture,
  createPorcelainTileTexture,
  createProjectionScreenTexture,
  createWhiteboardTexture,
  createWoodDeskTexture,
} from './textures';

export const TABLE_TOP_Y = -0.4;
export const FLOOR_Y = -7.6;
export const CEILING_Y = 14.4;

export interface RoomEnvironmentBuild {
  group: THREE.Group;
  ceilingObjects: THREE.Object3D[];
  backgroundColor: number;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  rimColor: number;
  rimIntensity: number;
  accentColor: number;
  accentIntensity: number;
  dispose: () => void;
}

interface RoomAssetBag {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
  trackGeo: <T extends THREE.BufferGeometry>(g: T) => T;
  trackMat: <T extends THREE.Material>(m: T) => T;
  trackTex: <T extends THREE.Texture>(t: T) => T;
}

function createAssetBag(): RoomAssetBag {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  return {
    geometries,
    materials,
    textures,
    trackGeo: <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    },
    trackMat: <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    },
    trackTex: <T extends THREE.Texture>(t: T): T => {
      textures.push(t);
      return t;
    },
  };
}

interface SharedPropKit {
  metalFrameMat: THREE.MeshStandardMaterial;
  chairLeatherMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  laptopChassisMat: THREE.MeshStandardMaterial;
  keyboardMat: THREE.MeshStandardMaterial;
  screenMats: THREE.MeshStandardMaterial[];
  kraftMat: THREE.MeshStandardMaterial;
  blueRibbonMat: THREE.MeshStandardMaterial;
  bottleSteelMat: THREE.MeshStandardMaterial;
  bottleCapMat: THREE.MeshStandardMaterial;
  deskMatPadMat: THREE.MeshStandardMaterial;
  powerStripMat: THREE.MeshStandardMaterial;
  // Shared reusable prop geometries
  legBoxGeo: THREE.BoxGeometry;
  chairBaseSpokeGeo: THREE.BoxGeometry;
  chairStemGeo: THREE.CylinderGeometry;
  chairSeatGeo: THREE.BoxGeometry;
  chairBackGeo: THREE.BoxGeometry;
  chairArmPostGeo: THREE.BoxGeometry;
  chairArmPadGeo: THREE.BoxGeometry;
  laptopBaseGeo: THREE.BoxGeometry;
  laptopKeyDeckGeo: THREE.BoxGeometry;
  laptopLidGeo: THREE.BoxGeometry;
  laptopScreenGeo: THREE.PlaneGeometry;
  monBaseGeo: THREE.BoxGeometry;
  monStandGeo: THREE.BoxGeometry;
  monFrameGeo: THREE.BoxGeometry;
  monScreenGeo: THREE.PlaneGeometry;
  kbGeo: THREE.BoxGeometry;
  mouseGeo: THREE.BoxGeometry;
  padGeo: THREE.BoxGeometry;
  bottleBodyGeo: THREE.CylinderGeometry;
  bottleCapGeo: THREE.CylinderGeometry;
  kraftBoxGeo: THREE.BoxGeometry;
  kraftRibbonGeo: THREE.BoxGeometry;
}

function createSharedPropKit(bag: RoomAssetBag, maxAniso: number): SharedPropKit {
  const metalFrameMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x11151d,
      roughness: 0.42,
      metalness: 0.72,
    })
  );
  const chairLeatherMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x161a23,
      roughness: 0.78,
      metalness: 0.08,
    })
  );
  const chromeMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd1d8e3,
      roughness: 0.22,
      metalness: 0.88,
    })
  );
  const laptopChassisMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x262d3b,
      roughness: 0.34,
      metalness: 0.68,
    })
  );
  const keyboardMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0d1017,
      roughness: 0.75,
      metalness: 0.12,
    })
  );

  const screenMats = [0, 1, 2].map((v) => {
    const tex = bag.trackTex(createLaptopScreenTexture(v, maxAniso));
    return bag.trackMat(
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.52,
        roughness: 0.18,
        metalness: 0.1,
      })
    );
  });

  const kraftMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc29b6b,
      roughness: 0.86,
      metalness: 0.04,
    })
  );
  const blueRibbonMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0047a0,
      roughness: 0.38,
      metalness: 0.15,
    })
  );
  const bottleSteelMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.24,
      metalness: 0.85,
    })
  );
  const bottleCapMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.15,
    })
  );
  const deskMatPadMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x171c26,
      roughness: 0.88,
      metalness: 0.05,
    })
  );
  const powerStripMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0a0d14,
      roughness: 0.5,
      metalness: 0.4,
    })
  );

  return {
    metalFrameMat,
    chairLeatherMat,
    chromeMat,
    laptopChassisMat,
    keyboardMat,
    screenMats,
    kraftMat,
    blueRibbonMat,
    bottleSteelMat,
    bottleCapMat,
    deskMatPadMat,
    powerStripMat,
    legBoxGeo: bag.trackGeo(new THREE.BoxGeometry(0.32, 1, 0.32)),
    chairBaseSpokeGeo: bag.trackGeo(new THREE.BoxGeometry(2.1, 0.12, 0.18)),
    chairStemGeo: bag.trackGeo(new THREE.CylinderGeometry(0.14, 0.18, 1.5, 10)),
    chairSeatGeo: bag.trackGeo(new THREE.BoxGeometry(2.05, 0.28, 1.95)),
    chairBackGeo: bag.trackGeo(new THREE.BoxGeometry(1.9, 2.7, 0.24)),
    chairArmPostGeo: bag.trackGeo(new THREE.BoxGeometry(0.12, 0.85, 0.14)),
    chairArmPadGeo: bag.trackGeo(new THREE.BoxGeometry(0.18, 0.1, 0.95)),
    laptopBaseGeo: bag.trackGeo(new THREE.BoxGeometry(1.48, 0.07, 1.02)),
    laptopKeyDeckGeo: bag.trackGeo(new THREE.BoxGeometry(1.26, 0.02, 0.54)),
    laptopLidGeo: bag.trackGeo(new THREE.BoxGeometry(1.48, 0.98, 0.05)),
    laptopScreenGeo: bag.trackGeo(new THREE.PlaneGeometry(1.36, 0.86)),
    monBaseGeo: bag.trackGeo(new THREE.BoxGeometry(0.9, 0.06, 0.66)),
    monStandGeo: bag.trackGeo(new THREE.BoxGeometry(0.14, 0.95, 0.14)),
    monFrameGeo: bag.trackGeo(new THREE.BoxGeometry(2.35, 1.38, 0.08)),
    monScreenGeo: bag.trackGeo(new THREE.PlaneGeometry(2.2, 1.24)),
    kbGeo: bag.trackGeo(new THREE.BoxGeometry(1.35, 0.05, 0.45)),
    mouseGeo: bag.trackGeo(new THREE.BoxGeometry(0.24, 0.08, 0.4)),
    padGeo: bag.trackGeo(new THREE.BoxGeometry(2.2, 0.02, 1.1)),
    bottleBodyGeo: bag.trackGeo(new THREE.CylinderGeometry(0.16, 0.16, 0.88, 14)),
    bottleCapGeo: bag.trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 0.14, 12)),
    kraftBoxGeo: bag.trackGeo(new THREE.BoxGeometry(1.18, 0.46, 0.88)),
    kraftRibbonGeo: bag.trackGeo(new THREE.BoxGeometry(0.2, 0.48, 0.91)),
  };
}

/**
 * Composite 7-part ergonomic office chair matching Bold room photos, bottom-centered at y = 0
 */
function buildOfficeChair(kit: SharedPropKit): THREE.Group {
  const chair = new THREE.Group();

  const spokeA = new THREE.Mesh(kit.chairBaseSpokeGeo, kit.metalFrameMat);
  spokeA.position.y = 0.12;
  const spokeB = new THREE.Mesh(kit.chairBaseSpokeGeo, kit.metalFrameMat);
  spokeB.position.y = 0.12;
  spokeB.rotation.y = Math.PI / 2;

  const stem = new THREE.Mesh(kit.chairStemGeo, kit.chromeMat);
  stem.position.y = 0.92;

  const seat = new THREE.Mesh(kit.chairSeatGeo, kit.chairLeatherMat);
  seat.position.y = 1.78;
  seat.castShadow = true;
  seat.receiveShadow = true;

  const back = new THREE.Mesh(kit.chairBackGeo, kit.chairLeatherMat);
  back.position.set(0, 3.18, -0.92);
  back.rotation.x = -0.07;
  back.castShadow = true;

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(kit.chairArmPostGeo, kit.metalFrameMat);
    post.position.set(side * 1.02, 2.22, -0.1);
    const pad = new THREE.Mesh(kit.chairArmPadGeo, kit.chairLeatherMat);
    pad.position.set(side * 1.02, 2.68, -0.04);
    chair.add(post, pad);
  }

  chair.add(spokeA, spokeB, stem, seat, back);
  return chair;
}

/**
 * Composite multi-part laptop sitting flush at y = 0
 */
function buildLaptop(kit: SharedPropKit, screenVariant: number): THREE.Group {
  const laptop = new THREE.Group();

  const base = new THREE.Mesh(kit.laptopBaseGeo, kit.laptopChassisMat);
  base.position.y = 0.035;
  base.castShadow = true;

  const keys = new THREE.Mesh(kit.laptopKeyDeckGeo, kit.keyboardMat);
  keys.position.set(0, 0.075, -0.1);

  const hinge = new THREE.Group();
  hinge.position.set(0, 0.06, -0.5);
  hinge.rotation.x = -0.34;

  const lid = new THREE.Mesh(kit.laptopLidGeo, kit.laptopChassisMat);
  lid.position.set(0, 0.49, 0);
  lid.castShadow = true;

  const screen = new THREE.Mesh(
    kit.laptopScreenGeo,
    kit.screenMats[screenVariant % kit.screenMats.length]
  );
  screen.position.set(0, 0.49, 0.028);

  hinge.add(lid, screen);
  laptop.add(base, keys, hinge);
  return laptop;
}

/**
 * Composite widescreen external monitor + keyboard + mouse sitting flush at y = 0
 */
function buildExternalMonitorSetup(kit: SharedPropKit, screenVariant: number): THREE.Group {
  const setup = new THREE.Group();

  const pad = new THREE.Mesh(kit.padGeo, kit.deskMatPadMat);
  pad.position.set(0, 0.01, 0.62);

  const monBase = new THREE.Mesh(kit.monBaseGeo, kit.metalFrameMat);
  monBase.position.set(0, 0.03, -0.25);

  const monStand = new THREE.Mesh(kit.monStandGeo, kit.metalFrameMat);
  monStand.position.set(0, 0.5, -0.35);

  const monFrame = new THREE.Mesh(kit.monFrameGeo, kit.laptopChassisMat);
  monFrame.position.set(0, 1.18, -0.24);
  monFrame.castShadow = true;

  const monScreen = new THREE.Mesh(
    kit.monScreenGeo,
    kit.screenMats[screenVariant % kit.screenMats.length]
  );
  monScreen.position.set(0, 1.18, -0.195);

  const kb = new THREE.Mesh(kit.kbGeo, kit.keyboardMat);
  kb.position.set(-0.12, 0.04, 0.56);

  const mouse = new THREE.Mesh(kit.mouseGeo, kit.keyboardMat);
  mouse.position.set(0.84, 0.05, 0.58);

  setup.add(pad, monBase, monStand, monFrame, monScreen, kb, mouse);
  return setup;
}

function buildWaterBottle(kit: SharedPropKit): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(kit.bottleBodyGeo, kit.bottleSteelMat);
  body.position.y = 0.44;
  body.castShadow = true;
  const cap = new THREE.Mesh(kit.bottleCapGeo, kit.bottleCapMat);
  cap.position.y = 0.94;
  g.add(body, cap);
  return g;
}

function buildKraftGiftBox(kit: SharedPropKit): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(kit.kraftBoxGeo, kit.kraftMat);
  box.position.y = 0.23;
  box.castShadow = true;
  const ribbon = new THREE.Mesh(kit.kraftRibbonGeo, kit.blueRibbonMat);
  ribbon.position.y = 0.23;
  g.add(box, ribbon);
  return g;
}

/**
 * Secondary office desk (from Photos 2, 3, 4) with metalon legs, chairs, laptops & monitors
 */
function buildSecondaryOfficeDesk(
  kit: SharedPropKit,
  deskMat: THREE.Material,
  bag: RoomAssetBag,
  seed: number,
  withMonitors: boolean
): THREE.Group {
  const group = new THREE.Group();
  const deskHeight = TABLE_TOP_Y - FLOOR_Y; // 7.2
  const width = 11.4;
  const depth = 4.6;
  const topThickness = 0.36;

  const topGeo = bag.trackGeo(new THREE.BoxGeometry(width, topThickness, depth));
  const top = new THREE.Mesh(topGeo, deskMat);
  top.position.y = deskHeight - topThickness / 2;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  // Metalon square-frame legs at left and right ends
  const legH = deskHeight - topThickness;
  for (const lx of [-width / 2 + 0.35, width / 2 - 0.35]) {
    for (const lz of [-depth / 2 + 0.35, depth / 2 - 0.35]) {
      const leg = new THREE.Mesh(kit.legBoxGeo, kit.metalFrameMat);
      leg.scale.set(0.75, legH, 0.75);
      leg.position.set(lx, legH / 2, lz);
      leg.castShadow = true;
      group.add(leg);
    }
    const crossbarGeo = bag.trackGeo(new THREE.BoxGeometry(0.2, 0.2, depth - 0.6));
    const crossbar = new THREE.Mesh(crossbarGeo, kit.metalFrameMat);
    crossbar.position.set(lx, 0.2, 0);
    group.add(crossbar);
  }

  // Computers on desk top
  const surfaceY = deskHeight;
  for (let i = 0; i < 3; i++) {
    const xOffset = -3.6 + i * 3.6;
    if (withMonitors && i % 2 === 0) {
      const mon = buildExternalMonitorSetup(kit, seed + i);
      mon.position.set(xOffset, surfaceY, -0.35);
      group.add(mon);
    } else {
      const lap = buildLaptop(kit, seed + i);
      lap.position.set(xOffset, surfaceY, 0.1);
      lap.rotation.y = (i - 1) * 0.12;
      group.add(lap);
    }

    // Ergonomic chair at each workstation
    const chair = buildOfficeChair(kit);
    chair.position.set(xOffset, 0, 2.35);
    chair.rotation.y = Math.PI + (i - 1) * 0.08;
    group.add(chair);
  }

  // Bottle or kraft box prop
  const bottle = buildWaterBottle(kit);
  bottle.position.set(-4.8, surfaceY, -1.2);
  group.add(bottle);

  const box = buildKraftGiftBox(kit);
  box.position.set(4.5, surfaceY, -1.1);
  box.rotation.y = 0.25;
  group.add(box);

  return group;
}

/**
 * Main Central Conference / Workstation Table holding the Chessboard + flanking Computers
 */
function buildMainChessTable(
  kit: SharedPropKit,
  tableTopMat: THREE.Material,
  bag: RoomAssetBag,
  accentTrimMat: THREE.Material
): THREE.Group {
  const group = new THREE.Group();
  const tableW = 20.4;
  const tableD = 13.6;
  const topThickness = 0.44;
  const legHeight = TABLE_TOP_Y - topThickness - FLOOR_Y;

  // Tabletop with flush top surface at TABLE_TOP_Y (-0.40)
  const topGeo = bag.trackGeo(new THREE.BoxGeometry(tableW, topThickness, tableD));
  const topMesh = new THREE.Mesh(topGeo, tableTopMat);
  topMesh.position.y = TABLE_TOP_Y - topThickness / 2;
  topMesh.receiveShadow = true;
  topMesh.castShadow = true;
  group.add(topMesh);

  // Subtle recessed metallic edge band around the table
  const edgeGeo = bag.trackGeo(new THREE.BoxGeometry(tableW + 0.08, 0.12, tableD + 0.08));
  const edgeBand = new THREE.Mesh(edgeGeo, kit.metalFrameMat);
  edgeBand.position.y = TABLE_TOP_Y - topThickness + 0.08;
  group.add(edgeBand);

  // Accent inlay strips left & right of the chessboard
  const stripGeo = bag.trackGeo(new THREE.BoxGeometry(0.08, 0.02, 11.4));
  for (const sx of [-5.1, 5.1]) {
    const strip = new THREE.Mesh(stripGeo, accentTrimMat);
    strip.position.set(sx, TABLE_TOP_Y + 0.01, 0);
    group.add(strip);
  }

  // Recessed black outlet boxes (Photo 3 detail)
  const outletGeo = bag.trackGeo(new THREE.BoxGeometry(0.45, 0.04, 1.35));
  for (const ox of [-5.65, 5.65]) {
    const outlet = new THREE.Mesh(outletGeo, kit.powerStripMat);
    outlet.position.set(ox, TABLE_TOP_Y + 0.015, 0);
    group.add(outlet);
  }

  // Steel under-apron rails
  const apronLongGeo = bag.trackGeo(new THREE.BoxGeometry(tableW - 1.4, 0.34, 0.24));
  for (const az of [-tableD / 2 + 0.7, tableD / 2 - 0.7]) {
    const rail = new THREE.Mesh(apronLongGeo, kit.metalFrameMat);
    rail.position.set(0, TABLE_TOP_Y - topThickness - 0.17, az);
    group.add(rail);
  }

  // 4 Heavy Square Metalon Legs + Floor Pads
  const legPositions: [number, number][] = [
    [-tableW / 2 + 0.75, -tableD / 2 + 0.75],
    [tableW / 2 - 0.75, -tableD / 2 + 0.75],
    [-tableW / 2 + 0.75, tableD / 2 - 0.75],
    [tableW / 2 - 0.75, tableD / 2 - 0.75],
  ];
  const padGeo = bag.trackGeo(new THREE.CylinderGeometry(0.32, 0.36, 0.12, 12));
  for (const [lx, lz] of legPositions) {
    const leg = new THREE.Mesh(kit.legBoxGeo, kit.metalFrameMat);
    leg.scale.set(1.25, legHeight, 1.25);
    leg.position.set(lx, FLOOR_Y + legHeight / 2, lz);
    leg.castShadow = true;
    group.add(leg);

    const footPad = new THREE.Mesh(padGeo, kit.chromeMat);
    footPad.position.set(lx, FLOOR_Y + 0.06, lz);
    group.add(footPad);
  }

  // ---- Computers & Props AROUND the chessboard on the Main Table ----
  // Left Flank (x = -7.8) — angled slightly inward toward center
  const leftMonitor = buildExternalMonitorSetup(kit, 0);
  leftMonitor.position.set(-8.1, TABLE_TOP_Y, -2.5);
  leftMonitor.rotation.y = Math.PI * 0.44;
  group.add(leftMonitor);

  const leftLaptop = buildLaptop(kit, 1);
  leftLaptop.position.set(-8.1, TABLE_TOP_Y, 2.9);
  leftLaptop.rotation.y = Math.PI * 0.56;
  group.add(leftLaptop);

  // Right Flank (x = +8.2) — mirrored workstations with clear space for Robôzinho
  const rightMonitor = buildExternalMonitorSetup(kit, 2);
  rightMonitor.position.set(8.2, TABLE_TOP_Y, 2.4);
  rightMonitor.rotation.y = -Math.PI * 0.56;
  group.add(rightMonitor);

  const rightLaptop = buildLaptop(kit, 0);
  rightLaptop.position.set(8.3, TABLE_TOP_Y, -3.5);
  rightLaptop.rotation.y = -Math.PI * 0.44;
  group.add(rightLaptop);

  // Corner Laptops framing the front/back edges outside the board footprint
  const cornerLaptopW = buildLaptop(kit, 2);
  cornerLaptopW.position.set(-7.3, TABLE_TOP_Y, 5.1);
  cornerLaptopW.rotation.y = Math.PI * 0.78;
  group.add(cornerLaptopW);

  const cornerLaptopB = buildLaptop(kit, 1);
  cornerLaptopB.position.set(7.3, TABLE_TOP_Y, -5.1);
  cornerLaptopB.rotation.y = -Math.PI * 0.22;
  group.add(cornerLaptopB);

  // Water bottles & Bold Kraft boxes on the main table corners
  const bottle1 = buildWaterBottle(kit);
  bottle1.position.set(-9.1, TABLE_TOP_Y, 0.2);
  group.add(bottle1);

  const bottle2 = buildWaterBottle(kit);
  bottle2.position.set(9.1, TABLE_TOP_Y, -0.3);
  group.add(bottle2);

  const box1 = buildKraftGiftBox(kit);
  box1.position.set(6.5, TABLE_TOP_Y, 5.1);
  box1.rotation.y = -0.3;
  group.add(box1);

  const box2 = buildKraftGiftBox(kit);
  box2.position.set(-6.5, TABLE_TOP_Y, -5.1);
  box2.rotation.y = 0.35;
  group.add(box2);

  // Ergonomic Swivel Chairs around the main table (positioned off-center so they never block camera sightline to board)
  const chairSpots: [number, number, number][] = [
    [-11.2, -2.2, Math.PI / 2],
    [-11.2, 2.8, Math.PI / 2],
    [11.2, -2.4, -Math.PI / 2],
    [11.2, 2.6, -Math.PI / 2],
    [-6.2, 7.8, Math.PI],
    [6.2, -7.8, 0],
  ];
  for (const [cx, cz, ry] of chairSpots) {
    const chair = buildOfficeChair(kit);
    chair.position.set(cx, FLOOR_Y, cz);
    chair.rotation.y = ry;
    group.add(chair);
  }

  return group;
}

/**
 * Wall-mounted Split Air Conditioner (Photos 2, 3, 4)
 */
function buildSplitACUnit(bag: RoomAssetBag): THREE.Group {
  const ac = new THREE.Group();
  const bodyMat = bag.trackMat(
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.08 })
  );
  const ventMat = bag.trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.2 })
  );
  const ledMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x00e676,
      emissive: 0x00e676,
      emissiveIntensity: 0.9,
    })
  );

  const shell = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(5.6, 1.55, 1.1)), bodyMat);
  const louver = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(5.1, 0.28, 0.16)), ventMat);
  louver.position.set(0, -0.52, 0.5);
  const led = new THREE.Mesh(bag.trackGeo(new THREE.BoxGeometry(0.28, 0.08, 0.06)), ledMat);
  led.position.set(2.1, -0.25, 0.56);

  ac.add(shell, louver, led);
  return ac;
}

/**
 * Ceiling track-lighting rails + cylindrical spotlight cans (Photos 1, 2, 3)
 */
function buildCeilingWithTrackLights(
  bag: RoomAssetBag,
  ceilingColor: number,
  railColor: number,
  ceilingObjects: THREE.Object3D[]
): THREE.Group {
  const ceilingGroup = new THREE.Group();
  const roomW = 54;
  const roomD = 52;

  const ceilingMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: ceilingColor,
      roughness: 0.88,
      metalness: 0.05,
      side: THREE.FrontSide, // Downward-facing normal only -> invisible from above in Topo view!
    })
  );
  const ceilingPlane = new THREE.Mesh(
    bag.trackGeo(new THREE.PlaneGeometry(roomW, roomD)),
    ceilingMat
  );
  ceilingPlane.rotation.x = Math.PI / 2;
  ceilingPlane.position.y = CEILING_Y;
  ceilingGroup.add(ceilingPlane);
  ceilingObjects.push(ceilingPlane);

  const railMat = bag.trackMat(
    new THREE.MeshStandardMaterial({ color: railColor, roughness: 0.45, metalness: 0.65 })
  );
  const panelMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xeef6ff),
      emissiveIntensity: 0.9,
    })
  );

  const railGeo = bag.trackGeo(new THREE.BoxGeometry(0.24, 0.18, 36));
  const canGeo = bag.trackGeo(new THREE.CylinderGeometry(0.18, 0.22, 0.52, 10));
  const ledPanelGeo = bag.trackGeo(new THREE.BoxGeometry(2.4, 0.08, 2.4));

  for (const rx of [-17.5, 17.5]) {
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(rx, CEILING_Y - 0.12, 0);
    ceilingGroup.add(rail);
    ceilingObjects.push(rail);

    for (let z = -14; z <= 14; z += 5.6) {
      const can = new THREE.Mesh(canGeo, railMat);
      can.position.set(rx, CEILING_Y - 0.44, z);
      can.rotation.z = rx < 0 ? -0.38 : 0.38;
      ceilingGroup.add(can);
      ceilingObjects.push(can);
    }
  }

  for (const px of [-7, 7]) {
    for (const pz of [-11, 0, 11]) {
      const panel = new THREE.Mesh(ledPanelGeo, panelMat);
      panel.position.set(px, CEILING_Y - 0.05, pz);
      ceilingGroup.add(panel);
      ceilingObjects.push(panel);
    }
  }

  return ceilingGroup;
}

/**
 * Window wall with black aluminum mullions and bright foliage skyline outside (Photo 2)
 */
function buildWindowFacade(
  bag: RoomAssetBag,
  width: number,
  height: number,
  isNight: boolean
): THREE.Group {
  const facade = new THREE.Group();

  const backdropMat = bag.trackMat(
    new THREE.MeshBasicMaterial({
      color: isNight ? 0x0b162c : 0xdbeafe,
    })
  );
  const backdrop = new THREE.Mesh(
    bag.trackGeo(new THREE.PlaneGeometry(width, height)),
    backdropMat
  );
  backdrop.position.z = -0.7;
  facade.add(backdrop);

  // Exterior tropical foliage silhouettes outside window (Photo 2)
  const leafMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: isNight ? 0x0f2e24 : 0x3b8a3e,
      roughness: 0.85,
      metalness: 0.02,
    })
  );
  const foliageGeo = bag.trackGeo(new THREE.DodecahedronGeometry(2.8, 0));
  for (let i = 0; i < 5; i++) {
    const tree = new THREE.Mesh(foliageGeo, leafMat);
    tree.position.set(-width * 0.35 + i * (width * 0.18), -height * 0.15 + (i % 2) * 1.4, -0.35);
    tree.scale.set(1.2, 1.35, 0.25);
    facade.add(tree);
  }

  // Translucent window glass pane
  const glassMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: isNight ? 0x1e3a5f : 0xe0f2fe,
      transparent: true,
      opacity: 0.22,
      roughness: 0.1,
      metalness: 0.2,
    })
  );
  const pane = new THREE.Mesh(bag.trackGeo(new THREE.PlaneGeometry(width, height)), glassMat);
  facade.add(pane);

  // Black aluminum mullions grid
  const mullionMat = bag.trackMat(
    new THREE.MeshStandardMaterial({ color: 0x0f141d, roughness: 0.4, metalness: 0.72 })
  );
  const vGeo = bag.trackGeo(new THREE.BoxGeometry(0.24, height, 0.28));
  const cols = 4;
  for (let i = 0; i <= cols; i++) {
    const x = -width / 2 + (width / cols) * i;
    const bar = new THREE.Mesh(vGeo, mullionMat);
    bar.position.x = x;
    facade.add(bar);
  }
  const hGeo = bag.trackGeo(new THREE.BoxGeometry(width, 0.24, 0.28));
  for (const y of [-height / 2 + 0.12, 0, height / 2 - 0.12]) {
    const bar = new THREE.Mesh(hGeo, mullionMat);
    bar.position.y = y;
    facade.add(bar);
  }

  return facade;
}

/**
 * Builds one of the 3 selectable 3D Room environments around the chessboard
 */
export function buildRoomEnvironment(
  roomId: SceneRoomId,
  maxAniso: number,
  isSoftwareGl: boolean
): RoomEnvironmentBuild {
  const bag = createAssetBag();
  const kit = createSharedPropKit(bag, maxAniso);
  const group = new THREE.Group();
  const ceilingObjects: THREE.Object3D[] = [];

  const isOffice = roomId === 'bold_office';
  const isStudio = roomId === 'bold_studio';
  const isExec = roomId === 'bold_executive';

  const wallH = CEILING_Y - FLOOR_Y; // 22.0
  const wallCenterY = FLOOR_Y + wallH / 2; // 3.4
  const roomW = 54;
  const roomD = 52;

  // Floor
  const floorTex = bag.trackTex(
    createPorcelainTileTexture(
      isOffice ? 'white' : isStudio ? 'dark' : 'limestone',
      maxAniso
    )
  );
  const floorMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: floorTex,
      roughness: isOffice ? 0.18 : isStudio ? 0.34 : 0.28,
      metalness: isStudio ? 0.22 : 0.08,
    })
  );
  const floorMesh = new THREE.Mesh(bag.trackGeo(new THREE.PlaneGeometry(roomW, roomD)), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = FLOOR_Y;
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  // Main Table surface material
  let mainTableMat: THREE.Material;
  let secondaryDeskMat: THREE.Material;
  if (isExec) {
    const woodTex = bag.trackTex(createWoodDeskTexture(maxAniso));
    mainTableMat = bag.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: woodTex,
        roughness: 0.32,
        metalness: 0.06,
        clearcoat: 0.45,
      })
    );
    secondaryDeskMat = mainTableMat;
  } else {
    mainTableMat = bag.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: isStudio ? 0x131924 : 0x181c24,
        roughness: 0.44,
        metalness: 0.26,
        clearcoat: 0.25,
      })
    );
    secondaryDeskMat = bag.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1a1e26,
        roughness: 0.48,
        metalness: 0.2,
      })
    );
  }

  const accentTrimMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: isStudio ? 0x00e676 : isExec ? 0x00e5c3 : 0x0047a0,
      emissive: new THREE.Color(isStudio ? 0x008a47 : isExec ? 0x007a68 : 0x002d73),
      emissiveIntensity: isStudio ? 0.55 : 0.22,
      roughness: 0.3,
      metalness: 0.6,
    })
  );

  // 1. Central Table holding the Chessboard + surrounding laptops/monitors
  const mainTable = buildMainChessTable(kit, mainTableMat, bag, accentTrimMat);
  group.add(mainTable);

  // 2. Surrounding Office Desks ("demais mesas") with computers & chairs
  const sideDeskSpots: [number, number, number, boolean][] = [
    [-18.8, -8.5, Math.PI / 2, true],
    [-18.8, 8.5, Math.PI / 2, false],
    [18.8, -8.5, -Math.PI / 2, true],
    [18.8, 8.5, -Math.PI / 2, true],
    [0, -16.8, 0, false],
  ];
  sideDeskSpots.forEach(([dx, dz, ry, hasMon], idx) => {
    const desk = buildSecondaryOfficeDesk(kit, secondaryDeskMat, bag, idx + 1, hasMon);
    desk.position.set(dx, FLOOR_Y, dz);
    desk.rotation.y = ry;
    group.add(desk);
  });

  // 3. Architectural Walls matching the selected 3D Room
  const wallWhiteMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: isStudio ? 0x0f172a : isExec ? 0xe7e2d8 : 0xf1f5f9,
      roughness: 0.85,
      metalness: 0.04,
    })
  );
  const boldBlueWallMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      color: isStudio ? 0x0b254d : isExec ? 0x1e293b : 0x003b99,
      roughness: 0.65,
      metalness: 0.1,
    })
  );

  // Left Wall (x = -27): Recreates Photo 1 (image_c6ff4f0b.png) with Bold 3D Emblem Panel
  const leftWall = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(0.6, wallH, roomD)),
    wallWhiteMat
  );
  leftWall.position.set(-roomW / 2, wallCenterY, 0);
  leftWall.receiveShadow = true;
  group.add(leftWall);

  // Royal Blue vertical flanking strips on Left Wall (Photo 1)
  const blueStripGeo = bag.trackGeo(new THREE.BoxGeometry(0.32, wallH - 0.6, 1.9));
  for (const sz of [-10.2, 10.2]) {
    const strip = new THREE.Mesh(blueStripGeo, boldBlueWallMat);
    strip.position.set(-roomW / 2 + 0.4, wallCenterY, sz);
    group.add(strip);
  }

  // Large Raised Bold Solution Signage Panel on Left Wall
  const signTex = bag.trackTex(createBoldWallSignTexture(isStudio, maxAniso));
  const signPanelMat = bag.trackMat(
    new THREE.MeshStandardMaterial({
      map: signTex,
      roughness: 0.36,
      metalness: 0.12,
    })
  );
  const signBacking = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(18.4, 9.6, 0.24)),
    signPanelMat
  );
  signBacking.position.set(-roomW / 2 + 0.48, 2.2, 0);
  signBacking.rotation.y = Math.PI / 2;
  group.add(signBacking);

  // Front Wall (z = -26): Recreates Photo 2 (image_1dc7c503.png) Blue Accent Wall + Projection Screen + Right Window
  const frontLeftWall = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(14, wallH, 0.6)),
    wallWhiteMat
  );
  frontLeftWall.position.set(-20, wallCenterY, -roomD / 2);
  group.add(frontLeftWall);

  const frontBlueWall = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(24, wallH, 0.6)),
    boldBlueWallMat
  );
  frontBlueWall.position.set(-1, wallCenterY, -roomD / 2);
  group.add(frontBlueWall);

  // Projection Screen mounted on Front Blue Wall
  const screenTex = bag.trackTex(createProjectionScreenTexture(isStudio, maxAniso));
  const projFrame = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(15.6, 8.8, 0.28)),
    kit.metalFrameMat
  );
  projFrame.position.set(-1, 3.2, -roomD / 2 + 0.45);
  group.add(projFrame);

  const projScreen = new THREE.Mesh(
    bag.trackGeo(new THREE.PlaneGeometry(14.8, 8.1)),
    bag.trackMat(
      new THREE.MeshStandardMaterial({
        map: screenTex,
        emissiveMap: screenTex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: isStudio ? 0.45 : 0.22,
        roughness: 0.42,
      })
    )
  );
  projScreen.position.set(-1, 3.2, -roomD / 2 + 0.62);
  group.add(projScreen);

  // Right corner Daylight Glass Window on Front Wall (Photo 2)
  const frontWindow = buildWindowFacade(bag, 16, wallH - 3.6, isStudio);
  frontWindow.position.set(19, wallCenterY + 0.8, -roomD / 2 + 0.15);
  group.add(frontWindow);

  const frontWindowSill = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(16.5, 3.8, 0.7)),
    boldBlueWallMat
  );
  frontWindowSill.position.set(19, FLOOR_Y + 1.9, -roomD / 2);
  group.add(frontWindowSill);

  // Right Wall (x = +27): Forward Glass Window + Frosted Whiteboard + Split AC Unit (Photos 2 & 4)
  const rightWindow = buildWindowFacade(bag, 20, wallH - 3.6, isStudio);
  rightWindow.rotation.y = -Math.PI / 2;
  rightWindow.position.set(roomW / 2 - 0.15, wallCenterY + 0.8, -15.5);
  group.add(rightWindow);

  const rightSill = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(0.7, 3.8, 20.5)),
    boldBlueWallMat
  );
  rightSill.position.set(roomW / 2, FLOOR_Y + 1.9, -15.5);
  group.add(rightSill);

  const rightSolidWall = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(0.6, wallH, 32)),
    wallWhiteMat
  );
  rightSolidWall.position.set(roomW / 2, wallCenterY, 10);
  group.add(rightSolidWall);

  // Frosted Glass Whiteboard on Right Wall (Photos 2 & 4)
  const wbTex = bag.trackTex(createWhiteboardTexture(maxAniso));
  const wbBoard = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(11.2, 6.8, 0.14)),
    bag.trackMat(
      new THREE.MeshStandardMaterial({
        map: wbTex,
        roughness: 0.25,
        metalness: 0.08,
      })
    )
  );
  wbBoard.rotation.y = -Math.PI / 2;
  wbBoard.position.set(roomW / 2 - 0.48, 2.0, 7.5);
  group.add(wbBoard);

  // 4 chrome standoffs on whiteboard
  const standoffGeo = bag.trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10));
  for (const wz of [2.5, 12.5]) {
    for (const wy of [-0.9, 4.9]) {
      const st = new THREE.Mesh(standoffGeo, kit.chromeMat);
      st.rotation.z = Math.PI / 2;
      st.position.set(roomW / 2 - 0.42, wy, wz);
      group.add(st);
    }
  }

  // White Split A/C Unit above the whiteboard (Photos 2, 3, 4)
  const acUnit = buildSplitACUnit(bag);
  acUnit.rotation.y = -Math.PI / 2;
  acUnit.position.set(roomW / 2 - 0.85, 8.8, 7.5);
  group.add(acUnit);

  // Back Wall (z = +26): Blue-tinted Glass Office Partition (Photo 3) + Corridor Doorway
  const backBlueGlassWall = new THREE.Mesh(
    bag.trackGeo(new THREE.PlaneGeometry(34, wallH - 1.2)),
    bag.trackMat(
      new THREE.MeshStandardMaterial({
        color: isStudio ? 0x0b2548 : isExec ? 0x38bdf8 : 0x0047a0,
        transparent: true,
        opacity: isExec ? 0.28 : 0.62,
        roughness: 0.12,
        metalness: 0.25,
      })
    )
  );
  backBlueGlassWall.rotation.y = Math.PI;
  backBlueGlassWall.position.set(8, wallCenterY, roomD / 2 - 0.4);
  group.add(backBlueGlassWall);

  // Back wall outer enclosure behind the glass partition
  const backOuterWall = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(roomW, wallH, 0.6)),
    boldBlueWallMat
  );
  backOuterWall.position.set(0, wallCenterY, roomD / 2 + 5.5);
  group.add(backOuterWall);

  // Vertical mullions on the blue glass partition (Photo 3)
  const partMullionGeo = bag.trackGeo(new THREE.BoxGeometry(0.28, wallH, 0.35));
  for (let mx = -9; mx <= 25; mx += 6.8) {
    const m = new THREE.Mesh(partMullionGeo, kit.metalFrameMat);
    m.position.set(mx, wallCenterY, roomD / 2 - 0.4);
    group.add(m);
  }

  // Left back corridor opening frame
  const backLeftWall = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(18, wallH, 0.6)),
    wallWhiteMat
  );
  backLeftWall.position.set(-18, wallCenterY, roomD / 2);
  group.add(backLeftWall);

  // Front-left frosted whiteboard + Split AC unit visible in default White view (Photo 2)
  const frontWb = new THREE.Mesh(
    bag.trackGeo(new THREE.BoxGeometry(9.2, 5.6, 0.14)),
    bag.trackMat(
      new THREE.MeshStandardMaterial({
        map: wbTex,
        roughness: 0.25,
        metalness: 0.08,
      })
    )
  );
  frontWb.position.set(-19.8, 2.1, -roomD / 2 + 0.45);
  group.add(frontWb);

  const frontAc = buildSplitACUnit(bag);
  frontAc.position.set(-19.8, 8.8, -roomD / 2 + 0.85);
  group.add(frontAc);

  // Executive Wood Slats accent flanking the projection screen (no Z-overlap)
  if (isExec) {
    const woodTex = bag.trackTex(createWoodDeskTexture(maxAniso));
    const slatMat = bag.trackMat(
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55, metalness: 0.05 })
    );
    const slatGeo = bag.trackGeo(new THREE.BoxGeometry(0.45, wallH - 1, 0.35));
    for (let sx = -12.6; sx <= 10.6; sx += 1.4) {
      if (sx > -9.8 && sx < 7.8) continue; // Keep projection screen clear
      const slat = new THREE.Mesh(slatGeo, slatMat);
      slat.position.set(sx, wallCenterY, -roomD / 2 + 0.5);
      group.add(slat);
    }
  }

  // 4. Ceiling + Black Track Light Rails (hidden automatically when overhead camera rises)
  const ceilingGroup = buildCeilingWithTrackLights(
    bag,
    isStudio ? 0x0a101e : 0xf1f5f9,
    0x11151d,
    ceilingObjects
  );
  group.add(ceilingGroup);

  // Subtle decorative studio ambient spot under the main table in Dark Studio mode
  if (isStudio && !isSoftwareGl) {
    const underGlow = new THREE.Mesh(
      bag.trackGeo(new THREE.RingGeometry(8.5, 9.0, 48)),
      bag.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x00e676,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
        })
      )
    );
    underGlow.rotation.x = -Math.PI / 2;
    underGlow.position.y = FLOOR_Y + 0.03;
    group.add(underGlow);
  }

  return {
    group,
    ceilingObjects,
    backgroundColor: isStudio ? 0x070b14 : isExec ? 0x1e293b : 0xdbeafe,
    fogColor: isStudio ? 0x070b14 : isExec ? 0x263244 : 0xe2e8f0,
    fogDensity: isStudio ? 0.014 : 0.007,
    hemiSky: isStudio ? 0xb8d4ff : 0xf8fafc,
    hemiGround: isStudio ? 0x0d1424 : 0x94a3b8,
    hemiIntensity: isStudio ? 0.78 : isExec ? 1.05 : 1.15,
    keyColor: isStudio ? 0xfff1dc : 0xfff7ed,
    keyIntensity: isStudio ? 2.0 : 1.85,
    rimColor: isStudio ? 0x38bdf8 : 0x93c5fd,
    rimIntensity: isStudio ? 0.95 : 0.75,
    accentColor: isStudio ? 0x00e676 : 0x38bdf8,
    accentIntensity: isStudio ? 1.4 : 0.65,
    dispose: () => {
      bag.geometries.forEach((g) => g.dispose());
      bag.materials.forEach((m) => m.dispose());
      bag.textures.forEach((t) => t.dispose());
    },
  };
}
