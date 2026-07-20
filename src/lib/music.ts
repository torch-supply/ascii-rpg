// ─────────────────────────────────────────────────────────────────────────
// Procedural background music — a slow drone + sparse melody on a per-biome
// scale, synthesized with the Web Audio API (no asset files). Deliberately
// simple and non-obtrusive: quiet, gentle waveforms, lots of space.
//
// A lookahead scheduler queues notes just ahead of the audio clock (the
// standard Web Audio pattern, drift-free). Cosmetic only — Math.random for the
// melody walk is fine; it never touches gameplay state or the seeded RNG.
// ─────────────────────────────────────────────────────────────────────────
import type { Biome } from "@/game/core/types";
import { isSoundOn, musicOutput, setMusicEcho } from "./sound";

// Per-biome reverb character (feeds the shared music echo).
interface Echo {
  time: number; // delay time (s) — bigger = more cavernous
  feedback: number; // 0–1 tail length
  wet: number; // 0–1 echo mix
}

// An ambient environmental bed: a continuous filtered-noise "wind/rumble" laid
// down as overlapping swells, plus optional sparse punctuation (drips, crackle).
interface Texture {
  bed: {
    filter: BiquadFilterType;
    freq: number;
    q: number;
    peak: number;
    every: number; // schedule an overlapping swell every N steps
  };
  tick?: { chance: number; freq: number; q: number; dur: number; peak: number };
}

interface Track {
  root: number; // base frequency (Hz)
  scale: number[]; // semitone offsets within an octave
  stepMs: number; // time per sequencer step
  density: number; // 0–1 chance a step plays a melody note
  wave: OscillatorType;
  peak: number; // melody note gain (before the music bus volume)
  droneEvery: number; // steps between low sustained drone notes
  droneWave: OscillatorType;
  sparkle: number; // 0–1 chance of a high bell twinkle per step
  cutoff?: number; // per-note low-pass (softens/darkens the timbre)
  echo?: Echo; // reverb character (defaults to DEFAULT_ECHO)
  texture?: Texture; // ambient environmental bed
  progression?: number[]; // scale-degree roots for the drifting drone chord loop
}

const DEFAULT_ECHO: Echo = { time: 0.3, feedback: 0.34, wet: 0.32 };

const MINOR_PENT = [0, 3, 5, 7, 10];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR_PENT = [0, 2, 4, 7, 9];

// Evolving harmony: the drone drifts through these scale-degree roots (one per
// drone phrase) instead of holding the tonic. Indices into the track's own
// scale, so it stays diatonic in any biome's mode. Tracks may override.
const DEFAULT_PROGRESSION = [0, 2, 4, 1]; // i → III → v → ii (a gentle wander)

