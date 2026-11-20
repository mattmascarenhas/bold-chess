import * as THREE from 'three';
import {
  ClassicKind,
  Color,
  PieceKind,
  SPECIAL_BY_ID,
  SpecialId,
  isSpecialKind,
} from '../game/types';
import { createBoldBadgeTexture, createSpecialEmblemTexture } from './textures';

export interface PieceMaterialSet {
  whiteBody: THREE.MeshPhysicalMaterial;
  whiteTrim: THREE.MeshStandardMaterial;
  blackBody: THREE.MeshPhysicalMaterial;
  blackTrim: THREE.MeshStandardMaterial;
  boldBadgeMat: THREE.MeshStandardMaterial;
  shadowDiscMat: THREE.MeshBasicMaterial;
  darkDetail: THREE.MeshStandardMaterial;
  emblemCache: Map<string, THREE.MeshStandardMaterial>;
  dispose: () => void;
}

export function createPieceMaterialSet(
  metalBump: THREE.CanvasTexture,
  maxAniso: number
): PieceMaterialSet {
  const whiteBody = new THREE.MeshPhysicalMaterial({
    color: 0xeaf0f7,
    metalness: 0.35,
    roughness: 0.22,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
    bumpMap: metalBump,
    bumpScale: 0.004,
  });

  const whiteTrim = new THREE.MeshStandardMaterial({
    color: 0x0047a0,
    metalness: 0.82,
    roughness: 0.22,
  });

  const blackBody = new THREE.MeshPhysicalMaterial({
    color: 0x1a2232,
    metalness: 0.65,
    roughness: 0.26,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
    bumpMap: metalBump,
    bumpScale: 0.005,
  });

  const blackTrim = new THREE.MeshStandardMaterial({
    color: 0x00e676,
    metalness: 0.78,
    roughness: 0.24,
  });

  const badgeTex = createBoldBadgeTexture(maxAniso);
  const boldBadgeMat = new THREE.MeshStandardMaterial({
    map: badgeTex,
    roughness: 0.25,
    metalness: 0.3,
  });

  const shadowDiscMat = new THREE.MeshBasicMaterial({
    color: 0x02040a,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  const darkDetail = new THREE.MeshStandardMaterial({ color: 0x080b12, roughness: 0.3, metalness: 0.4 });

  const emblemCache = new Map<string, THREE.MeshStandardMaterial>();

  return {
    whiteBody,
    whiteTrim,
    blackBody,
    blackTrim,
    boldBadgeMat,
    shadowDiscMat,
    darkDetail,
    emblemCache,
    dispose: () => {
      whiteBody.dispose();
      whiteTrim.dispose();
      blackBody.dispose();
      blackTrim.dispose();
      badgeTex.dispose();
      boldBadgeMat.dispose();
      shadowDiscMat.dispose();
      darkDetail.dispose();
      emblemCache.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      });
      emblemCache.clear();
    },
  };
}

function getEmblemMat(
  mats: PieceMaterialSet,
  specialId: SpecialId,
  color: Color,
  maxAniso: number
): THREE.MeshStandardMaterial {
  const key = `${specialId}_${color}`;
  const existing = mats.emblemCache.get(key);
  if (existing) return existing;
  const tex = createSpecialEmblemTexture(specialId, color, maxAniso);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.28,
    metalness: 0.35,
  });
  mats.emblemCache.set(key, mat);
  return mat;
}

function latheFromProfile(points: [number, number][], segments = 24): THREE.LatheGeometry {
  const vecs = points.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(vecs, segments);
  geo.computeVertexNormals();
  return geo;
}

