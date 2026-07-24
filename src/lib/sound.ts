// ─────────────────────────────────────────────────────────────────────────
// Minimal SFX, synthesized with the Web Audio API (no asset files — keeps the
// static export lean and fits the terminal aesthetic). Cosmetic only: nothing
// here touches game state or the gameplay RNG (Math.random for noise is fine).
//
// The on/off preference persists in localStorage. Everything is a no-op on the
// server and when muted.
// ─────────────────────────────────────────────────────────────────────────

const SOUND_KEY = "emberofdawn:sound";

// Master gain applied to every cue — bump this to make everything louder/softer.
// A limiter sits after it (see `audio`), so you can push this well past 1
// without hard clipping. ~3–6 is a good range; try higher if you want.
const MASTER_VOLUME = 5;
// Background music rides its own (quieter) bus, straight to the output so a loud
// SFX limiter never ducks it. Keep it well under the SFX level — it's ambient.
const MUSIC_VOLUME = 3;

let enabled = true;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
// music echo nodes, reconfigured per-biome via setMusicEcho()
let musicDelay: DelayNode | null = null;
let musicFeedback: GainNode | null = null;
let musicWet: GainNode | null = null;
let stepFlip = false; // alternates footstep pitch (left/right)

/** Read the saved preference (client-only). Call once on startup. */
export function initSound(): void {
  if (typeof window === "undefined") return;
  try {
    enabled = window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    enabled = true;
  }
}

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      /* ignore quota/private-mode failures */
    }
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (!master) {
    master = ctx.createGain();
    // a limiter after the master keeps loud/layered cues from hard-clipping,
    // so MASTER_VOLUME can be pushed well above 1
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter).connect(ctx.destination);
    // music bus: separate + quieter, not through the SFX limiter. A feedback
    // delay adds a spacious, shimmering echo tail (the "ethereal" glue).
    musicGain = ctx.createGain();
    musicGain.connect(ctx.destination); // dry
    musicDelay = ctx.createDelay(1);
    musicDelay.delayTime.value = 0.3;
    musicFeedback = ctx.createGain();
    musicFeedback.gain.value = 0.34;
    musicWet = ctx.createGain();
    musicWet.gain.value = 0.32;
    musicGain.connect(musicDelay);
    musicDelay.connect(musicFeedback);
    musicFeedback.connect(musicDelay); // echoes decay via the feedback loop
    musicDelay.connect(musicWet);
    musicWet.connect(ctx.destination);
  }
  // re-apply every call so editing the volumes takes effect even if the audio
  // graph survived a hot-reload (module `let`s persisted)
  master.gain.value = MASTER_VOLUME;
  if (musicGain) musicGain.gain.value = MUSIC_VOLUME;
  // browsers start the context suspended until a user gesture; gameplay keys
  // and the toggle click both count, so a resume here lands in time
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Resume the gesture-gated audio context — call from a user-gesture handler
 * (first click/keypress) so title music + SFX can begin. Browsers start the
 * context suspended until then. No-op on the server / without Web Audio. */
export function resumeAudio(): void {
  audio();
}

/** The shared audio context + the (quieter) music bus, for the music engine.
 * Null on the server or if Web Audio is unavailable. */
export function musicOutput(): { ctx: AudioContext; out: GainNode } | null {
  const c = audio();
  if (!c || !musicGain) return null;
  return { ctx: c, out: musicGain };
}

/** Retune the music echo (per-biome reverb character). No-op before audio init. */
export function setMusicEcho(
  time: number,
  feedback: number,
  wet: number,
): void {
  if (!musicDelay || !musicFeedback || !musicWet) return;
  musicDelay.delayTime.value = time;
  musicFeedback.gain.value = feedback;
  musicWet.gain.value = wet;
}