// One mood per biome — scale/tempo + timbre (cutoff), reverb (echo), and an
// ambient texture bed give each its own sense of place.
const LEVEL_MOODS: Record<Biome, Track> = {
  dungeon: {
    root: 110.0, scale: MINOR_PENT, stepMs: 520, density: 0.46, wave: "triangle", peak: 0.07, droneEvery: 8, droneWave: "sine", sparkle: 0.08,
    cutoff: 1400, echo: { time: 0.3, feedback: 0.34, wet: 0.3 },
    texture: { bed: { filter: "lowpass", freq: 220, q: 0.7, peak: 0.04, every: 6 }, tick: { chance: 0.05, freq: 1500, q: 9, dur: 0.12, peak: 0.035 } }, // room tone + drips
  },
  forest: {
    root: 146.83, scale: DORIAN, stepMs: 480, density: 0.46, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.1,
    cutoff: 1600, echo: { time: 0.2, feedback: 0.22, wet: 0.22 }, // short, dry (open woods)
    texture: { bed: { filter: "bandpass", freq: 520, q: 0.8, peak: 0.03, every: 6 }, tick: { chance: 0.08, freq: 3000, q: 0.7, dur: 0.04, peak: 0.02 } }, // breeze + leaf rustle
  },
  marsh: {
    root: 98.0, scale: MINOR_PENT, stepMs: 600, density: 0.38, wave: "sine", peak: 0.07, droneEvery: 6, droneWave: "sine", sparkle: 0.12,
    cutoff: 1000, echo: { time: 0.3, feedback: 0.35, wet: 0.3 },
    texture: { bed: { filter: "lowpass", freq: 190, q: 0.9, peak: 0.05, every: 5 }, tick: { chance: 0.09, freq: 200, q: 7, dur: 0.16, peak: 0.04 } }, // damp air + bubbles
  },
  mountain: {
    root: 164.81, scale: NAT_MINOR, stepMs: 500, density: 0.42, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.14,
    echo: { time: 0.36, feedback: 0.32, wet: 0.32 }, // open, airy
    texture: { bed: { filter: "bandpass", freq: 950, q: 0.9, peak: 0.035, every: 5 }, tick: { chance: 0.05, freq: 1600, q: 0.6, dur: 0.3, peak: 0.03 } }, // thin wind + gusts
  },
  castle: {
    root: 130.81, scale: NAT_MINOR, stepMs: 500, density: 0.46, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.07,
    cutoff: 1300, echo: { time: 0.34, feedback: 0.4, wet: 0.36 }, // big stone hall
    texture: { bed: { filter: "lowpass", freq: 260, q: 0.7, peak: 0.035, every: 7 }, tick: { chance: 0.04, freq: 900, q: 5, dur: 0.18, peak: 0.03 } }, // hall air + distant creak
  },
  crypt: {
    root: 110.0, scale: MINOR_PENT, stepMs: 640, density: 0.32, wave: "sine", peak: 0.06, droneEvery: 6, droneWave: "sine", sparkle: 0.16,
    cutoff: 1100, echo: { time: 0.42, feedback: 0.46, wet: 0.4 }, // long, cavernous
    texture: { bed: { filter: "lowpass", freq: 160, q: 0.8, peak: 0.04, every: 7 }, tick: { chance: 0.1, freq: 1300, q: 10, dur: 0.14, peak: 0.04 } }, // cold hollow + echoing drips
  },
  throne: {
    root: 130.81, scale: NAT_MINOR, stepMs: 440, density: 0.52, wave: "sawtooth", peak: 0.05, droneEvery: 8, droneWave: "sine", sparkle: 0.06,
    cutoff: 900, echo: { time: 0.26, feedback: 0.32, wet: 0.3 }, // tight, tense (cutoff tames the saw into dread)
    texture: { bed: { filter: "lowpass", freq: 110, q: 0.9, peak: 0.05, every: 6 }, tick: { chance: 0.12, freq: 2600, q: 1, dur: 0.03, peak: 0.03 } }, // low rumble + ember crackle
  },
};

// A warmer, cozier major theme for the shop — small room, faint hearth.
const SHOP_TRACK: Track = {
  root: 196.0, scale: MAJOR_PENT, stepMs: 420, density: 0.58, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.12,
  echo: { time: 0.22, feedback: 0.28, wet: 0.24 },
  texture: { bed: { filter: "lowpass", freq: 320, q: 0.6, peak: 0.025, every: 8 }, tick: { chance: 0.05, freq: 2200, q: 1, dur: 0.03, peak: 0.02 } },
};

// The title/menu theme — slow and grand, hopeful-but-shadowed (Dorian), with
// bright sparkle bells that echo the splash's shimmer + drifting embers.
const TITLE_TRACK: Track = {
  root: 130.81, scale: DORIAN, stepMs: 560, density: 0.4, wave: "triangle", peak: 0.07, droneEvery: 6, droneWave: "sine", sparkle: 0.18,
  cutoff: 1500, echo: { time: 0.34, feedback: 0.4, wet: 0.36 }, // grand, hall-like
  texture: { bed: { filter: "lowpass", freq: 240, q: 0.7, peak: 0.045, every: 6 }, tick: { chance: 0.06, freq: 2400, q: 1, dur: 0.05, peak: 0.03 } }, // warm air + faint ember crackle
};

const LOOKAHEAD_S = 0.3; // schedule this far ahead of the clock
const TICK_MS = 100; // how often the scheduler runs

let timer: ReturnType<typeof setInterval> | null = null;
let current: string | null = null; // id of the playing track (keeps continuity)
let track: Track | null = null;
let step = 0;
let nextTime = 0;
let deg = 2; // current scale degree, for a gentle melodic random walk
let intensity = 0; // 0 calm → 1 peak danger (eased toward the target each tick)
let targetIntensity = 0;

/** Feed a danger level (0–1) from the store. The loop glides toward it — as it
 * rises the bed swells (louder + denser), a low heartbeat pulse comes in, the
 * timbre brightens, and the tempo tightens. Calm (0) leaves the bed untouched. */
export function setMusicIntensity(x: number): void {
  targetIntensity = Math.max(0, Math.min(1, x));
}

