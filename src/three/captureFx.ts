import * as THREE from 'three';

/** Animacoes de "peca derrotada". Uma e sorteada a cada captura. */
export type CaptureFxKind =
  | 'explosion'
  | 'shatter'
  | 'lightning'
  | 'blackhole'
  | 'confetti'
  | 'smoke'
  | 'fire'
  | 'ice'
  | 'launch'
  | 'digital';

export const ALL_CAPTURE_FX: CaptureFxKind[] = [
  'explosion',
  'shatter',
  'lightning',
  'blackhole',
  'confetti',
  'smoke',
  'fire',
  'ice',
  'launch',
  'digital',
];

export interface FxColors {
  /** cor do corpo da peca derrotada */
  body: number;
  /** cor de destaque da peca (aro) */
  accent: number;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const ringGeo = new THREE.RingGeometry(0.82, 1, 40);

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  v: THREE.Vector3;
  w: THREE.Vector3;
  g: number;
  s0: number;
  s1: number;
  life: number;
  age: number;
  delay: number;
  /** 0 = nao desvanece; 1 = desvanece ao longo da vida */
  fade: number;
  spin?: boolean;
  /** movimento custom (ex.: orbita do buraco negro) */
  custom?: (p: Particle, t: number) => void;
  baseOpacity: number;
}

interface PartOpts {
  geo?: THREE.BufferGeometry;
  color: number;
  pos: THREE.Vector3;
  v?: THREE.Vector3;
  w?: THREE.Vector3;
  g?: number;
  s0: number;
  s1?: number;
  life: number;
  delay?: number;
  fade?: number;
  opacity?: number;
  additive?: boolean;
  scaleXYZ?: [number, number, number];
  rot?: [number, number, number];
  custom?: (p: Particle, t: number) => void;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

class FxInstance {
  readonly group = new THREE.Group();
  readonly parts: Particle[] = [];
  age = 0;
  constructor(
    readonly victim: THREE.Object3D,
    readonly base: THREE.Vector3,
    readonly dur: number,
    private delay: number,
    /** anima o proprio objeto da peca derrotada */
    readonly victimFn: (t: number, victim: THREE.Object3D, base: THREE.Vector3) => void,
    /** emissao continua de particulas (opcional) */
    readonly tick?: (fx: FxInstance, t: number, dt: number) => void
  ) {
    this.group.position.copy(base);
  }

  add(o: PartOpts): Particle {
    const mat = new THREE.MeshBasicMaterial({
      color: o.color,
      transparent: true,
      opacity: o.opacity ?? 1,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(o.geo ?? sphereGeo, mat);
    mesh.position.copy(o.pos);
    if (o.rot) mesh.rotation.set(...o.rot);
    mesh.visible = false;
    const p: Particle = {
      mesh,
      mat,
      v: o.v ?? new THREE.Vector3(),
      w: o.w ?? new THREE.Vector3(),
      g: o.g ?? 0,
      s0: o.s0,
      s1: o.s1 ?? o.s0,
      life: o.life,
      age: 0,
      delay: o.delay ?? 0,
      fade: o.fade ?? 1,
      custom: o.custom,
      baseOpacity: o.opacity ?? 1,
    };
    if (o.scaleXYZ) mesh.userData.sxyz = o.scaleXYZ;
    this.group.add(mesh);
    this.parts.push(p);
    return p;
  }

  /** Avanca. Devolve true quando terminou. */
  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return false;
      dt = -this.delay;
      this.delay = 0;
    }
    this.age += dt;
    this.victimFn(this.age, this.victim, this.base);
    this.tick?.(this, this.age, dt);

    for (const p of this.parts) {
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) continue;
      }
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.visible = true;
      if (p.custom) p.custom(p, t);
      else {
        p.v.y += p.g * dt;
        p.mesh.position.addScaledVector(p.v, dt);
        if (p.mesh.position.y < 0.03 && p.g < 0) {
          p.mesh.position.y = 0.03;
          p.v.y *= -0.25;
          p.v.x *= 0.7;
          p.v.z *= 0.7;
        }
      }
      if (p.w.lengthSq() > 0) {
        p.mesh.rotation.x += p.w.x * dt;
        p.mesh.rotation.y += p.w.y * dt;
        p.mesh.rotation.z += p.w.z * dt;
      }
      const s = p.s0 + (p.s1 - p.s0) * t;
      const sx = p.mesh.userData.sxyz as [number, number, number] | undefined;
      if (sx) p.mesh.scale.set(s * sx[0], s * sx[1], s * sx[2]);
      else p.mesh.scale.setScalar(Math.max(0.0001, s));
      if (p.fade > 0) p.mat.opacity = p.baseOpacity * (1 - Math.pow(t, 1.6) * p.fade);
    }
    return this.age >= this.dur;
  }

  dispose() {
    for (const p of this.parts) p.mat.dispose();
    this.parts.length = 0;
    this.group.removeFromParent();
  }
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function randDir(up = 0.6): THREE.Vector3 {
  const a = Math.random() * TAU;
  const r = Math.sqrt(Math.random());
  return V(Math.cos(a) * r, up + Math.random() * 0.6, Math.sin(a) * r).normalize();
}

