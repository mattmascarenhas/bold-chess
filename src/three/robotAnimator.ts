import type { BoldRobotRig, RobotEyeKind } from './pieces';

/** Animacoes do Robozinho. Os ids dos emotes tambem sao animacoes. */
export type RobotAnim =
  | 'idle'
  | 'happy'
  | 'excited'
  | 'cheer'
  | 'spin'
  | 'alert'
  | 'sad'
  | 'thinking'
  | 'smug'
  | 'impressed'
  | 'wave'
  | 'dance'
  | 'glide'
  | 'patrol'
  | 'lookaround'
  | 'mim_de_papai'
  | 'receba'
  | 'que_isso'
  | 'tome'
  | 'bora_bill'
  | 'uiuiui'
  | 'eita_giovanna'
  | 'fala_comigo';

/** Estado base que fica em loop enquanto durar a situacao (IA pensando, xeque...). */
export type RobotMood = 'idle' | 'happy' | 'alert' | 'excited' | 'thinking';

interface Pose {
  px: number;
  py: number;
  pz: number;
  ry: number;
  rx: number;
  rz: number;
  sc: number;
  hx: number;
  hy: number;
  hz: number;
  lax: number; // braco esquerdo: frente/tras
  laz: number; // braco esquerdo: abrir/fechar
  rax: number;
  raz: number;
  ant: number; // inclinacao das antenas
  glow: number; // brilho do verde neon
  eyeScale: number;
  eyeY: number; // piscar (escala vertical)
  visorR: number; // 0 azul .. 1 vermelho
  lookX: number; // olhos para o lado
}

/** Parte direta (nao suavizada): giros completos e saltos exatos. */
interface Direct {
  rx: number;
  ry: number;
  py: number;
}

interface Frame {
  pose: Partial<Pose>;
  direct?: Partial<Direct>;
  eyes?: RobotEyeKind;
  dots?: boolean;
}

const REST: Pose = {
  px: 0,
  py: 0,
  pz: 0,
  ry: 0,
  rx: 0,
  rz: 0,
  sc: 1,
  hx: 0,
  hy: 0,
  hz: 0,
  lax: 0,
  laz: -0.5,
  rax: 0,
  raz: 0.5,
  ant: 0,
  glow: 0.75,
  eyeScale: 1,
  eyeY: 1,
  visorR: 0,
  lookX: 0,
};

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** envelope: sobe rapido e some perto do fim da animacao */
const env = (t: number, dur: number, attack = 0.15, release = 0.3) =>
  Math.min(clamp01(t / attack), clamp01((dur - t) / release));
const hop = (t: number, freq: number, h: number) => Math.abs(Math.sin(t * freq)) * h;

interface Def {
  dur: number;
  frame: (t: number, e: number) => Frame;
  /** suavizacao (maior = mais seco) */
  k?: number;
}

const ARMS_UP = 2.5;

