import { MEME_EMOTES, SPECIAL_BY_ID, SpecialId } from '../game/types';
import { apiUrl } from '../net/serverUrl';

interface AudioManifest {
  files: string[];
  config: {
    triggers?: Record<string, { file: string; label: string }>;
    emotes?: Record<string, { file: string; label: string }>;
  } | null;
}

class BoldSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private volume = 0.7;
  private availableFiles = new Set<string>(
    MEME_EMOTES.map((e) => e.audioFile.replace(/^\/audio\//, ''))
  );
  private config: AudioManifest['config'] = null;
  private manifestLoaded = false;
  private activeEmoteAudio: HTMLAudioElement | null = null;

  async initManifest() {
    if (this.manifestLoaded) return;
    this.manifestLoaded = true;
    try {
      const res = await fetch(apiUrl('/api/audio-manifest'));
      if (!res.ok) return;
      const data = (await res.json()) as AudioManifest;
      data.files.forEach((f) => this.availableFiles.add(f));
      this.config = data.config;
    } catch {
      // Fallback to pre-seeded meme list & Web Audio synth
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted && this.activeEmoteAudio) {
      this.activeEmoteAudio.pause();
      this.activeEmoteAudio.currentTime = 0;
    }
  }

  getMuted(): boolean {
    return this.muted;
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.activeEmoteAudio) {
      this.activeEmoteAudio.volume = this.volume;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  private tryPlayMp3(triggerKey: string, isEmote = false, onFallback?: () => void): boolean {
    if (this.muted || this.volume <= 0) return true;
    let file = isEmote
      ? this.config?.emotes?.[triggerKey]?.file
      : this.config?.triggers?.[triggerKey]?.file;
    if (!file && isEmote) {
      const emote = MEME_EMOTES.find((e) => e.id === triggerKey);
      if (emote) file = emote.audioFile.replace(/^\/audio\//, '');
    }
    if (!file) return false;
    if (!this.availableFiles.has(file)) return false;

    try {
      if (isEmote && this.activeEmoteAudio) {
        this.activeEmoteAudio.pause();
        this.activeEmoteAudio.currentTime = 0;
      }
      const audio = new Audio(`/audio/${file}`);
      audio.volume = this.volume;
      if (isEmote) {
        this.activeEmoteAudio = audio;
      }
      audio.play().catch(() => {
        onFallback?.();
      });
      return true;
    } catch {
      return false;
    }
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.25,
    delay = 0,
    endFreq?: number
  ) {
    if (this.muted || this.volume <= 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainPeak * this.volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playMove() {
    if (this.tryPlayMp3('move')) return;
    // Crisp marble/brushed-metal chess tap
    const jitter = 0.94 + Math.random() * 0.12;
    this.playTone(210 * jitter, 0.06, 'triangle', 0.28, 0, 95);
    this.playTone(620 * jitter, 0.03, 'sine', 0.1, 0, 280);
  }

  playCapture() {
    if (this.tryPlayMp3('capture')) return;
    // Heavy studio impact + descending snap
    this.playTone(165, 0.14, 'sawtooth', 0.28, 0, 58);
    this.playTone(440, 0.09, 'square', 0.14, 0.01, 140);
  }

  playCheck() {
    if (this.tryPlayMp3('check')) return;
    this.playTone(587.33, 0.12, 'triangle', 0.24, 0);
    this.playTone(880, 0.22, 'sine', 0.22, 0.09);
  }

  playVictory() {
    if (this.tryPlayMp3('victory')) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, 0.24, 'triangle', 0.24, idx * 0.09);
    });
  }

  playDraw() {
    this.playTone(440, 0.16, 'sine', 0.2, 0);
    this.playTone(392, 0.24, 'sine', 0.18, 0.12);
  }

  playConvocation(specialId: SpecialId) {
    if (this.tryPlayMp3(`convocation_${specialId}`)) return;
    // Energetic signature fanfare
    const meta = SPECIAL_BY_ID[specialId];
    const base = 392 + (meta.name.length % 5) * 35;
    this.playTone(base, 0.14, 'triangle', 0.24, 0);
    this.playTone(base * 1.25, 0.14, 'triangle', 0.24, 0.08);
    this.playTone(base * 1.5, 0.3, 'sine', 0.28, 0.16);
  }

  playEmote(emoteId: string) {
    const playFallback = () => {
      const emote = MEME_EMOTES.find((e) => e.id === emoteId);
      if (!emote) return;
      emote.pitchPattern.forEach((freq, i) => {
        this.playTone(freq, 0.13, 'triangle', 0.22, i * 0.09);
      });
    };
    if (this.tryPlayMp3(emoteId, true, playFallback)) return;
    playFallback();
  }
}

export const soundEngine = new BoldSoundEngine();