function clampDeg(d: number, len: number): number {
  return Math.max(0, Math.min(len * 2 - 1, d)); // roam ~2 octaves
}

/** The low drone/pulse root for step `s` — walks the track's chord progression,
 * advancing one chord per drone phrase, kept diatonic via the track's scale. */
function chordRoot(tr: Track, s: number): number {
  const prog = tr.progression ?? DEFAULT_PROGRESSION;
  const deg = prog[Math.floor(s / tr.droneEvery) % prog.length];
  const semi = tr.scale[deg % tr.scale.length];
  return (tr.root / 2) * Math.pow(2, semi / 12);
}

function tone(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  at: number,
  dur: number,
  wave: OscillatorType,
  peak: number,
  detune = 0,
  cutoff = 0
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  if (detune) osc.detune.setValueAtTime(detune, at);
  // soft attack/release so notes never click
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g);
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    g.connect(f).connect(out); // soften/darken the timbre
  } else {
    g.connect(out);
  }
  osc.start(at);
  osc.stop(at + dur + 0.06);
}

/** A filtered-noise grain — the building block of the ambient texture bed
 * (continuous swells) and its punctuation (drips / crackle / bubbles). */
function noiseGrain(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  dur: number,
  peak: number,
  filter: BiquadFilterType,
  freq: number,
  q: number
) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = filter;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.4); // slow swell in
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur); // fade out
  src.connect(filt).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** Lay down the biome's ambient bed: overlapping filtered-noise swells for a
 * continuous wind/rumble, plus sparse punctuation (drips, crackle). */
function scheduleTexture(ctx: AudioContext, out: GainNode, tr: Track, at: number, s: number) {
  const tx = tr.texture;
  if (!tx) return;
  if (s % tx.bed.every === 0) {
    const dur = ((tx.bed.every * tr.stepMs) / 1000) * 1.7; // overlap → continuous
    noiseGrain(ctx, out, at, dur, tx.bed.peak, tx.bed.filter, tx.bed.freq, tx.bed.q);
  }
  if (tx.tick && Math.random() < tx.tick.chance) {
    noiseGrain(ctx, out, at, tx.tick.dur, tx.tick.peak, "bandpass", tx.tick.freq, tx.tick.q);
  }
}

function scheduleStep(ctx: AudioContext, out: GainNode, tr: Track, at: number, s: number) {
  // danger opens the filter (edgier) and swells note gains
  const cut = tr.cutoff ? tr.cutoff * (1 + intensity * 0.5) : 0;
  const swell = 1 + intensity * 0.5;
  // a low sustained drone anchors each phrase — two detuned voices beat into a
  // slow breathing shimmer
  if (s % tr.droneEvery === 0) {
    const dur = ((tr.stepMs * tr.droneEvery) / 1000) * 0.95;
    const df = chordRoot(tr, s); // drifts through the progression
    tone(ctx, out, df, at, dur, tr.droneWave, tr.peak * 0.32 * swell, -8, cut);
    tone(ctx, out, df, at, dur, tr.droneWave, tr.peak * 0.32 * swell, +8, cut);
  }
  // adaptive danger pulse: a low heartbeat on the beat (follows the chord root)
  if (intensity > 0.12 && s % 4 === 0) {
    tone(ctx, out, chordRoot(tr, s), at, (tr.stepMs / 1000) * 1.1, "sine", tr.peak * 0.9 * intensity, 0, cut);
  }
  // sparse melody: a wandering step within the scale (denser under pressure)
  if (Math.random() < Math.min(1, tr.density + intensity * 0.2)) {
    deg = clampDeg(deg + (Math.floor(Math.random() * 3) - 1), tr.scale.length);
    const semi = tr.scale[deg % tr.scale.length] + 12 * Math.floor(deg / tr.scale.length);
    const freq = tr.root * Math.pow(2, semi / 12);
    const dur = (tr.stepMs / 1000) * 1.6;
    tone(ctx, out, freq, at, dur, tr.wave, tr.peak * 0.55 * swell, -6, cut);
    tone(ctx, out, freq, at, dur, tr.wave, tr.peak * 0.55 * swell, +6, cut);
  }
  // a rare high bell twinkle (2 octaves up) — magic shimmer, long echoing tail
  // (left unfiltered so it stays crisp)
  if (Math.random() < tr.sparkle) {
    const semi = tr.scale[Math.floor(Math.random() * tr.scale.length)] + 24;
    tone(ctx, out, tr.root * Math.pow(2, semi / 12), at, 1.4, "sine", tr.peak * 0.5);
  }
  // the ambient environmental bed (wind/rumble + drips/crackle)
  scheduleTexture(ctx, out, tr, at, s);
}