/** Anima de forma preguicosa (sem criar objetos): tremor */
function shake(victim: THREE.Object3D, base: THREE.Vector3, amt: number) {
  victim.position.set(base.x + (Math.random() - 0.5) * amt, base.y, base.z + (Math.random() - 0.5) * amt);
}

export class CaptureFxManager {
  private root = new THREE.Group();
  private list: FxInstance[] = [];
  private lastKind: CaptureFxKind | null = null;
  private lite: boolean;

  constructor(parent: THREE.Object3D, lite: boolean) {
    this.lite = lite;
    parent.add(this.root);
  }

  get active(): boolean {
    return this.list.length > 0;
  }

  /** Escolhe um efeito (sem repetir o anterior; pecas grandes puxam as animacoes mais espetaculares). */
  choose(capturedKind: string): CaptureFxKind {
    const big = capturedKind === 'q' || capturedKind === 'k';
    const pool = big
      ? (['explosion', 'blackhole', 'lightning', 'launch', 'fire'] as CaptureFxKind[])
      : ALL_CAPTURE_FX;
    let kind = pool[Math.floor(Math.random() * pool.length)];
    if (kind === this.lastKind) kind = pool[(pool.indexOf(kind) + 1) % pool.length];
    this.lastKind = kind;
    return kind;
  }

  /** Toca o efeito sobre `victim` (que passa a pertencer ao gerenciador). */
  play(kind: CaptureFxKind, victim: THREE.Object3D, colors: FxColors, delay = 0.2) {
    this.root.attach(victim);
    const base = victim.position.clone();
    const n = (full: number) => (this.lite ? Math.ceil(full / 2) : full);
    const center = V(0, 0.6, 0);
    const fx = this.build(kind, victim, base, colors, delay, center, n);
    this.root.add(fx.group);
    this.list.push(fx);
  }

  private build(
    kind: CaptureFxKind,
    victim: THREE.Object3D,
    base: THREE.Vector3,
    colors: FxColors,
    delay: number,
    center: THREE.Vector3,
    n: (v: number) => number
  ): FxInstance {
    const hide = (t: number, at: number) => {
      victim.visible = t < at;
    };
    const ring = (fx: FxInstance, color: number, s1: number, life: number, d = 0) =>
      fx.add({
        geo: ringGeo,
        color,
        pos: V(0, 0.05, 0),
        rot: [-Math.PI / 2, 0, 0],
        s0: 0.25,
        s1,
        life,
        delay: d,
        additive: true,
        opacity: 0.9,
      });

    switch (kind) {
      case 'explosion': {
        const fx = new FxInstance(victim, base, 1.2, delay, (t, v) => {
          if (t < 0.05) shake(v, base, 0.06);
          hide(t, 0.06);
        });
        fx.add({ color: 0xfff2b0, pos: center, s0: 0.15, s1: 1.7, life: 0.28, additive: true, opacity: 0.95 });
        fx.add({ color: 0xff7a1a, pos: center, s0: 0.1, s1: 1.2, life: 0.4, additive: true, opacity: 0.7 });
        ring(fx, 0xffb347, 2.6, 0.5);
        ring(fx, 0xffe08a, 1.9, 0.4, 0.06);
        for (let i = 0; i < n(18); i++) {
          const c = [0xff5a1f, 0xff9a1f, 0xffd23f][i % 3];
          fx.add({
            color: c,
            pos: center.clone(),
            v: randDir(0.5).multiplyScalar(rnd(2.5, 6)),
            g: -9,
            s0: rnd(0.1, 0.2),
            s1: 0,
            life: rnd(0.5, 0.9),
            additive: true,
          });
        }
        for (let i = 0; i < n(10); i++) {
          fx.add({
            geo: boxGeo,
            color: i % 3 === 0 ? colors.accent : colors.body,
            pos: center.clone(),
            v: randDir(0.8).multiplyScalar(rnd(2.5, 5.5)),
            w: V(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)),
            g: -13,
            s0: rnd(0.07, 0.14),
            s1: 0.02,
            life: rnd(0.9, 1.2),
            fade: 0.6,
          });
        }
        return fx;
      }

      case 'shatter': {
        const fx = new FxInstance(victim, base, 1.5, delay, (t, v) => {
          if (t < 0.2) shake(v, base, 0.09);
          hide(t, 0.2);
        });
        ring(fx, 0xffffff, 1.6, 0.35, 0.2);
        for (let i = 0; i < n(26); i++) {
          fx.add({
            geo: boxGeo,
            color: i % 4 === 0 ? colors.accent : colors.body,
            pos: V(rnd(-0.2, 0.2), rnd(0.15, 1.2), rnd(-0.2, 0.2)),
            v: randDir(0.4).multiplyScalar(rnd(1.2, 3.2)),
            w: V(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)),
            g: -14,
            s0: rnd(0.06, 0.17),
            s1: 0.03,
            life: rnd(1.0, 1.4),
            delay: 0.2,
            fade: 0.8,
            scaleXYZ: [rnd(0.7, 1.4), rnd(0.5, 1.2), rnd(0.7, 1.4)],
          });
        }
        return fx;
      }