const DEFS: Record<Exclude<RobotAnim, 'idle'>, Def> = {
  happy: {
    dur: 1.7,
    frame: (t, e) => {
      const a = env(t, 1.7);
      return {
        eyes: 'happy',
        pose: {
          py: hop(t, 7, 0.36) * a,
          laz: -ARMS_UP * a - 0.5 * (1 - a),
          raz: ARMS_UP * a + 0.5 * (1 - a),
          ant: Math.sin(t * 12) * 0.25,
          glow: 1.5,
          hz: Math.sin(t * 7) * 0.08,
        },
      };
    },
  },
  excited: {
    dur: 2.4,
    k: 16,
    frame: (t) => {
      const a = env(t, 2.4);
      return {
        eyes: 'happy',
        pose: {
          py: hop(t, 8, 0.55) * a,
          ry: Math.sin(t * 4) * 0.5 * a,
          lax: Math.sin(t * 14) * 0.6 * a,
          laz: -1.9 - Math.sin(t * 14) * 0.5 * a,
          rax: Math.sin(t * 14 + Math.PI) * 0.6 * a,
          raz: 1.9 + Math.sin(t * 14 + Math.PI) * 0.5 * a,
          ant: Math.sin(t * 16) * 0.35,
          glow: 2.1,
          sc: 1 + Math.sin(t * 16) * 0.03,
        },
      };
    },
  },
  cheer: {
    // agacha, pula alto e faz um mortal para tras
    dur: 1.5,
    k: 18,
    frame: (t) => {
      const crouch = t < 0.25 ? easeOut(t / 0.25) : 0;
      const air = clamp01((t - 0.25) / 0.9);
      const lift = Math.sin(air * Math.PI) * 1.5;
      const flip = easeInOut(air) * -TAU;
      return {
        eyes: 'happy',
        direct: { rx: flip, py: lift },
        pose: {
          sc: 1 - crouch * 0.18 + (t > 0.25 && t < 0.5 ? 0.1 : 0),
          py: -crouch * 0.18,
          laz: air > 0 && air < 1 ? -2.3 : -0.5,
          raz: air > 0 && air < 1 ? 2.3 : 0.5,
          glow: 2,
        },
      };
    },
  },
  spin: {
    dur: 1.3,
    k: 18,
    frame: (t) => {
      const p = clamp01(t / 1.1);
      return {
        eyes: 'happy',
        direct: { ry: easeInOut(p) * TAU * 2 },
        pose: {
          py: Math.sin(p * Math.PI) * 0.45,
          laz: -1.55,
          raz: 1.55,
          glow: 1.6,
          ant: Math.sin(t * 20) * 0.3,
        },
      };
    },
  },
  alert: {
    dur: 2.6,
    k: 20,
    frame: (t, e) => {
      const a = env(t, 2.6, 0.08, 0.4);
      const flash = Math.sin(t * 16) > 0 ? 1 : 0.25;
      return {
        eyes: 'open',
        pose: {
          eyeScale: 1.55,
          visorR: flash * a,
          px: Math.sin(t * 55) * 0.03 * a,
          py: 0.14 * a,
          hz: Math.sin(t * 40) * 0.06 * a,
          laz: -1.0 * a - 0.5 * (1 - a),
          raz: 1.0 * a + 0.5 * (1 - a),
          ant: 0.55 * a,
          glow: 0.35 + flash * 0.8,
        },
      };
    },
  },
  sad: {
    dur: 3,
    k: 6,
    frame: (t) => {
      const a = env(t, 3, 0.5, 0.6);
      return {
        eyes: 'sad',
        pose: {
          py: -0.22 * a,
          hx: 0.5 * a,
          rx: 0.12 * a,
          lax: 0.15 * a,
          laz: -0.15 * a - 0.35 * (1 - a),
          rax: 0.15 * a,
          raz: 0.15 * a + 0.35 * (1 - a),
          ant: -0.5 * a,
          glow: 0.25,
          rz: Math.sin(t * 1.8) * 0.04,
        },
      };
    },
  },
  thinking: {
    dur: 6,
    k: 8,
    frame: (t, e) => ({
      eyes: 'open',
      dots: true,
      pose: {
        hz: 0.28,
        hy: 0.45,
        hx: -0.08,
        lookX: 0.5,
        rax: -1.95,
        raz: 0.55,
        py: Math.sin(e * 1.6) * 0.06,
        ry: Math.sin(e * 0.8) * 0.12,
        ant: Math.sin(e * 3) * 0.12,
      },
    }),
  },
  smug: {
    dur: 2.4,
    k: 9,
    frame: (t) => {
      const a = env(t, 2.4, 0.3, 0.5);
      return {
        eyes: 'half',
        pose: {
          hz: -0.22 * a,
          hx: -0.15 * a,
          px: 0.35 * a,
          rz: -0.08 * a,
          lax: -0.9 * a,
          laz: -0.3 * a - 0.2 * (1 - a),
          rax: -0.9 * a,
          raz: 0.3 * a + 0.2 * (1 - a),
          hy: Math.sin(t * 2.4) * 0.12 * a,
          glow: 1.1,
        },
      };
    },
  },
  impressed: {
    dur: 2.4,
    k: 14,
    frame: (t) => {
      const jolt = t < 0.35 ? easeOut(t / 0.35) : 1 - easeInOut((t - 0.35) / 1.6) * 0.55;
      const a = env(t, 2.4, 0.05, 0.5);
      return {
        eyes: 'open',
        pose: {
          eyeScale: 1.75,
          pz: -0.35 * jolt * a,
          py: (t < 0.4 ? Math.sin((t / 0.4) * Math.PI) * 0.35 : 0) + 0.05 * a,
          hx: -0.22 * a,
          rx: -0.15 * jolt * a,
          lax: -0.55 * a,
          laz: -2.2 * a - 0.5 * (1 - a),
          rax: -0.55 * a,
          raz: 2.2 * a + 0.5 * (1 - a),
          ant: 0.5 * a,
          glow: 1.8,
          rz: Math.sin(t * 9) * 0.05 * a,
        },
      };
    },
  },
  wave: {
    dur: 2.2,
    k: 12,
    frame: (t) => {
      const a = env(t, 2.2);
      return {
        eyes: 'happy',
        pose: {
          raz: 2.25 * a + 0.5 * (1 - a) + Math.sin(t * 11) * 0.35 * a,
          hz: 0.14 * a,
          ant: Math.sin(t * 9) * 0.2,
          py: Math.sin(t * 3) * 0.05,
        },
      };
    },
  },
  dance: {
    dur: 3,
    k: 14,
    frame: (t) => {
      const a = env(t, 3);
      const s = Math.sin(t * 8);
      return {
        eyes: 'happy',
        pose: {
          rz: s * 0.25 * a,
          px: Math.sin(t * 4) * 0.45 * a,
          py: hop(t, 8, 0.18) * a,
          ry: Math.sin(t * 4) * 0.35 * a,
          lax: 0,
          laz: -1.2 - s * 0.9 * a,
          raz: 1.2 - s * 0.9 * a,
          ant: s * 0.4,
          glow: 1.5,
        },
      };
    },
  },
  glide: {
    // desliza de lado inclinado, como em um patins
    dur: 2.6,
    k: 7,
    frame: (t) => {
      const p = clamp01(t / 2.4);
      const x = Math.sin(p * Math.PI) * 1.5;
      const vel = Math.cos(p * Math.PI);
      return {
        eyes: 'happy',
        pose: { px: x, rz: -vel * 0.28, ry: -vel * 0.35, py: 0.04, laz: -0.9, raz: 0.9, ant: -vel * 0.4 },
      };
    },
  },
  patrol: {
    // voa em circulo curto em volta do ponto de origem
    dur: 3.2,
    k: 7,
    frame: (t) => {
      const p = clamp01(t / 3);
      const ang = p * TAU;
      const r = 0.9 * Math.sin(p * Math.PI);
      return {
        eyes: 'open',
        pose: {
          px: Math.sin(ang) * r,
          pz: (Math.cos(ang) - 1) * r * 0.6,
          ry: -ang * 0.5,
          rz: Math.cos(ang) * 0.2 * Math.sin(p * Math.PI),
          py: 0.2 * Math.sin(p * Math.PI),
          lookX: Math.cos(ang) * 0.4,
          laz: -1.2,
          raz: 1.2,
        },
      };
    },
  },
  lookaround: {
    dur: 3,
    k: 8,
    frame: (t) => ({
      eyes: 'open',
      pose: {
        hy: Math.sin(t * 2.2) * 0.7 * env(t, 3),
        lookX: Math.sin(t * 2.2) * 0.8,
        hx: 0.05,
        ant: Math.sin(t * 5) * 0.2,
      },
    }),
  },

  // ---------- emotes ----------
  mim_de_papai: {
    // pede colo: bracos abertos pra frente, olhos de coracao
    dur: 2.6,
    k: 10,
    frame: (t) => {
      const a = env(t, 2.6);
      return {
        eyes: 'heart',
        pose: {
          lax: -1.3 * a,
          laz: -1.1 * a - 0.5 * (1 - a),
          rax: -1.3 * a,
          raz: 1.1 * a + 0.5 * (1 - a),
          hz: Math.sin(t * 4) * 0.16 * a,
          py: Math.abs(Math.sin(t * 5)) * 0.1 * a,
          sc: 1 + Math.sin(t * 5) * 0.03,
          glow: 1.3,
        },
      };
    },
  },
  receba: {
    // "toma essa": um braco estendido, corpo inclinado
    dur: 2.2,
    k: 14,
    frame: (t) => {
      const a = env(t, 2.2, 0.12);
      const punch = t < 0.3 ? easeOut(t / 0.3) : 1;
      return {
        eyes: 'happy',
        pose: {
          rax: -1.65 * punch * a,
          raz: 0.25 * a + 0.5 * (1 - a),
          laz: -0.4,
          lax: 0.3 * a,
          rx: 0.22 * a,
          pz: 0.25 * punch * a,
          glow: 1.5 + Math.sin(t * 14) * 0.5,
          hz: -0.1 * a,
        },
      };
    },
  },
  que_isso: {
    // calma, calma: palmas pra baixo e balanca a cabeca
    dur: 2.4,
    k: 12,
    frame: (t) => {
      const a = env(t, 2.4);
      const s = Math.sin(t * 7);
      return {
        eyes: 'half',
        pose: {
          lax: -1.2 * a,
          laz: -0.7 * a - 0.5 * (1 - a) + s * 0.12 * a,
          rax: -1.2 * a,
          raz: 0.7 * a + 0.5 * (1 - a) - s * 0.12 * a,
          hy: Math.sin(t * 9) * 0.4 * a,
          py: -0.05 * a,
        },
      };
    },
  },
  tome: {
    // soco: recua, golpeia e treme
    dur: 1.7,
    k: 24,
    frame: (t) => {
      const wind = t < 0.3 ? easeOut(t / 0.3) : 0;
      const hit = t >= 0.3 && t < 0.9;
      const a = env(t, 1.7, 0.05, 0.3);
      return {
        eyes: 'half',
        pose: {
          pz: hit ? 0.5 : -0.2 * wind,
          rax: hit ? -2.5 : 0.8 * wind,
          raz: 0.3,
          rx: hit ? 0.3 : -0.12 * wind,
          px: hit ? Math.sin(t * 70) * 0.03 : 0,
          visorR: hit ? 0.8 : 0,
          glow: hit ? 2.4 : 0.9,
          laz: -0.4 * a - 0.2,
          ant: hit ? 0.6 : 0,
        },
      };
    },
  },
  bora_bill: {
    dur: 2.6,
    k: 16,
    frame: (t) => {
      const a = env(t, 2.6);
      const up = Math.sin(t * 9) > 0;
      return {
        eyes: 'happy',
        pose: {
          py: hop(t, 9, 0.6) * a,
          laz: (up ? -2.5 : -0.9) * a - 0.5 * (1 - a),
          raz: (up ? 0.9 : 2.5) * a + 0.5 * (1 - a),
          ant: Math.sin(t * 18) * 0.4,
          glow: 2,
          sc: 1 + Math.sin(t * 18) * 0.04,
        },
      };
    },
  },
  uiuiui: {
    // rebolado lateral
    dur: 2.6,
    k: 14,
    frame: (t) => {
      const a = env(t, 2.6);
      const s = Math.sin(t * 10);
      return {
        eyes: 'happy',
        pose: {
          rz: s * 0.4 * a,
          px: Math.sin(t * 5) * 0.5 * a,
          ry: Math.sin(t * 5) * 0.4 * a,
          laz: -1.3 + s * 0.6 * a,
          raz: 1.3 + s * 0.6 * a,
          lax: -0.4 * a,
          rax: -0.4 * a,
          ant: s * 0.5,
          glow: 1.6,
        },
      };
    },
  },
  eita_giovanna: {
    // susto: pula pra tras, olhos enormes, treme
    dur: 2.4,
    k: 22,
    frame: (t) => {
      const a = env(t, 2.4, 0.05, 0.5);
      const jump = t < 0.4 ? Math.sin((t / 0.4) * Math.PI) * 0.6 : 0;
      return {
        eyes: 'open',
        pose: {
          eyeScale: 1.9,
          py: jump,
          pz: -0.5 * a,
          rx: -0.22 * a,
          laz: -2.3 * a - 0.5 * (1 - a),
          raz: 2.3 * a + 0.5 * (1 - a),
          lax: -0.3 * a,
          rax: -0.3 * a,
          px: Math.sin(t * 60) * 0.035 * a,
          visorR: 0.5 * a,
          ant: 0.6 * a,
        },
      };
    },
  },
  fala_comigo: {
    dur: 2.6,
    k: 10,
    frame: (t) => {
      const a = env(t, 2.6);
      return {
        eyes: 'heart',
        pose: {
          hz: 0.32 * a,
          raz: 2.1 * a + 0.5 * (1 - a) + Math.sin(t * 8) * 0.3 * a,
          py: Math.sin(t * 3) * 0.08 + 0.05 * a,
          ry: Math.sin(t * 2) * 0.15 * a,
          glow: 1.2,
          ant: Math.sin(t * 6) * 0.25,
        },
      };
    },
  },
};

