/**
 * Sound: all effects are synthesised from WebAudio oscillators and a short
 * noise buffer — no audio files ship with the game, per the issue brief.
 *
 * The four-note descending march is the heartbeat. Each call to `marchStep()`
 * plays the next note in the cycle; the cycle is advanced by the world's march
 * step, whose tempo already rises as the wave thins, so the soundtrack
 * quickens with the formation without a separate timer. Firing, alien and
 * cannon explosions, and the mystery-ship hit each have their own short
 * envelope. One mute control silences everything, and the choice is persisted
 * to `localStorage` so it survives a reload.
 *
 * Browsers refuse to start audio until a user gesture, so the AudioContext is
 * created suspended and resumed on the first input via `unlock()`. Until then
 * every call is a safe no-op.
 */

const MUTE_KEY = "space-invaders:muted";

/**
 * The march's four descending notes, in Hz. The arcade's loop fell a roughly
 * equal step each beat; these pitches hit that "dum — dum — dum — dum" shape
 * on a buzzy square wave. The cycle wraps, so a long wave plays it many times.
 */
const MARCH_NOTES = [110, 98, 87, 82];

/** A single short oscillator blip with an exponential decay envelope. */
function blip(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  duration: number,
  gain: number,
): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export interface Sound {
  /** Resume the AudioContext on a user gesture. Safe to call many times. */
  unlock(): void;
  /** Advance the march by one step (plays one of the four descending notes). */
  marchStep(): void;
  /** Player fired a shot. */
  fire(): void;
  /** An alien (or the cannon, or the mystery ship) was destroyed. */
  explosion(): void;
  /** The mystery ship appeared — a warbly tone while it crosses the top. */
  ufoLoopStart(): void;
  /** Stop the mystery-ship loop (it left, or was hit). */
  ufoLoopStop(): void;
  /** Mute/unmute everything. Persists to localStorage. */
  setMuted(muted: boolean): void;
  /** Current mute state. */
  isMuted(): boolean;
}

/**
 * Build the sound controller. If WebAudio is unavailable (very old browser,
 * or a non-DOM harness) every method becomes a no-op, so the game still runs.
 */
export function createSound(): Sound {
  // Read the persisted mute choice once. Guarded: `localStorage` can be
  // absent (private mode, or a headless harness without a DOM).
  let muted = loadMuted();

  // Lazily-created on first `unlock()` so nothing touches WebAudio before a
  // user gesture — and so a harness without WebAudio never constructs one.
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  // A running oscillator/gain pair for the UFO's warble, so it can be stopped.
  let ufoOsc: OscillatorNode | null = null;
  let ufoGain: GainNode | null = null;
  let marchIndex = 0;

  const ensure = (): boolean => {
    if (ctx) return true;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    // One second of white noise reused by every explosion — cheap to build
    // once and slice with an envelope each time.
    const len = Math.floor(ctx.sampleRate * 1.0);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  };

  return {
    unlock(): void {
      if (!ensure()) return;
      if (ctx!.state === "suspended") void ctx!.resume();
    },

    marchStep(): void {
      if (!ensure() || muted) return;
      const f = MARCH_NOTES[marchIndex % MARCH_NOTES.length];
      marchIndex = (marchIndex + 1) % MARCH_NOTES.length;
      blip(ctx!, master!, "square", f, 0.12, 0.25);
    },

    fire(): void {
      if (!ensure() || muted) return;
      // A quick high blip with a slight downward sweep — the arcade's "pew".
      const t0 = ctx!.currentTime;
      const osc = ctx!.createOscillator();
      const g = ctx!.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.08);
      g.gain.setValueAtTime(0.3, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(g).connect(master!);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    },

    explosion(): void {
      if (!ensure() || muted || !noise) return;
      // A slice of the noise buffer through a fast-decaying envelope — the
      // crunchy "crump" of an invader or the cannon blowing up.
      const t0 = ctx!.currentTime;
      const src = ctx!.createBufferSource();
      src.buffer = noise;
      const g = ctx!.createGain();
      g.gain.setValueAtTime(0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      // Low-pass the noise so it reads as a thud, not hiss.
      const lp = ctx!.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1200, t0);
      src.connect(lp).connect(g).connect(master!);
      src.start(t0);
      src.stop(t0 + 0.28);
    },

    ufoLoopStart(): void {
      if (!ensure() || muted) return;
      if (ufoOsc) return; // already playing
      const t0 = ctx!.currentTime;
      ufoOsc = ctx!.createOscillator();
      ufoGain = ctx!.createGain();
      ufoOsc.type = "sawtooth";
      ufoOsc.frequency.setValueAtTime(440, t0);
      // A slow wobble between two pitches for the "warble" while it flies.
      ufoOsc.frequency.setValueAtTime(440, t0);
      const lfo = ctx!.createOscillator();
      const lfoGain = ctx!.createGain();
      lfo.frequency.setValueAtTime(8, t0);
      lfoGain.gain.setValueAtTime(40, t0);
      lfo.connect(lfoGain).connect(ufoOsc.frequency);
      lfo.start(t0);
      ufoGain.gain.setValueAtTime(0.12, t0);
      ufoOsc.connect(ufoGain).connect(master!);
      ufoOsc.start(t0);
      // Tag the LFO on the oscillator so it stops together — store via the
      // oscillator's onended to stop the LFO.
      ufoOsc.onended = () => {
        try {
          lfo.stop();
        } catch {
          /* already stopped */
        }
      };
    },

    ufoLoopStop(): void {
      if (!ufoOsc) return;
      try {
        ufoOsc.stop();
      } catch {
        /* already stopped */
      }
      ufoOsc.disconnect();
      ufoGain?.disconnect();
      ufoOsc = null;
      ufoGain = null;
    },

    setMuted(m: boolean): void {
      muted = m;
      saveMuted(m);
      if (master && ctx) {
        master.gain.setValueAtTime(m ? 0 : 0.6, ctx.currentTime);
      }
      if (m) this.ufoLoopStop();
    },

    isMuted(): boolean {
      return muted;
    },
  };
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* storage unavailable — mute just doesn't persist */
  }
}