function scheduler() {
  const bus = musicOutput();
  if (!bus || !isSoundOn() || !track) {
    stopMusic();
    return;
  }
  const { ctx, out } = bus;
  intensity += (targetIntensity - intensity) * 0.06; // glide — no jarring jumps
  while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
    scheduleStep(ctx, out, track, nextTime, step);
    nextTime += (track.stepMs * (1 - intensity * 0.12)) / 1000; // subtle urgency
    step++;
  }
}

/** A slow, mournful dirge — played once on the game-over screen (not looped). */
function playDeath(ctx: AudioContext, out: GainNode): void {
  const t = ctx.currentTime + 0.05;
  const drone = (f: number) => {
    tone(ctx, out, f, t, 6, "sine", 0.05, -7);
    tone(ctx, out, f, t, 6, "sine", 0.05, +7);
  };
  const dyad = (o: number, f: number, d: number, p = 0.06) => {
    tone(ctx, out, f, t + o, d, "triangle", p, -5);
    tone(ctx, out, f, t + o, d, "triangle", p, +5);
  };
  drone(110); // low A2 pall
  // a slow descending phrase that sinks and settles
  dyad(0.4, 659, 1.3);
  dyad(1.2, 523, 1.3);
  dyad(2.0, 440, 1.5);
  dyad(3.2, 349, 1.4);
  dyad(4.3, 330, 2.4);
  // final low A-minor chord, fading into the echo
  for (const f of [220, 262, 330]) dyad(5.0, f, 3, 0.045);
}

/** A triumphant, resolving fanfare with sparkle — once on the victory screen. */
function playVictory(ctx: AudioContext, out: GainNode): void {
  const t = ctx.currentTime + 0.05;
  const dyad = (o: number, f: number, d: number, p = 0.07) => {
    tone(ctx, out, f, t + o, d, "triangle", p, -5);
    tone(ctx, out, f, t + o, d, "triangle", p, +5);
  };
  // C-major foundation
  tone(ctx, out, 130.81, t, 6, "sine", 0.05, -6);
  tone(ctx, out, 130.81, t, 6, "sine", 0.05, +6);
  // rising fanfare C–E–G–C
  dyad(0.0, 523, 0.7);
  dyad(0.4, 659, 0.7);
  dyad(0.8, 784, 0.7);
  dyad(1.2, 1047, 0.9);
  // held major chord, glowing
  for (const f of [523, 659, 784, 1047]) dyad(1.9, f, 3.4, 0.04);
  // sparkle bells drifting over the resolve
  ([[2.5, 1319], [3.1, 1568], [3.7, 2093]] as const).forEach(([o, f]) =>
    tone(ctx, out, f, t + o, 1.5, "sine", 0.05)
  );
}

/** Start (or keep) a track. `id` keeps continuity — calling with the id that's
 * already playing is a no-op, so music flows unbroken across mode changes
 * (intro → gameplay, pause, inventory, …). "death"/"victory" are one-shots. */
export function playMusic(id: string, biome?: Biome): void {
  if (!isSoundOn()) return;
  if (id === current) return;
  const bus = musicOutput();
  if (!bus) return;
  // stop any looping track before switching
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  current = id;
  track = null;

  if (id === "death") {
    setMusicEcho(0.4, 0.42, 0.36); // deep, cavernous
    return playDeath(bus.ctx, bus.out);
  }
  if (id === "victory") {
    setMusicEcho(0.28, 0.3, 0.3); // bright, resolved
    return playVictory(bus.ctx, bus.out);
  }

  // looping ambient bed (title / level / shop)
  track =
    id === "title"
      ? TITLE_TRACK
      : id === "shop"
        ? SHOP_TRACK
        : LEVEL_MOODS[biome ?? "dungeon"];
  const echo = track.echo ?? DEFAULT_ECHO;
  setMusicEcho(echo.time, echo.feedback, echo.wet);
  step = 0;
  deg = 2;
  nextTime = bus.ctx.currentTime + 0.1;
  timer = setInterval(scheduler, TICK_MS);
  scheduler();
}

/** Stop scheduling. Already-queued notes (≤ lookahead) ring out and fade. */
export function stopMusic(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  current = null;
  track = null;
}
