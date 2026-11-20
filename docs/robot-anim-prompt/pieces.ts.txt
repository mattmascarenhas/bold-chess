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

  const emblemCache = new Map<string, THREE.MeshStandardMaterial>();

  return {
    whiteBody,
    whiteTrim,
    blackBody,
    blackTrim,
    boldBadgeMat,
    shadowDiscMat,
    emblemCache,
    dispose: () => {
      whiteBody.dispose();
      whiteTrim.dispose();
      blackBody.dispose();
      blackTrim.dispose();
      badgeTex.dispose();
      boldBadgeMat.dispose();
      shadowDiscMat.dispose();
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

function buildClassicPiece(
  kind: ClassicKind,
  color: Color,
  mats: PieceMaterialSet,
  castShadow: boolean
): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = color === 'w' ? mats.whiteBody : mats.blackBody;
  const trimMat = color === 'w' ? mats.whiteTrim : mats.blackTrim;

  const baseRadius = kind === 'k' || kind === 'q' ? 0.37 : kind === 'p' ? 0.29 : 0.33;
  addBaseAndBadge(group, mats, baseRadius, color, castShadow);

  if (kind === 'p') {
    const stem = new THREE.Mesh(
      latheFromProfile([
        [0.24, 0.14],
        [0.19, 0.26],
        [0.11, 0.56],
        [0.16, 0.6],
        [0.1, 0.64],
      ]),
      bodyMat
    );
    stem.castShadow = castShadow;
    group.add(stem);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 22, 18), bodyMat);
    head.position.y = 0.78;
    head.castShadow = castShadow;
    group.add(head);
  } else if (kind === 'r') {
    const body = new THREE.Mesh(
      latheFromProfile([
        [0.28, 0.14],
        [0.24, 0.26],
        [0.19, 0.72],
        [0.25, 0.8],
        [0.25, 0.94],
        [0.17, 0.94],
        [0.17, 0.85],
        [0.01, 0.85],
      ]),
      bodyMat
    );
    body.castShadow = castShadow;
    group.add(body);

    // 6 Castle battlements
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.08), trimMat);
      merlon.position.set(Math.cos(ang) * 0.21, 0.99, Math.sin(ang) * 0.21);
      merlon.rotation.y = -ang;
      merlon.castShadow = castShadow;
      group.add(merlon);
    }
  } else if (kind === 'b') {
    const stem = new THREE.Mesh(
      latheFromProfile([
        [0.28, 0.14],
        [0.21, 0.3],
        [0.13, 0.72],
        [0.2, 0.78],
        [0.14, 0.82],
      ]),
      bodyMat
    );
    stem.castShadow = castShadow;
    group.add(stem);

    const mitre = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 18), bodyMat);
    mitre.scale.set(0.88, 1.32, 0.88);
    mitre.position.y = 1.0;
    mitre.castShadow = castShadow;
    group.add(mitre);

    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 20), trimMat);
    sash.position.y = 1.02;
    sash.rotation.set(Math.PI / 3, 0, Math.PI / 6);
    group.add(sash);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), trimMat);
    finial.position.y = 1.27;
    finial.castShadow = castShadow;
    group.add(finial);
  } else if (kind === 'n') {
    const ped = new THREE.Mesh(
      latheFromProfile([
        [0.28, 0.14],
        [0.23, 0.28],
        [0.19, 0.36],
        [0.01, 0.36],
      ]),
      bodyMat
    );
    ped.castShadow = castShadow;
    group.add(ped);

    // Sculpted extruded horse profile
    const shape = new THREE.Shape();
    shape.moveTo(-0.17, 0);
    shape.lineTo(0.17, 0);
    shape.quadraticCurveTo(0.21, 0.2, 0.1, 0.38);
    shape.lineTo(0.24, 0.42);
    shape.quadraticCurveTo(0.28, 0.48, 0.21, 0.56);
    shape.lineTo(0.08, 0.68);
    shape.lineTo(0.04, 0.8); // Ear
    shape.lineTo(-0.04, 0.72);
    shape.bezierCurveTo(-0.24, 0.62, -0.25, 0.28, -0.17, 0);
    shape.closePath();

    const horseGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.028,
      bevelSegments: 3,
    });
    horseGeo.center();
    const horse = new THREE.Mesh(horseGeo, bodyMat);
    horse.position.y = 0.72;
    horse.rotation.y = color === 'w' ? Math.PI / 2 : -Math.PI / 2;
    horse.castShadow = castShadow;
    group.add(horse);

    // Mane crest accent
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.08), trimMat);
    crest.position.set(0, 0.76, color === 'w' ? 0.12 : -0.12);
    crest.rotation.x = color === 'w' ? 0.25 : -0.25;
    group.add(crest);
  } else if (kind === 'q') {
    const body = new THREE.Mesh(
      latheFromProfile([
        [0.32, 0.14],
        [0.24, 0.34],
        [0.15, 0.92],
        [0.25, 1.02],
        [0.22, 1.16],
        [0.01, 1.16],
      ]),
      bodyMat
    );
    body.castShadow = castShadow;
    group.add(body);

    // 8 crown points
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), trimMat);
      pearl.position.set(Math.cos(ang) * 0.21, 1.21, Math.sin(ang) * 0.21);
      pearl.castShadow = castShadow;
      group.add(pearl);
    }

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 14), trimMat);
    dome.position.y = 1.24;
    group.add(dome);
  } else if (kind === 'k') {
    const body = new THREE.Mesh(
      latheFromProfile([
        [0.32, 0.14],
        [0.25, 0.36],
        [0.16, 1.0],
        [0.25, 1.12],
        [0.2, 1.24],
        [0.01, 1.24],
      ]),
      bodyMat
    );
    body.castShadow = castShadow;
    group.add(body);

    const crownBand = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 10, 24), trimMat);
    crownBand.rotation.x = Math.PI / 2;
    crownBand.position.y = 1.14;
    group.add(crownBand);

    // Beveled cross finial
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.06), trimMat);
    crossV.position.y = 1.38;
    crossV.castShadow = castShadow;
    group.add(crossV);

    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.06), trimMat);
    crossH.position.y = 1.41;
    crossH.castShadow = castShadow;
    group.add(crossH);
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