      case 'lightning': {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 9; i++) {
          const y = 7 - (i / 9) * 6.4;
          pts.push(V(i === 0 || i === 9 ? 0 : rnd(-0.4, 0.4), y, i === 0 || i === 9 ? 0 : rnd(-0.4, 0.4)));
        }
        const boltGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 24, 0.05, 5, false);
        const fx = new FxInstance(
          victim,
          base,
          1.2,
          delay,
          (t, v) => {
            v.visible = t < 0.5 || t > 0.62 ? t < 0.68 : Math.random() > 0.5;
            if (t < 0.5) shake(v, base, 0.05);
            v.scale.setScalar(t < 0.5 ? 1 : Math.max(0.0001, 1 - (t - 0.5) / 0.18));
          },
          (f, t) => {
            const bolt = f.parts[0];
            if (bolt) bolt.mat.opacity = t < 0.5 ? (Math.random() > 0.35 ? 1 : 0.2) : 0;
          }
        );
        const bolt = fx.add({ geo: boltGeo, color: 0xcdeeff, pos: V(), s0: 1, s1: 1, life: 0.5, fade: 0, additive: true });
        void bolt;
        fx.add({ color: 0x7dd3fc, pos: center, s0: 0.2, s1: 1.4, life: 0.5, additive: true, opacity: 0.7, delay: 0.0 });
        ring(fx, 0x7dd3fc, 2.2, 0.5, 0.05);
        for (let i = 0; i < n(18); i++) {
          fx.add({
            geo: boxGeo,
            color: i % 2 ? 0xe0f2fe : 0x38bdf8,
            pos: V(rnd(-0.2, 0.2), rnd(0.1, 1), rnd(-0.2, 0.2)),
            v: randDir(0.3).multiplyScalar(rnd(2, 5)),
            g: -10,
            s0: rnd(0.04, 0.09),
            s1: 0,
            life: rnd(0.4, 0.8),
            additive: true,
            delay: 0.45,
          });
        }
        const origDispose = fx.dispose.bind(fx);
        fx.dispose = () => {
          boltGeo.dispose();
          origDispose();
        };
        return fx;
      }

      case 'blackhole': {
        const fx = new FxInstance(victim, base, 1.4, delay, (t, v) => {
          const p = Math.min(1, t / 0.85);
          const s = Math.max(0.0001, 1 - p * p);
          v.scale.set(s, s, s);
          v.rotation.y += 0.5 + p * 1.4;
          v.position.set(base.x, base.y + p * 0.5, base.z);
          v.visible = p < 1;
        });
        fx.add({ color: 0x0b0214, pos: center, s0: 0.05, s1: 0.5, life: 1.3, fade: 0, opacity: 0.95 });
        const torusGeo = new THREE.TorusGeometry(1, 0.06, 6, 32);
        fx.add({
          geo: torusGeo,
          color: 0xa855f7,
          pos: center,
          rot: [Math.PI / 2.4, 0, 0],
          s0: 0.9,
          s1: 0.2,
          life: 1.1,
          additive: true,
          w: V(0, 0, 5),
          opacity: 0.9,
        });
        for (let i = 0; i < n(22); i++) {
          const a0 = Math.random() * TAU;
          const r0 = rnd(1.0, 1.9);
          const sp = rnd(3, 6);
          fx.add({
            color: i % 2 ? 0xc084fc : 0x7c3aed,
            pos: center.clone(),
            s0: rnd(0.05, 0.1),
            s1: 0.01,
            life: rnd(0.7, 1.1),
            delay: rnd(0, 0.35),
            additive: true,
            custom: (p, t) => {
              const r = r0 * (1 - t);
              const a = a0 + t * sp;
              p.mesh.position.set(Math.cos(a) * r, 0.6 + (1 - t) * 0.5 * Math.sin(a * 0.5), Math.sin(a) * r);
            },
          });
        }
        const origDispose = fx.dispose.bind(fx);
        fx.dispose = () => {
          torusGeo.dispose();
          origDispose();
        };
        return fx;
      }

      case 'confetti': {
        const fx = new FxInstance(victim, base, 1.8, delay, (t, v) => {
          const s = t < 0.1 ? 1 + t * 3 : 1.3;
          v.scale.setScalar(s);
          hide(t, 0.12);
        });
        ring(fx, 0xfde047, 1.8, 0.4, 0.1);
        const colors2 = [0xf472b6, 0xfacc15, 0x34d399, 0x60a5fa, 0xfb923c, 0xa78bfa];
        for (let i = 0; i < n(40); i++) {
          fx.add({
            geo: boxGeo,
            color: colors2[i % colors2.length],
            pos: center.clone(),
            v: randDir(1.4).multiplyScalar(rnd(2, 5.5)),
            w: V(rnd(-14, 14), rnd(-14, 14), rnd(-14, 14)),
            g: -6,
            s0: 0.12,
            s1: 0.1,
            life: rnd(1.1, 1.7),
            delay: 0.1,
            fade: 0.7,
            scaleXYZ: [1, 0.15, 0.6],
          });
        }
        return fx;
      }

      case 'smoke': {
        const fx = new FxInstance(victim, base, 1.4, delay, (t, v) => {
          const s = Math.max(0.0001, 1 - t / 0.28);
          v.scale.set(s, s, s);
          v.rotation.y += 0.4;
          v.visible = t < 0.28;
        });
        for (let i = 0; i < n(14); i++) {
          fx.add({
            color: i % 3 === 0 ? 0xe2e8f0 : 0x94a3b8,
            pos: V(rnd(-0.25, 0.25), rnd(0.2, 0.8), rnd(-0.25, 0.25)),
            v: V(rnd(-0.5, 0.5), rnd(0.6, 1.5), rnd(-0.5, 0.5)),
            s0: 0.15,
            s1: rnd(0.45, 0.75),
            life: rnd(0.9, 1.3),
            delay: rnd(0, 0.15),
            opacity: 0.6,
          });
        }
        for (let i = 0; i < n(8); i++) {
          fx.add({
            color: 0xffffff,
            pos: center.clone(),
            v: randDir(0.8).multiplyScalar(rnd(1.5, 3)),
            g: -3,
            s0: 0.06,
            s1: 0,
            life: 0.6,
            additive: true,
          });
        }
        return fx;
      }

      case 'fire': {
        const fx = new FxInstance(
          victim,
          base,
          1.5,
          delay,
          (t, v) => {
            shake(v, base, 0.08);
            const s = Math.max(0.0001, 1 - t / 0.7);
            v.scale.set(s, s, s);
            v.visible = t < 0.7;
          },
          (f, t, dt) => {
            // chamas sobem enquanto a peca queima
            if (t < 0.6 && Math.random() < dt * 60) {
              f.add({
                color: [0xff3b1f, 0xff8a1f, 0xffd23f][Math.floor(Math.random() * 3)],
                pos: V(rnd(-0.28, 0.28), rnd(0.05, 0.9), rnd(-0.28, 0.28)),
                v: V(rnd(-0.3, 0.3), rnd(1.5, 3.2), rnd(-0.3, 0.3)),
                s0: rnd(0.14, 0.24),
                s1: 0,
                life: rnd(0.45, 0.8),
                additive: true,
              });
            }
          }
        );
        ring(fx, 0xff6a1f, 1.5, 0.5);
        for (let i = 0; i < n(8); i++) {
          fx.add({
            color: 0x334155,
            pos: V(rnd(-0.2, 0.2), 1, rnd(-0.2, 0.2)),
            v: V(rnd(-0.3, 0.3), rnd(0.8, 1.4), rnd(-0.3, 0.3)),
            s0: 0.12,
            s1: 0.45,
            life: 1.0,
            delay: 0.3 + i * 0.05,
            opacity: 0.5,
          });
        }
        return fx;
      }

      case 'ice': {
        const fx = new FxInstance(victim, base, 1.6, delay, (t, v) => {
          if (t < 0.35) shake(v, base, 0.025);
          hide(t, 0.35);
        });
        fx.add({ color: 0xbae6fd, pos: center, s0: 0.3, s1: 1.2, life: 0.35, additive: true, opacity: 0.6 });
        ring(fx, 0x7dd3fc, 2.3, 0.55, 0.35);
        for (let i = 0; i < n(24); i++) {
          fx.add({
            geo: boxGeo,
            color: i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0x7dd3fc : 0xa5f3fc,
            pos: V(rnd(-0.2, 0.2), rnd(0.1, 1.3), rnd(-0.2, 0.2)),
            v: randDir(0.3).multiplyScalar(rnd(1.5, 3.8)),
            w: V(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)),
            g: -11,
            s0: rnd(0.06, 0.14),
            s1: 0.02,
            life: rnd(1.0, 1.4),
            delay: 0.35,
            fade: 0.8,
            scaleXYZ: [0.5, rnd(1.4, 2.6), 0.5],
            opacity: 0.9,
          });
        }
        return fx;
      }

      case 'launch': {
        const fx = new FxInstance(
          victim,
          base,
          1.5,
          delay,
          (t, v) => {
            const p = Math.min(1, t / 0.85);
            v.position.set(base.x, base.y + p * p * 15, base.z);
            v.rotation.y += 0.55;
            v.rotation.z = Math.sin(t * 20) * 0.25;
            const s = 1 - p * 0.55;
            v.scale.setScalar(s);
            v.visible = p < 1;
          },
          (f, t, dt) => {
            if (t < 0.85 && Math.random() < dt * 70) {
              const p = t / 0.85;
              f.add({
                color: Math.random() < 0.5 ? 0xfde68a : 0xffffff,
                pos: V(rnd(-0.1, 0.1), 0.5 + p * p * 15, rnd(-0.1, 0.1)),
                v: V(rnd(-0.4, 0.4), rnd(-0.6, 0.2), rnd(-0.4, 0.4)),
                s0: rnd(0.07, 0.13),
                s1: 0,
                life: 0.5,
                additive: true,
              });
            }
            // estrelinha no ceu quando some
            if (t >= 0.85 && !f.group.userData.star) {
              f.group.userData.star = true;
              f.add({ color: 0xfff7c2, pos: V(0, 15.5, 0), s0: 0.1, s1: 1.6, life: 0.35, additive: true });
              for (let i = 0; i < 10; i++) {
                f.add({
                  color: 0xfde68a,
                  pos: V(0, 15.5, 0),
                  v: randDir(0).multiplyScalar(rnd(2, 4)),
                  g: -6,
                  s0: 0.08,
                  s1: 0,
                  life: 0.6,
                  additive: true,
                });
              }
            }
          }
        );
        ring(fx, 0xfde68a, 1.4, 0.35);
        return fx;
      }

      case 'digital':
      default: {
        const fx = new FxInstance(victim, base, 1.4, delay, (t, v) => {
          // desliga como TV antiga: achata na vertical e depois afina
          if (t < 0.18) v.scale.set(1 + t * 0.6, Math.max(0.03, 1 - t / 0.18), 1 + t * 0.6);
          else v.scale.set(Math.max(0.0001, 1 - (t - 0.18) / 0.12), 0.03, 1);
          v.visible = t < 0.3;
        });
        for (let i = 0; i < n(30); i++) {
          fx.add({
            geo: boxGeo,
            color: i % 4 === 0 ? 0xffffff : 0x00e676,
            pos: V(rnd(-0.32, 0.32), rnd(0.05, 1.2), rnd(-0.32, 0.32)),
            v: V(rnd(-0.2, 0.2), rnd(1.0, 3.2), rnd(-0.2, 0.2)),
            s0: rnd(0.05, 0.1),
            s1: 0.01,
            life: rnd(0.7, 1.2),
            delay: rnd(0, 0.25),
            additive: true,
          });
        }
        ring(fx, 0x00e676, 1.7, 0.5, 0.1);
        return fx;
      }
    }
  }

  update(dt: number): boolean {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const fx = this.list[i];
      if (fx.update(dt)) {
        fx.victim.removeFromParent();
        fx.dispose();
        this.list.splice(i, 1);
      }
    }
    return this.list.length > 0;
  }

  dispose() {
    for (const fx of this.list) {
      fx.victim.removeFromParent();
      fx.dispose();
    }
    this.list.length = 0;
    this.root.removeFromParent();
  }
}