function addBaseAndBadge(
  group: THREE.Group,
  mats: PieceMaterialSet,
  radius: number,
  color: Color,
  castShadow: boolean
) {
  const bodyMat = color === 'w' ? mats.whiteBody : mats.blackBody;
  const trimMat = color === 'w' ? mats.whiteTrim : mats.blackTrim;

  // Ground contact shadow disc
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.12, 20), mats.shadowDiscMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  group.add(shadow);

  // Chamfered base plinth
  const baseGeo = new THREE.CylinderGeometry(radius * 0.92, radius, 0.14, 24);
  const base = new THREE.Mesh(baseGeo, bodyMat);
  base.position.y = 0.07;
  base.castShadow = castShadow;
  base.receiveShadow = true;
  group.add(base);

  // Brand accent collar ring
  const ringGeo = new THREE.TorusGeometry(radius * 0.91, 0.022, 10, 24);
  const ring = new THREE.Mesh(ringGeo, trimMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.14;
  ring.castShadow = castShadow;
  group.add(ring);

  // Discreet Bold engraved medallion on front of plinth
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), mats.boldBadgeMat);
  badge.position.set(0, 0.075, radius * 0.985);
  badge.rotation.y = color === 'w' ? 0 : Math.PI;
  if (color === 'b') {
    badge.position.z = -radius * 0.985;
  }
  group.add(badge);
}

const lathePool = new Map<string, THREE.LatheGeometry>();

/** Perfil suavizado (spline) girado em torno do eixo Y. Cacheado: a geometria e compartilhada. */
function smoothLathe(key: string, points: [number, number][], samples = 7, segments = 40): THREE.LatheGeometry {
  const cached = lathePool.get(key);
  if (cached) return cached;
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve
    .getPoints(points.length * samples)
    .map((v) => new THREE.Vector2(Math.max(0.0005, v.x), v.y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  lathePool.set(key, geo);
  return geo;
}

let horseGeoCache: THREE.ExtrudeGeometry | null = null;
let maneGeoCache: THREE.TubeGeometry | null = null;

function getHorseGeometry(): THREE.ExtrudeGeometry {
  if (horseGeoCache) return horseGeoCache;
  // Perfil lateral do cavalo olhando para +x (x = frente, y = cima), 0..1 de altura.
  const s = new THREE.Shape();
  s.moveTo(-0.21, 0);
  s.lineTo(0.21, 0);
  s.quadraticCurveTo(0.27, 0.16, 0.14, 0.34); // peito / garganta
  s.quadraticCurveTo(0.2, 0.42, 0.3, 0.47); // queixo
  s.lineTo(0.4, 0.55); // focinho (base)
  s.quadraticCurveTo(0.45, 0.63, 0.36, 0.7); // focinho (ponta)
  s.lineTo(0.2, 0.8); // testa
  s.lineTo(0.17, 1.0); // orelha (frente)
  s.lineTo(0.07, 0.86); // orelha (tras)
  s.bezierCurveTo(-0.08, 0.92, -0.22, 0.76, -0.22, 0.5); // crina
  s.bezierCurveTo(-0.24, 0.34, -0.27, 0.14, -0.21, 0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.2,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 4,
    curveSegments: 14,
  });
  geo.translate(0, 0, -0.1);
  geo.computeVertexNormals();
  horseGeoCache = geo;
  return geo;
}

function getManeGeometry(): THREE.TubeGeometry {
  if (maneGeoCache) return maneGeoCache;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 0.93, 0),
    new THREE.Vector3(-0.1, 0.9, 0),
    new THREE.Vector3(-0.21, 0.74, 0),
    new THREE.Vector3(-0.25, 0.5, 0),
    new THREE.Vector3(-0.26, 0.3, 0),
    new THREE.Vector3(-0.23, 0.12, 0),
  ]);
  maneGeoCache = new THREE.TubeGeometry(curve, 24, 0.032, 8, false);
  return maneGeoCache;
}