/** Pequenas "gracas" do dia a dia que o robo faz sozinho quando fica parado. */
export const FIDGETS: RobotAnim[] = ['wave', 'lookaround', 'glide', 'patrol', 'spin', 'dance', 'happy'];

/** Animacoes que o robo escolhe ao ver uma captura. */
export const REACT_OWN_CAPTURE: RobotAnim[] = ['happy', 'smug', 'spin', 'cheer', 'dance', 'excited'];
export const REACT_OPP_CAPTURE: RobotAnim[] = ['sad', 'impressed', 'alert', 'glide'];
export const REACT_BIG_CAPTURE: RobotAnim[] = ['impressed', 'impressed', 'cheer', 'excited'];

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const _eyeKinds: RobotEyeKind[] = ['happy', 'open', 'sad', 'half', 'heart'];

/**
 * Controlador de animacao do Robozinho: estado base em loop + animacao pontual por cima,
 * com mistura suave (lerp) entre poses. `isActive()` diz se o loop de render precisa seguir.
 */
export class RobotAnimator {
  private cur: Pose = { ...REST };
  private base: RobotMood = 'idle';
  private shot: { name: Exclude<RobotAnim, 'idle'>; t: number } | null = null;
  private elapsed = 0;
  private settle = 0;
  private blinkAt = 2.5;
  private blinkT = -1;
  private lastEyes: RobotEyeKind = 'happy';
  private direct: Direct = { rx: 0, ry: 0, py: 0 };