/** A single enveloped oscillator note (optionally gliding in pitch). */
function note(
  c: AudioContext,
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  glideTo?: number,
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(master ?? c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A short filtered noise burst — the "thock" of an impact (lower `lp` = boomier). */
function noise(
  c: AudioContext,
  at: number,
  dur: number,
  peak: number,
  lp = 1400,
): void {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lp;
  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src
    .connect(filter)
    .connect(gain)
    .connect(master ?? c.destination);
  src.start(at);
  src.stop(at + dur);
}

export type Sfx =
  | "hit" // you land a blow
  | "hurt" // you take damage
  | "pickup" // grabbed an item
  | "coin" // grabbed gold
  | "quaff" // drank a potion
  | "blast" // an explosion (firebomb / ruin / volatile burst)
  | "shoot" // loosed an arrow
  | "thud" // an arrow struck stone (miss)
  | "crumble" // a cracked wall broke apart
  | "door" // a door opened / shut
  | "trap" // a spike trap sprang
  | "altar" // accepted a shrine's boon
  | "step" // walked a tile
  | "uiSelect" // menu confirm
  | "uiBack" // menu cancel
  | "boss" // a boss came into view
  | "levelClear" // objective complete
  | "death"; // you fall

export function playSfx(kind: Sfx): void {
  if (!enabled) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  switch (kind) {
    case "hit":
      // you strike: a crisp, high, quick blip + a light thock
      note(c, t, 240, 0.07, "square", 0.06, 120);
      noise(c, t, 0.04, 0.04);
      break;
    case "hurt":
      // you're struck: lower, rougher (sawtooth) + a heavier thud
      note(c, t, 150, 0.15, "sawtooth", 0.09, 68);
      noise(c, t, 0.09, 0.06, 900);
      break;
    case "pickup":
      // a bright two-note rising chirp
      note(c, t, 660, 0.07, "triangle", 0.09);
      note(c, t + 0.06, 990, 0.09, "triangle", 0.09);
      break;
    case "coin":
      // a bright metallic ching (higher + shinier than a pickup)
      note(c, t, 1319, 0.06, "triangle", 0.07);
      note(c, t + 0.05, 1760, 0.11, "triangle", 0.07);
      break;
    case "quaff":
      // a warm rising "glug" — softer and rounder than a pickup
      note(c, t, 320, 0.22, "triangle", 0.08, 560);
      break;
    case "shoot":
      // a taut bow twang: a quick downward pluck
      note(c, t, 700, 0.1, "sawtooth", 0.06, 260);
      break;
    case "thud":
      // an arrow biting stone: a dull low knock
      note(c, t, 150, 0.06, "square", 0.05, 80);
      noise(c, t, 0.05, 0.05, 600);
      break;
    case "crumble":
      // masonry giving way: a gravelly crash + low rubble thumps
      noise(c, t, 0.3, 0.12, 900);
      note(c, t, 92, 0.28, "square", 0.07, 50);
      note(c, t + 0.08, 70, 0.2, "square", 0.05, 42);
      break;
    case "door":
      // a wooden creak + a soft latch knock (opening or shutting)
      note(c, t, 180, 0.16, "sawtooth", 0.05, 320);
      noise(c, t + 0.1, 0.05, 0.04, 1200);
      break;
    case "trap":
      // a sharp metallic snap
      note(c, t, 1400, 0.04, "square", 0.07, 380);
      noise(c, t, 0.03, 0.06, 3200);
      break;
    case "altar":
      // a shimmering ascending chime (G5–D6–G6)
      [784, 1175, 1568].forEach((f, i) =>
        note(c, t + i * 0.09, f, 0.34, "triangle", 0.07),
      );
      break;
    case "step": {
      // a very subtle low tick, alternating pitch like footfalls
      const f = stepFlip ? 92 : 78;
      stepFlip = !stepFlip;
      note(c, t, f, 0.03, "triangle", 0.02);
      break;
    }
    case "uiSelect":
      note(c, t, 620, 0.06, "triangle", 0.05, 720);
      break;
    case "uiBack":
      note(c, t, 360, 0.07, "triangle", 0.05, 280);
      break;
    case "boss":
      // an ominous low swell (detuned sawtooths + a sub)
      note(c, t, 110, 0.6, "sawtooth", 0.09, 100);
      note(c, t + 0.04, 147, 0.55, "sawtooth", 0.05);
      note(c, t, 55, 0.7, "sine", 0.08);
      break;
    case "blast":
      // a low boom: a dropping low-passed noise burst + a sub thump
      noise(c, t, 0.34, 0.15, 480);
      note(c, t, 96, 0.3, "sine", 0.13, 46);
      break;
    case "levelClear":
      // a small ascending fanfare (C–E–G–C)
      [523, 659, 784, 1047].forEach((f, i) =>
        note(c, t + i * 0.1, f, 0.16, "triangle", 0.1),
      );
      break;
    case "death":
      // a somber descending fall
      note(c, t, 300, 0.5, "triangle", 0.1, 90);
      note(c, t + 0.14, 210, 0.55, "sine", 0.08, 60);
      break;
  }
}