function buildClassicPiece(
  kind: ClassicKind,
  color: Color,
  mats: PieceMaterialSet,
  castShadow: boolean
): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = color === 'w' ? mats.whiteBody : mats.blackBody;
  const trimMat = color === 'w' ? mats.whiteTrim : mats.blackTrim;

  const baseRadius = kind === 'k' ? 0.41 : kind === 'q' ? 0.39 : kind === 'p' ? 0.3 : 0.345;
  addBaseAndBadge(group, mats, baseRadius, color, castShadow);

  const add = (mesh: THREE.Mesh, trim = false) => {
    mesh.castShadow = castShadow && !trim;
    group.add(mesh);
    return mesh;
  };

  if (kind === 'p') {
    add(
      new THREE.Mesh(
        smoothLathe('p', [
          [0.25, 0.14],
          [0.2, 0.2],
          [0.14, 0.34],
          [0.11, 0.5],
          [0.13, 0.57],
          [0.22, 0.61],
          [0.22, 0.66],
          [0.13, 0.7],
          [0.1, 0.74],
        ]),
        bodyMat
      )
    );
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 28, 22), bodyMat);
    head.position.y = 0.86;
    add(head);
  } else if (kind === 'r') {
    add(
      new THREE.Mesh(
        smoothLathe('r', [
          [0.3, 0.14],
          [0.24, 0.22],
          [0.19, 0.38],
          [0.18, 0.72],
          [0.2, 0.82],
          [0.3, 0.88],
          [0.3, 1.06],
          [0.25, 1.08],
          [0.22, 1.02],
          [0.01, 1.0],
        ])
      , bodyMat)
    );
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.024, 10, 32), trimMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.8;
    add(collar, true);
    // 6 ameias
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.1), bodyMat);
      merlon.position.set(Math.cos(ang) * 0.265, 1.12, Math.sin(ang) * 0.265);
      merlon.rotation.y = -ang + Math.PI / 2;
      add(merlon);
    }
  } else if (kind === 'b') {
    add(
      new THREE.Mesh(
        smoothLathe('b', [
          [0.31, 0.14],
          [0.24, 0.22],
          [0.16, 0.4],
          [0.12, 0.72],
          [0.14, 0.92],
          [0.23, 0.97],
          [0.23, 1.02],
          [0.14, 1.07],
          [0.19, 1.15],
          [0.2, 1.28],
          [0.14, 1.42],
          [0.06, 1.5],
          [0.005, 1.53],
        ])
      , bodyMat)
    );
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 28), trimMat);
    sash.position.y = 1.27;
    sash.rotation.set(Math.PI / 2.5, 0, Math.PI / 5);
    add(sash, true);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), trimMat);
    finial.position.y = 1.58;
    add(finial, true);
  } else if (kind === 'n') {
    add(
      new THREE.Mesh(
        smoothLathe('n', [
          [0.34, 0.14],
          [0.27, 0.22],
          [0.22, 0.3],
          [0.01, 0.31],
        ])
      , bodyMat)
    );
    const horse = new THREE.Group();
    horse.position.y = 0.3;
    horse.scale.setScalar(1.04);
    horse.rotation.y = color === 'w' ? Math.PI / 2 : -Math.PI / 2;
    const head = new THREE.Mesh(getHorseGeometry(), bodyMat);
    head.castShadow = castShadow;
    horse.add(head);
    const mane = new THREE.Mesh(getManeGeometry(), trimMat);
    horse.add(mane);
    for (const sz of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), mats.darkDetail);
      eye.position.set(0.21, 0.74, sz * 0.13);
      horse.add(eye);
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mats.darkDetail);
      nostril.position.set(0.4, 0.62, sz * 0.09);
      horse.add(nostril);
    }
    group.add(horse);
  } else if (kind === 'q') {
    add(
      new THREE.Mesh(
        smoothLathe('q', [
          [0.35, 0.14],
          [0.27, 0.24],
          [0.18, 0.48],
          [0.14, 0.88],
          [0.16, 1.08],
          [0.26, 1.13],
          [0.26, 1.18],
          [0.17, 1.23],
          [0.2, 1.34],
          [0.28, 1.5],
          [0.29, 1.56],
          [0.2, 1.56],
          [0.01, 1.5],
        ])
      , bodyMat)
    );
    // coroa: 9 pontas com perolas
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 10), bodyMat);
      spike.position.set(Math.cos(ang) * 0.245, 1.64, Math.sin(ang) * 0.245);
      spike.rotation.set(Math.sin(ang) * 0.18, 0, -Math.cos(ang) * 0.18);
      add(spike);
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), trimMat);
      pearl.position.set(Math.cos(ang) * 0.255, 1.76, Math.sin(ang) * 0.255);
      add(pearl, true);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.022, 10, 32), trimMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.4;
    add(band, true);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 14), trimMat);
    orb.position.y = 1.6;
    add(orb, true);
  } else if (kind === 'k') {
    add(
      new THREE.Mesh(
        smoothLathe('k', [
          [0.36, 0.14],
          [0.28, 0.24],
          [0.19, 0.5],
          [0.15, 0.95],
          [0.17, 1.15],
          [0.27, 1.2],
          [0.27, 1.25],
          [0.18, 1.3],
          [0.22, 1.42],
          [0.29, 1.58],
          [0.29, 1.64],
          [0.2, 1.68],
          [0.01, 1.7],
        ])
      , bodyMat)
    );
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.024, 10, 32), trimMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.5;
    add(band, true);
    // cruz grande
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.34, 0.075), trimMat);
    crossV.position.y = 1.9;
    add(crossV, true);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.075, 0.075), trimMat);
    crossH.position.y = 1.96;
    add(crossH, true);
  }

  return group;
}