  constructor(private rig: BoldRobotRig) {}

  setMood(mood: RobotMood) {
    if (mood === this.base) return;
    this.base = mood;
    this.settle = 1.2;
  }

  play(anim: RobotAnim) {
    if (anim === 'idle') {
      this.shot = null;
      this.settle = 1.2;
      return;
    }
    this.shot = { name: anim, t: 0 };
    this.settle = 1.2;
  }

  /** Verdadeiro enquanto houver algo se mexendo (o loop de render nao pode dormir). */
  isActive(): boolean {
    return this.shot !== null || this.base !== 'idle' || this.settle > 0 || this.blinkT >= 0;
  }

  private baseAnim(): Exclude<RobotAnim, 'idle'> | null {
    switch (this.base) {
      case 'thinking':
        return 'thinking';
      case 'alert':
        return 'alert';
      case 'happy':
        return 'happy';
      case 'excited':
        return 'excited';
      default:
        return null;
    }
  }

  update(dt: number) {
    this.elapsed += dt;
    const e = this.elapsed;

    let frame: Frame;
    let k = 10;
    if (this.shot) {
      const def = DEFS[this.shot.name];
      this.shot.t += dt;
      if (this.shot.t >= def.dur) {
        this.shot = null;
        this.settle = 1.2;
        frame = this.idleFrame(e);
      } else {
        frame = def.frame(this.shot.t, e);
        k = def.k ?? 10;
      }
    } else {
      const b = this.baseAnim();
      if (b) {
        const def = DEFS[b];
        // estados base em loop: tempo local ciclico dentro do trecho "estavel" do envelope
        frame = def.frame(0.4 + (e % 0.8), e);
        k = def.k ?? 10;
      } else {
        frame = this.idleFrame(e);
        if (this.settle > 0) this.settle = Math.max(0, this.settle - dt);
      }
    }
    if (this.shot || this.base !== 'idle') this.settle = 1.2;

    // alvo = REST + frame
    const target: Pose = { ...REST, ...frame.pose } as Pose;
    const f = 1 - Math.exp(-k * dt);
    for (const key of POSE_KEYS) this.cur[key] += (target[key] - this.cur[key]) * f;

    // piscar
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const p = this.blinkT / 0.16;
      blink = p < 0.5 ? 1 - p * 2 * 0.9 : 0.1 + (p - 0.5) * 2 * 0.9;
      if (p >= 1) {
        this.blinkT = -1;
        blink = 1;
      }
    } else if (e > this.blinkAt && !this.shot && this.base === 'idle') {
      this.blinkT = 0;
      this.blinkAt = e + 2.5 + Math.random() * 3.5;
    }