/**
 * Builds the 3D Robôzinho da Bold mascot matching the reference image:
 * Satin white head/body, royal blue visor, neon green rim & ears, cyan curved eyes,
 * and Bold chest shield.
 */
export function createBoldRobot3D(
  mats: PieceMaterialSet,
  castShadow: boolean
): THREE.Group {
  const root = new THREE.Group();

  const whiteShell = new THREE.MeshPhysicalMaterial({
    color: 0xf4f7fb,
    roughness: 0.24,
    metalness: 0.12,
    clearcoat: 0.7,
  });

  const visorBlue = new THREE.MeshPhysicalMaterial({
    color: 0x002d9c,
    roughness: 0.08,
    metalness: 0.2,
    clearcoat: 1.0,
    emissive: 0x001e7a,
    emissiveIntensity: 0.6,
  });

  const mintGlow = new THREE.MeshStandardMaterial({
    color: 0x00e676,
    emissive: 0x00e676,
    emissiveIntensity: 0.75,
    roughness: 0.25,
    metalness: 0.2,
  });

  const eyeGlow = new THREE.MeshBasicMaterial({ color: 0x7df9ff });

  // Tapered capsule body
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.32, 8, 20), whiteShell);
  torso.position.y = 0.56;
  torso.castShadow = castShadow;
  root.add(torso);

  // Chest shield badge
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.06, 6), mintGlow);
  shield.rotation.x = Math.PI / 2;
  shield.position.set(0, 0.62, 0.34);
  root.add(shield);

  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), mats.boldBadgeMat);
  badge.position.set(0, 0.62, 0.375);
  root.add(badge);

  // Stubby floating arms
  for (const sx of [-0.46, 0.46]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.22, 6, 12), whiteShell);
    arm.position.set(sx, 0.62, 0.04);
    arm.rotation.z = sx < 0 ? 0.5 : -0.7;
    arm.castShadow = castShadow;
    root.add(arm);
  }

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), whiteShell);
  head.scale.set(1.14, 0.92, 0.96);
  head.position.y = 1.24;
  head.castShadow = castShadow;
  root.add(head);

  // Top head crest
  const topCrest = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.22), whiteShell);
  topCrest.position.y = 1.66;
  root.add(topCrest);

  // Ear pods & green antennas
  for (const sx of [-0.54, 0.54]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 14), whiteShell);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(sx, 1.24, 0);
    root.add(pod);

    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.1), mintGlow);
    ant.position.set(sx * 1.04, 1.46, 0);
    root.add(ant);
  }

  // Glowing visor & mint bezel
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16), visorBlue);
  visor.scale.set(1.12, 0.76, 0.55);
  visor.position.set(0, 1.24, 0.28);
  root.add(visor);

  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 10, 28), mintGlow);
  bezel.scale.set(1.12, 0.76, 1);
  bezel.position.set(0, 1.24, 0.36);
  root.add(bezel);

  // Happy curved eyes (^ ^)
  for (const ex of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(
      new THREE.TorusGeometry(0.065, 0.02, 8, 14, Math.PI),
      eyeGlow
    );
    eye.position.set(ex, 1.24, 0.48);
    root.add(eye);
  }

  return root;
}