function buildSpecialPiece(
  kind: SpecialId,
  color: Color,
  mats: PieceMaterialSet,
  castShadow: boolean,
  maxAniso: number
): THREE.Group {
  const group = new THREE.Group();
  const meta = SPECIAL_BY_ID[kind];
  const bodyMat = color === 'w' ? mats.whiteBody : mats.blackBody;

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(meta.accentColor),
    metalness: 0.45,
    roughness: 0.24,
    clearcoat: 0.7,
  });

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xf1c7a6,
    roughness: 0.55,
    metalness: 0.05,
  });

  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.35,
    metalness: 0.4,
  });

  // Ground shadow & pedestal
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), mats.shadowDiscMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.008;
  group.add(shadow);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.16, 24), bodyMat);
  plinth.position.y = 0.08;
  plinth.castShadow = castShadow;
  group.add(plinth);

  const neonRing = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 10, 28), accentMat);
  neonRing.rotation.x = Math.PI / 2;
  neonRing.position.y = 0.16;
  group.add(neonRing);

  // Front emblem plaque
  const emblemMat = getEmblemMat(mats, kind, color, maxAniso);
  const emblemDisc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), emblemMat);
  emblemDisc.position.set(0, 0.56, color === 'w' ? 0.21 : -0.21);
  if (color === 'b') emblemDisc.rotation.y = Math.PI;
  group.add(emblemDisc);

  const facing = color === 'w' ? 1 : -1;

  // Stylized cartoon-refined figurine silhouette specific to each of the 10 Bold people
  if (kind === 'hbarril') {
    // Oak/Steel barrel character with hoops & booted legs
    const barrel = new THREE.Mesh(
      latheFromProfile([
        [0.01, 0.28],
        [0.24, 0.28],
        [0.32, 0.54],
        [0.32, 0.78],
        [0.24, 1.02],
        [0.01, 1.02],
      ]),
      accentMat
    );
    barrel.castShadow = castShadow;
    group.add(barrel);

    for (const hy of [0.42, 0.88]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.026, 8, 24), darkMat);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.y = hy;
      group.add(hoop);
    }

    // Little boots & arms
    for (const sx of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 4, 8), darkMat);
      leg.position.set(sx, 0.24, 0);
      group.add(leg);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.12), darkMat);
    visor.position.set(0, 0.8, 0.24 * facing);
    group.add(visor);
    emblemDisc.position.set(0, 0.58, 0.325 * facing);
  } else {
    // Humanoid stylized figurine (legs, torso, arms, head + signature prop)
    for (const sx of [-0.1, 0.1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.2, 4, 10), darkMat);
      leg.position.set(sx, 0.3, 0);
      leg.castShadow = castShadow;
      group.add(leg);
    }

    const torsoWidth = kind === 'salles' ? 0.24 : kind === 'vitin' ? 0.16 : 0.2;
    const torsoHeight = kind === 'vitin' ? 0.26 : 0.34;
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(torsoWidth, torsoWidth * 0.82, torsoHeight, 16),
      accentMat
    );
    torso.position.y = 0.58;
    torso.castShadow = castShadow;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 16), skinMat);
    head.position.y = kind === 'vitin' ? 0.88 : 0.96;
    head.castShadow = castShadow;
    group.add(head);

    // Signature accessories per person!
    if (kind === 'gabigol') {
      // Raised celebration arms + soccer ball at feet
      for (const sx of [-0.23, 0.23]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), accentMat);
        arm.position.set(sx, 0.76, 0);
        arm.rotation.z = sx < 0 ? 0.55 : -0.55;
        group.add(arm);
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), bodyMat);
      ball.position.set(0.19, 0.24, 0.18 * facing);
      group.add(ball);
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.24), darkMat);
      hair.position.y = 1.1;
      group.add(hair);
    } else if (kind === 'salles') {
      // Broad shoulder pads + sunglasses + championship belt
      for (const sx of [-0.26, 0.26]) {
        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), accentMat);
        shoulder.position.set(sx, 0.72, 0);
        group.add(shoulder);
      }
      const shades = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.08), darkMat);
      shades.position.set(0, 0.98, 0.14 * facing);
      group.add(shades);
    } else if (kind === 'pm') {
      // Police peaked cap + badge visor
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.11, 16), darkMat);
      cap.position.y = 1.1;
      group.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.16), darkMat);
      brim.position.set(0, 1.06, 0.11 * facing);
      group.add(brim);
    } else if (kind === 'ministro') {
      // Flowing judicial cape + gavel staff
      const cape = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.58, 16, 1, true), darkMat);
      cape.position.set(0, 0.52, -0.06 * facing);
      group.add(cape);
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.85, 8), accentMat);
      staff.position.set(0.26, 0.62, 0.08 * facing);
      group.add(staff);
      const gavel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 10), bodyMat);
      gavel.rotation.z = Math.PI / 2;
      gavel.position.set(0.26, 1.04, 0.08 * facing);
      group.add(gavel);
    } else if (kind === 'vitin') {
      // Spring-boots + cap
      for (const sx of [-0.1, 0.1]) {
        const spring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.022, 8, 16), accentMat);
        spring.rotation.x = Math.PI / 2;
        spring.position.set(sx, 0.21, 0);
        group.add(spring);
      }
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), accentMat);
      cap.position.y = 0.91;
      group.add(cap);
    } else if (kind === 'marcola') {
      // Playmaker headband + ball
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.022, 8, 20), accentMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.01;
      group.add(band);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), accentMat);
      orb.position.set(-0.2, 0.25, 0.16 * facing);
      group.add(orb);
    } else if (kind === 'eminnym') {
      // Mirror prism crown + sleek hood
      const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), accentMat);
      prism.position.y = 1.24;
      group.add(prism);
      const hood = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 10, 18), darkMat);
      hood.position.y = 0.88;
      hood.rotation.x = Math.PI / 2.4;
      group.add(hood);
    } else if (kind === 'jac') {
      // Ricochet swept shoulder fins
      for (const sx of [-0.22, 0.22]) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 4), accentMat);
        fin.position.set(sx, 0.72, 0);
        fin.rotation.z = sx < 0 ? 0.7 : -0.7;
        group.add(fin);
      }
    } else if (kind === 'uiu') {
      // Aerodynamic speed wings + aviator goggles
      for (const sx of [-0.24, 0.24]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.32), accentMat);
        wing.position.set(sx, 0.68, -0.06 * facing);
        wing.rotation.z = sx < 0 ? 0.35 : -0.35;
        group.add(wing);
      }
      const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.08), accentMat);
      goggles.position.set(0, 0.98, 0.14 * facing);
      group.add(goggles);
    }
  }

  return group;
}