    this.direct.rx = frame.direct?.rx ?? 0;
    this.direct.ry = frame.direct?.ry ?? 0;
    this.direct.py = frame.direct?.py ?? 0;

    this.apply(frame, blink);
  }

  private idleFrame(e: number): Frame {
    return {
      eyes: 'happy',
      pose: {
        py: Math.sin(e * 2.0) * 0.1,
        ry: Math.sin(e * 1.1) * 0.08,
        ant: Math.sin(e * 2.6) * 0.1,
        laz: -0.5 + Math.sin(e * 1.7) * 0.05,
        raz: 0.5 - Math.sin(e * 1.7) * 0.05,
      },
    };
  }

  private apply(frame: Frame, blink: number) {
    const c = this.cur;
    const r = this.rig;
    r.body.position.set(c.px, c.py + this.direct.py, c.pz);
    r.body.rotation.set(c.rx + this.direct.rx, c.ry + this.direct.ry, c.rz);
    r.body.scale.setScalar(c.sc);
    r.head.rotation.set(c.hx, c.hy, c.hz);
    r.leftArm.rotation.set(c.lax, 0, c.laz);
    r.rightArm.rotation.set(c.rax, 0, c.raz);
    r.leftAntenna.rotation.z = c.ant;
    r.rightAntenna.rotation.z = -c.ant;

    // olhos
    const eyes = frame.eyes ?? 'happy';
    if (eyes !== this.lastEyes) {
      for (const k of _eyeKinds) r.eyeSets[k].visible = k === eyes;
      this.lastEyes = eyes;
    }
    r.eyeRoot.scale.set(c.eyeScale, c.eyeScale * c.eyeY * blink, 1);
    r.eyeRoot.position.x = c.lookX * 0.12;
    r.dots.visible = !!frame.dots;
    if (frame.dots) {
      r.dots.children.forEach((d, i) => {
        d.scale.setScalar(0.7 + 0.5 * Math.max(0, Math.sin(this.elapsed * 5 - i * 0.9)));
      });
    }

    // brilho/visor
    r.mintMat.emissiveIntensity = c.glow;
    r.visorMat.emissive.setRGB(0.0 + c.visorR * 0.55, 0.12 * (1 - c.visorR) + c.visorR * 0.05, 0.48 * (1 - c.visorR));
    r.visorMat.emissiveIntensity = 0.6 + c.visorR * 0.9;
  }
}