export function buildChessPieceMesh(
  kind: PieceKind,
  color: Color,
  mats: PieceMaterialSet,
  castShadow: boolean,
  maxAniso: number
): THREE.Group {
  if (isSpecialKind(kind)) {
    return buildSpecialPiece(kind, color, mats, castShadow, maxAniso);
  }
  return buildClassicPiece(kind, color, mats, castShadow);
}

export type RobotEyeKind = 'happy' | 'open' | 'sad' | 'half' | 'heart';

/** Referencias das partes do Robozinho para o animador (sem recriar meshes a cada frame). */
export interface BoldRobotRig {
  root: THREE.Group;
  /** pivo animado (deslocamento/rotacao/escala do corpo todo) */
  body: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftAntenna: THREE.Group;
  rightAntenna: THREE.Group;
  eyeSets: Record<RobotEyeKind, THREE.Group>;
  /** grupo que escala os dois olhos (piscar / arregalar) */
  eyeRoot: THREE.Group;
  dots: THREE.Group;
  visorMat: THREE.MeshPhysicalMaterial;
  mintMat: THREE.MeshStandardMaterial;
  dispose: () => void;
}

/**
 * Robozinho da Bold: corpo branco acetinado, visor azul, aro/antenas verde neon, olhos ciano
 * e escudo Bold no peito. Devolve o rig com pivos nomeados (ombros, pescoco, antenas) e varios
 * conjuntos de olhos (alternados pelo animador).
 */
export function createBoldRobot3D(mats: PieceMaterialSet, castShadow: boolean): BoldRobotRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(o: T): T => {
    owned.push(o);
    return o;
  };

  const whiteShell = own(
    new THREE.MeshPhysicalMaterial({ color: 0xf4f7fb, roughness: 0.24, metalness: 0.12, clearcoat: 0.7 })
  );
  const visorMat = own(
    new THREE.MeshPhysicalMaterial({
      color: 0x002d9c,
      roughness: 0.08,
      metalness: 0.2,
      clearcoat: 1.0,
      emissive: 0x001e7a,
      emissiveIntensity: 0.6,
    })
  );
  const mintMat = own(
    new THREE.MeshStandardMaterial({
      color: 0x00e676,
      emissive: 0x00e676,
      emissiveIntensity: 0.75,
      roughness: 0.25,
      metalness: 0.2,
    })
  );
  const eyeGlow = own(new THREE.MeshBasicMaterial({ color: 0x7df9ff }));
  const heartMat = own(new THREE.MeshBasicMaterial({ color: 0xff5c9a }));
  const pupilMat = own(new THREE.MeshBasicMaterial({ color: 0x06122e }));

  // Torso
  const torso = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.36, 0.32, 8, 20)), whiteShell);
  torso.position.y = 0.56;
  torso.castShadow = castShadow;
  body.add(torso);

  const shield = new THREE.Mesh(own(new THREE.CylinderGeometry(0.2, 0.14, 0.06, 6)), mintMat);
  shield.rotation.x = Math.PI / 2;
  shield.position.set(0, 0.62, 0.34);
  body.add(shield);

  const badge = new THREE.Mesh(own(new THREE.CircleGeometry(0.11, 16)), mats.boldBadgeMat);
  badge.position.set(0, 0.62, 0.375);
  body.add(badge);

  // Bracos com pivo no ombro (pendem para baixo; o animador gira o pivo)
  const armGeo = own(new THREE.CapsuleGeometry(0.1, 0.22, 6, 12));
  const makeArm = (side: -1 | 1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.42, 0.8, 0.04);
    const arm = new THREE.Mesh(armGeo, whiteShell);
    arm.position.set(0, -0.2, 0);
    arm.castShadow = castShadow;
    pivot.add(arm);
    const hand = new THREE.Mesh(own(new THREE.SphereGeometry(0.095, 12, 10)), mintMat);
    hand.position.set(0, -0.4, 0);
    pivot.add(hand);
    body.add(pivot);
    return pivot;
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  // Cabeca (pivo no "pescoco")
  const head = new THREE.Group();
  head.position.set(0, 0.95, 0);
  body.add(head);
  const hy = (y: number) => y - 0.95;

  const skull = new THREE.Mesh(own(new THREE.SphereGeometry(0.46, 24, 20)), whiteShell);
  skull.scale.set(1.14, 0.92, 0.96);
  skull.position.y = hy(1.24);
  skull.castShadow = castShadow;
  head.add(skull);

  const topCrest = new THREE.Mesh(own(new THREE.BoxGeometry(0.24, 0.12, 0.22)), whiteShell);
  topCrest.position.y = hy(1.66);
  head.add(topCrest);

  const podGeo = own(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 14));
  const antGeo = own(new THREE.BoxGeometry(0.06, 0.28, 0.1));
  const makeAntenna = (side: -1 | 1): THREE.Group => {
    const pod = new THREE.Mesh(podGeo, whiteShell);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(side * 0.54, hy(1.24), 0);
    head.add(pod);
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.56, hy(1.32), 0);
    const ant = new THREE.Mesh(antGeo, mintMat);
    ant.position.y = 0.14;
    pivot.add(ant);
    head.add(pivot);
    return pivot;
  };
  const leftAntenna = makeAntenna(-1);
  const rightAntenna = makeAntenna(1);

  const visor = new THREE.Mesh(own(new THREE.SphereGeometry(0.36, 20, 16)), visorMat);
  visor.scale.set(1.12, 0.76, 0.55);
  visor.position.set(0, hy(1.24), 0.28);
  head.add(visor);

  const bezel = new THREE.Mesh(own(new THREE.TorusGeometry(0.35, 0.025, 10, 28)), mintMat);
  bezel.scale.set(1.12, 0.76, 1);
  bezel.position.set(0, hy(1.24), 0.36);
  head.add(bezel);

  // Olhos: varios conjuntos alternados (so um visivel por vez)
  const eyeRoot = new THREE.Group();
  eyeRoot.position.set(0, hy(1.24), 0.48);
  head.add(eyeRoot);

  const eyeSets = {
    happy: new THREE.Group(),
    open: new THREE.Group(),
    sad: new THREE.Group(),
    half: new THREE.Group(),
    heart: new THREE.Group(),
  } as Record<RobotEyeKind, THREE.Group>;

  const arcGeo = own(new THREE.TorusGeometry(0.065, 0.02, 8, 14, Math.PI));
  const discGeo = own(new THREE.SphereGeometry(0.075, 14, 12));
  const pupilGeo = own(new THREE.SphereGeometry(0.033, 10, 8));
  const barGeo = own(new THREE.BoxGeometry(0.15, 0.032, 0.03));
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.07);
  heartShape.bezierCurveTo(-0.1, 0.0, -0.09, 0.09, 0, 0.045);
  heartShape.bezierCurveTo(0.09, 0.09, 0.1, 0.0, 0, -0.07);
  const heartGeo = own(new THREE.ShapeGeometry(heartShape, 10));

  for (const ex of [-0.14, 0.14]) {
    const s = ex < 0 ? -1 : 1;
    const happy = new THREE.Mesh(arcGeo, eyeGlow);
    happy.position.x = ex;
    eyeSets.happy.add(happy);

    const open = new THREE.Mesh(discGeo, eyeGlow);
    open.position.x = ex;
    open.scale.z = 0.5;
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(ex, 0, 0.04);
    eyeSets.open.add(open, pupil);

    const sad = new THREE.Mesh(barGeo, eyeGlow);
    sad.position.x = ex;
    sad.rotation.z = -s * 0.5;
    eyeSets.sad.add(sad);

    const half = new THREE.Mesh(barGeo, eyeGlow);
    half.position.set(ex, -0.01, 0);
    eyeSets.half.add(half);

    const heart = new THREE.Mesh(heartGeo, heartMat);
    heart.position.x = ex;
    heart.scale.setScalar(1.15);
    eyeSets.heart.add(heart);
  }
  for (const k of Object.keys(eyeSets) as RobotEyeKind[]) {
    eyeSets[k].visible = k === 'happy';
    eyeRoot.add(eyeSets[k]);
  }

  // "Pensando": tres pontinhos no visor
  const dots = new THREE.Group();
  dots.visible = false;
  const dotGeo = own(new THREE.SphereGeometry(0.035, 10, 8));
  for (let i = -1; i <= 1; i++) {
    const d = new THREE.Mesh(dotGeo, eyeGlow);
    d.position.x = i * 0.12;
    dots.add(d);
  }
  dots.position.set(0, hy(1.24) - 0.1, 0.49);
  head.add(dots);

  return {
    root,
    body,
    head,
    torso,
    leftArm,
    rightArm,
    leftAntenna,
    rightAntenna,
    eyeSets,
    eyeRoot,
    dots,
    visorMat,
    mintMat,
    dispose: () => owned.forEach((o) => o.dispose()),
  };
}