/** Qual reacao o robo tem a um lance (escolha pelo valor da peca capturada, xeque, etc.). */
export function reactionForMove(opts: {
  kind: string;
  capturedKind?: string;
  isCheck: boolean;
  isCheckmate: boolean;
  moverIsViewer: boolean | null; // null = espectador
  viewerWon: boolean | null;
}): RobotAnim | null {
  const { kind, capturedKind, isCheck, isCheckmate, moverIsViewer, viewerWon } = opts;
  if (isCheckmate) {
    if (viewerWon === null) return 'impressed';
    return viewerWon ? 'cheer' : 'sad';
  }
  if (kind === 'convocation' || kind === 'promotion') return Math.random() < 0.5 ? 'excited' : 'cheer';
  if (capturedKind) {
    const big = capturedKind === 'q' || capturedKind === 'r' || (capturedKind.length > 1 && capturedKind !== 'pm');
    if (big) return pick(REACT_BIG_CAPTURE);
    if (moverIsViewer === null) return pick(['impressed', 'happy', 'smug']);
    return moverIsViewer ? pick(REACT_OWN_CAPTURE) : pick(REACT_OPP_CAPTURE);
  }
  if (isCheck) return 'alert';
  if (kind === 'castling') return pick(['wave', 'dance']);
  return Math.random() < 0.12 ? pick(['glide', 'lookaround', 'wave']) : null;
}
