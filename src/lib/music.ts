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

// Per-biome instrument character for melody/motif notes: an envelope shape (a
// quick pluck, a slow bowed swell) plus optional inharmonic partials (a struck
// bell). Absent → the default soft triangle attack/decay.
interface Voice {
  attack?: number; // seconds to peak (small = plucked/struck; large = bowed swell)
  decay?: number; // absolute seconds to near-silence (small = a short pluck/ring)
  partials?: number[]; // extra inharmonic overtone ratios → a metallic bell
}

// A distant, wordless "aah" — a sawtooth sung through vowel formant filters, laid
// under the drone in the haunted castle biomes (Blackhall's massed dead).
interface Choir {
  peak: number;
  formants?: [number, number]; // the two vowel formant freqs (default an "ah")
  octave?: number; // octaves above the chord root to sing (default 2)
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
  motifChance?: number; // 0–1 chance per phrase to voice the Ember leitmotif
  voice?: Voice; // melody instrument character (pluck / bowed / struck bell)
  choir?: Choir; // a distant wordless vocal pad under the drone
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

// The "Ember of Dawn" leitmotif — a short falling phrase written in SCALE
// DEGREES so it transposes into any biome's mode (stays diatonic). Woven sparsely
// into the melody (per-track `motifChance`) as a recurring thread that ties the
// score together, and voiced more often in the throne where it pays off.
const EMBER_MOTIF = [4, 3, 1, 0];

// One mood per biome — scale/tempo + timbre (cutoff), reverb (echo), and an
// ambient texture bed give each its own sense of place.
const LEVEL_MOODS: Record<Biome, Track> = {
  dungeon: {
    root: 110.0,
    scale: MINOR_PENT,
    stepMs: 520,
    density: 0.46,
    wave: "triangle",
    peak: 0.07,
    droneEvery: 8,
    droneWave: "sine",
    sparkle: 0.08,
    cutoff: 1400,
    motifChance: 0.32, // establish the Ember motif early
    echo: { time: 0.3, feedback: 0.34, wet: 0.3 },
    texture: {
      bed: { filter: "lowpass", freq: 220, q: 0.7, peak: 0.04, every: 6 },
      tick: { chance: 0.05, freq: 1500, q: 9, dur: 0.12, peak: 0.035 },
    }, // room tone + drips
  },
  forest: {
    root: 146.83,
    scale: DORIAN,
    stepMs: 480,
    density: 0.46,
    wave: "triangle",
    peak: 0.06,
    droneEvery: 8,
    droneWave: "sine",
    sparkle: 0.1,
    cutoff: 1600,
    echo: { time: 0.2, feedback: 0.22, wet: 0.22 }, // short, dry (open woods)
    voice: { attack: 0.004, decay: 0.5 }, // plucked — a sylvan harp
    texture: {
      bed: { filter: "bandpass", freq: 520, q: 0.8, peak: 0.03, every: 6 },
      tick: { chance: 0.08, freq: 3000, q: 0.7, dur: 0.04, peak: 0.02 },
    }, // breeze + leaf rustle
  },
  marsh: {
    root: 98.0,
    scale: MINOR_PENT,
    stepMs: 600,
    density: 0.38,
    wave: "sine",
    peak: 0.07,
    droneEvery: 6,
    droneWave: "sine",
    sparkle: 0.12,
    cutoff: 1000,
    echo: { time: 0.3, feedback: 0.35, wet: 0.3 },
    voice: { attack: 0.28 }, // slow bowed swell — murky, notes bleed together
    texture: {
      bed: { filter: "lowpass", freq: 190, q: 0.9, peak: 0.05, every: 5 },
      tick: { chance: 0.09, freq: 200, q: 7, dur: 0.16, peak: 0.04 },
    }, // damp air + bubbles
  },
  mountain: {
    root: 164.81,
    scale: NAT_MINOR,
    stepMs: 500,
    density: 0.42,
    wave: "triangle",
    peak: 0.06,
    droneEvery: 8,
    droneWave: "sine",
    sparkle: 0.14,
    echo: { time: 0.36, feedback: 0.32, wet: 0.32 }, // open, airy
    voice: { attack: 0.18 }, // airy bowed — a thin mountain wind-instrument
    texture: {
      bed: { filter: "bandpass", freq: 950, q: 0.9, peak: 0.035, every: 5 },
      tick: { chance: 0.05, freq: 1600, q: 0.6, dur: 0.3, peak: 0.03 },
    }, // thin wind + gusts
  },
  castle: {
    root: 130.81,
    scale: NAT_MINOR,
    stepMs: 500,
    density: 0.46,
    wave: "triangle",
    peak: 0.06,
    droneEvery: 8,
    droneWave: "sine",
    sparkle: 0.07,
    cutoff: 1300,
    echo: { time: 0.34, feedback: 0.4, wet: 0.36 }, // big stone hall
    choir: { peak: 0.02, formants: [650, 1080] }, // the hall's massed dead
    texture: {
      bed: { filter: "lowpass", freq: 260, q: 0.7, peak: 0.035, every: 7 },
      tick: { chance: 0.04, freq: 900, q: 5, dur: 0.18, peak: 0.03 },
    }, // hall air + distant creak
  },
  crypt: {
    root: 110.0,
    scale: MINOR_PENT,
    stepMs: 640,
    density: 0.32,
    wave: "sine",
    peak: 0.06,
    droneEvery: 6,
    droneWave: "sine",
    sparkle: 0.16,
    cutoff: 1100,
    echo: { time: 0.42, feedback: 0.46, wet: 0.4 }, // long, cavernous
    voice: { attack: 0.004, decay: 1.3, partials: [2.4, 3.85] }, // cold struck bell
    choir: { peak: 0.022, formants: [400, 900] }, // interred voices (a dark "oo")
    texture: {
      bed: { filter: "lowpass", freq: 160, q: 0.8, peak: 0.04, every: 7 },
      tick: { chance: 0.1, freq: 1300, q: 10, dur: 0.14, peak: 0.04 },
    }, // cold hollow + echoing drips
  },
  throne: {
    root: 130.81,
    scale: NAT_MINOR,
    stepMs: 440,
    density: 0.52,
    wave: "sawtooth",
    peak: 0.05,
    droneEvery: 8,
    droneWave: "sine",
    sparkle: 0.06,
    cutoff: 900,
    motifChance: 0.55, // the Ember theme blooms as the quest resolves
    echo: { time: 0.26, feedback: 0.32, wet: 0.3 }, // tight, tense (cutoff tames the saw into dread)
    voice: { attack: 0.32 }, // grand bowed strings
    choir: { peak: 0.026, formants: [700, 1150] }, // the throng of the dead (a full "ah")
    texture: {
      bed: { filter: "lowpass", freq: 110, q: 0.9, peak: 0.05, every: 6 },
      tick: { chance: 0.12, freq: 2600, q: 1, dur: 0.03, peak: 0.03 },
    }, // low rumble + ember crackle
  },
  cavern: {
    root: 92.5, // deep and spacious
    scale: MINOR_PENT,
    stepMs: 640, // slow, unhurried — a place to linger
    density: 0.34,
    wave: "sine",
    peak: 0.06,
    droneEvery: 6,
    droneWave: "sine",
    sparkle: 0.2, // frequent high bells — glittering spores
    cutoff: 900, // soft, dark timbre
    echo: { time: 0.42, feedback: 0.44, wet: 0.4 }, // long, wet cave reverb
    voice: { attack: 0.004, decay: 1.0, partials: [2.7, 4.1] }, // glittering bells
    texture: {
      bed: { filter: "lowpass", freq: 160, q: 0.8, peak: 0.05, every: 5 },
      tick: { chance: 0.07, freq: 900, q: 8, dur: 0.18, peak: 0.035 }, // distant drips
    },
  },
};

// A warmer, cozier major theme for the shop — small room, faint hearth.
const SHOP_TRACK: Track = {
  root: 196.0,
  scale: MAJOR_PENT,
  stepMs: 420,
  density: 0.58,
  wave: "triangle",
  peak: 0.06,
  droneEvery: 8,
  droneWave: "sine",
  sparkle: 0.12,
  echo: { time: 0.22, feedback: 0.28, wet: 0.24 },
  texture: {
    bed: { filter: "lowpass", freq: 320, q: 0.6, peak: 0.025, every: 8 },
    tick: { chance: 0.05, freq: 2200, q: 1, dur: 0.03, peak: 0.02 },
  },
};

// The title/menu theme — slow and grand, hopeful-but-shadowed (Dorian), with
// bright sparkle bells that echo the splash's shimmer + drifting embers.
const TITLE_TRACK: Track = {
  root: 130.81,
  scale: DORIAN,
  stepMs: 560,
  density: 0.4,
  wave: "triangle",
  peak: 0.07,
  droneEvery: 6,
  droneWave: "sine",
  sparkle: 0.18,
  cutoff: 1500,
  motifChance: 0.42, // the title states the Ember theme you'll hear all game
  echo: { time: 0.34, feedback: 0.4, wet: 0.36 }, // grand, hall-like
  texture: {
    bed: { filter: "lowpass", freq: 240, q: 0.7, peak: 0.045, every: 6 },
    tick: { chance: 0.06, freq: 2400, q: 1, dur: 0.05, peak: 0.03 },
  }, // warm air + faint ember crackle
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
let exposure = 1; // 1 = out in the open / active → 0 = hidden, held-breath
let targetExposure = 1;
let warmth = 0; // −1 deepening dusk … 0 … +1 breaking dawn (set-piece harmony)
let targetWarmth = 0;
let motifI = -1; // -1 idle; else the current index into EMBER_MOTIF while it plays

/** Feed a danger level (0–1) from the store. The loop glides toward it — as it
 * rises the bed swells (louder + denser), a low heartbeat pulse comes in, the
 * timbre brightens, and the tempo tightens. Calm (0) leaves the bed untouched. */
export function setMusicIntensity(x: number): void {
  targetIntensity = Math.max(0, Math.min(1, x));
}

/** Exposure (0–1): how out-in-the-open the moment is. 1 = normal/active; drops
 * toward 0 when you're creeping UNSEEN past danger, where the melody + sparkle
 * thin away to just the drone and wind — the game's stealth made audible. */
export function setMusicExposure(x: number): void {
  targetExposure = Math.max(0, Math.min(1, x));
}

/** Warmth (−1…+1): a set-piece harmonic tilt driven by the same triggers as the
 * dawn/dusk lighting beats. +1 blooms a bright major chord over the drone, opens
 * the timbre, and adds sparkle (the Throne rekindling as Malachar falls); −1 adds
 * a dissonant shimmer + darkens (the Antechamber's deepening dusk). */
export function setMusicWarmth(x: number): void {
  targetWarmth = Math.max(-1, Math.min(1, x));
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
  cutoff = 0,
  env?: { attack?: number; decay?: number },
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, at);
  if (detune) osc.detune.setValueAtTime(detune, at);
  // envelope: soft by default; a per-voice `attack` (bowed swell) / `decay`
  // (plucked/struck short ring) reshapes it. `decay` is absolute time-to-silence.
  const atk = env?.attack ?? 0.06;
  const rel = Math.max(atk + 0.02, env?.decay ?? dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, at + rel);
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
  osc.stop(at + rel + 0.06);
}

/** Play a melody/motif note in the track's instrument VOICE — the detuned pair
 * plus, for a struck bell, soft inharmonic partials that ring and fade. */
function voiceNote(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  at: number,
  dur: number,
  tr: Track,
  peak: number,
  cut: number,
) {
  const v = tr.voice;
  const env = v && (v.attack != null || v.decay != null) ? v : undefined;
  tone(ctx, out, freq, at, dur, tr.wave, peak, -6, cut, env);
  tone(ctx, out, freq, at, dur, tr.wave, peak, +6, cut, env);
  if (v?.partials) {
    const pd = (v.decay ?? dur) * 0.7;
    for (const r of v.partials)
      tone(ctx, out, freq * r, at, dur, "sine", peak * 0.16, 0, cut, {
        attack: 0.004,
        decay: pd,
      });
  }
}

/** A distant wordless "aah": a sawtooth sung through two parallel vowel-formant
 * bandpasses, with a slow swell and a gentle vibrato — a ghostly choir laid
 * under the drone in the haunted castle biomes. Very quiet; feeds the reverb. */
function choirVoice(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  at: number,
  dur: number,
  peak: number,
  formants: [number, number],
) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, at);
  // a slow vibrato keeps the voice from sounding synthetic/static
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 5;
  lfoG.gain.value = freq * 0.006;
  lfo.connect(lfoG).connect(osc.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.4); // slow swell in
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  for (const ff of formants) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = ff;
    f.Q.value = 7;
    osc.connect(f).connect(g); // parallel formants sum into the same gain
  }
  g.connect(out);
  osc.start(at);
  lfo.start(at);
  osc.stop(at + dur + 0.1);
  lfo.stop(at + dur + 0.1);
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
  q: number,
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
function scheduleTexture(
  ctx: AudioContext,
  out: GainNode,
  tr: Track,
  at: number,
  s: number,
) {
  const tx = tr.texture;
  if (!tx) return;
  if (s % tx.bed.every === 0) {
    const dur = ((tx.bed.every * tr.stepMs) / 1000) * 1.7; // overlap → continuous
    noiseGrain(
      ctx,
      out,
      at,
      dur,
      tx.bed.peak,
      tx.bed.filter,
      tx.bed.freq,
      tx.bed.q,
    );
  }
  if (tx.tick && Math.random() < tx.tick.chance) {
    noiseGrain(
      ctx,
      out,
      at,
      tx.tick.dur,
      tx.tick.peak,
      "bandpass",
      tx.tick.freq,
      tx.tick.q,
    );
  }
}

function scheduleStep(
  ctx: AudioContext,
  out: GainNode,
  tr: Track,
  at: number,
  s: number,
) {
  // danger opens the filter (edgier); dawn opens it further, dusk closes it in
  const cut = tr.cutoff
    ? tr.cutoff *
      (1 +
        intensity * 0.5 +
        Math.max(0, warmth) * 0.7 -
        Math.max(0, -warmth) * 0.4)
    : 0;
  const swell = 1 + intensity * 0.5;
  // a low sustained drone anchors each phrase — two detuned voices beat into a
  // slow breathing shimmer
  if (s % tr.droneEvery === 0) {
    const dur = ((tr.stepMs * tr.droneEvery) / 1000) * 0.95;
    const df = chordRoot(tr, s); // drifts through the progression
    tone(ctx, out, df, at, dur, tr.droneWave, tr.peak * 0.32 * swell, -8, cut);
    tone(ctx, out, df, at, dur, tr.droneWave, tr.peak * 0.32 * swell, +8, cut);
    // set-piece harmony over the drone: dawn blooms a bright major third + fifth;
    // dusk seeps a dissonant minor-second shimmer (unease)
    if (warmth > 0.05) {
      const p = tr.peak * 0.22 * warmth;
      tone(ctx, out, df * Math.pow(2, 4 / 12), at, dur, "sine", p, 0, cut);
      tone(ctx, out, df * Math.pow(2, 7 / 12), at, dur, "sine", p, 0, cut);
    } else if (warmth < -0.05) {
      const p = tr.peak * 0.18 * -warmth;
      tone(ctx, out, df * Math.pow(2, 1 / 12), at, dur, "sine", p, 0, cut);
    }
    // a distant wordless choir under the drone (haunted castle biomes), sung on
    // the chord root, overlapping into a continuous pad; swells a touch in danger
    if (tr.choir) {
      const cdur = ((tr.stepMs * tr.droneEvery) / 1000) * 1.1;
      const oct = tr.choir.octave ?? 2;
      choirVoice(
        ctx,
        out,
        df * Math.pow(2, oct),
        at,
        cdur,
        tr.choir.peak * (0.8 + 0.4 * intensity),
        tr.choir.formants ?? [700, 1100],
      );
    }
  }
  // adaptive danger pulse: a low heartbeat on the beat (follows the chord root)
  if (intensity > 0.12 && s % 4 === 0) {
    tone(
      ctx,
      out,
      chordRoot(tr, s),
      at,
      (tr.stepMs / 1000) * 1.1,
      "sine",
      tr.peak * 0.9 * intensity,
      0,
      cut,
    );
  }
  // arm the Ember leitmotif at a phrase start (sparse; never while hidden)
  if (
    s % tr.droneEvery === 0 &&
    motifI < 0 &&
    exposure > 0.6 &&
    Math.random() < (tr.motifChance ?? 0.26)
  )
    motifI = 0;

  // melody thins away as you go unseen (exposure→0): held breath = drone + wind
  const melodyGate = Math.min(1, tr.density + intensity * 0.2) * exposure;
  if (motifI >= 0) {
    // voice the next motif degree — forced (overrides the walk) so it's heard whole
    const d = EMBER_MOTIF[motifI];
    const semi =
      tr.scale[d % tr.scale.length] + 12 * Math.floor(d / tr.scale.length);
    const freq = tr.root * Math.pow(2, semi / 12);
    const dur = (tr.stepMs / 1000) * 1.7;
    const mp = tr.peak * 0.6 * swell * (0.5 + 0.5 * exposure);
    voiceNote(ctx, out, freq, at, dur, tr, mp, cut);
    if (++motifI >= EMBER_MOTIF.length) motifI = -1;
  } else if (Math.random() < melodyGate) {
    // sparse wandering step within the scale (denser under pressure)
    deg = clampDeg(deg + (Math.floor(Math.random() * 3) - 1), tr.scale.length);
    const semi =
      tr.scale[deg % tr.scale.length] + 12 * Math.floor(deg / tr.scale.length);
    const freq = tr.root * Math.pow(2, semi / 12);
    const dur = (tr.stepMs / 1000) * 1.6;
    voiceNote(ctx, out, freq, at, dur, tr, tr.peak * 0.55 * swell, cut);
  }
  // a rare high bell twinkle (2 octaves up) — magic shimmer, long echoing tail
  // (left unfiltered so it stays crisp). Thins when hidden; dawn adds light,
  // dusk snuffs it.
  const sparkleChance =
    tr.sparkle *
    exposure *
    (1 + Math.max(0, warmth) * 1.2) *
    (1 - Math.max(0, -warmth) * 0.7);
  if (Math.random() < sparkleChance) {
    const semi = tr.scale[Math.floor(Math.random() * tr.scale.length)] + 24;
    tone(
      ctx,
      out,
      tr.root * Math.pow(2, semi / 12),
      at,
      1.4,
      "sine",
      tr.peak * 0.5,
    );
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
  exposure += (targetExposure - exposure) * 0.05; // ease in/out of the held breath
  warmth += (targetWarmth - warmth) * 0.04; // slow harmonic sunrise/dusk
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
  (
    [
      [2.5, 1319],
      [3.1, 1568],
      [3.7, 2093],
    ] as const
  ).forEach(([o, f]) => tone(ctx, out, f, t + o, 1.5, "sine", 0.05));
  // the Ember leitmotif, resolved into MAJOR — the falling theme made whole
  // (G–F–D–C, the same descending shape heard all game, now hopeful)
  (
    [
      [4.4, 784],
      [4.9, 698],
      [5.4, 587],
      [5.9, 523],
    ] as const
  ).forEach(([o, f]) => {
    tone(ctx, out, f, t + o, 1.2, "triangle", 0.05, -5);
    tone(ctx, out, f, t + o, 1.2, "triangle", 0.05, +5);
  });
}

/** A short musical STING layered OVER the running track (not a track switch) — an
 * in-key accent on a story/exploration beat. Reads the current track's root/scale
 * so it stays diatonic to the biome; a harmless no-op if nothing is playing. */
export function playSting(kind: "lore" | "altar" | "clear"): void {
  if (!isSoundOn()) return;
  const bus = musicOutput();
  if (!bus) return;
  const { ctx, out } = bus;
  const root = track?.root ?? 130.81;
  const scale = track?.scale ?? NAT_MINOR;
  const cut = track?.cutoff ?? 0;
  const t = ctx.currentTime + 0.03;
  const f = (d: number) => {
    const i = ((d % scale.length) + scale.length) % scale.length;
    return (
      root * Math.pow(2, (scale[i] + 12 * Math.floor(d / scale.length)) / 12)
    );
  };

  if (kind === "lore") {
    // a soft, slow fragment of the Ember motif — wistful, tying the story to the theme
    EMBER_MOTIF.slice(0, 3).forEach((d, i) => {
      const freq = f(d);
      tone(ctx, out, freq, t + i * 0.5, 1.4, "triangle", 0.045, -5, cut, {
        attack: 0.09,
      });
      tone(ctx, out, freq, t + i * 0.5, 1.4, "triangle", 0.045, +5, cut, {
        attack: 0.09,
      });
    });
  } else if (kind === "altar") {
    // a cold, unresolved shimmer — a high bell + its tritone, a fifth glint after
    const hi = f(0) * 4; // tonic, two octaves up
    tone(ctx, out, hi, t, 1.9, "sine", 0.05);
    tone(ctx, out, hi * Math.pow(2, 6 / 12), t + 0.11, 1.9, "sine", 0.038); // tritone (unease)
    tone(ctx, out, hi * Math.pow(2, 7 / 12), t + 0.3, 1.6, "sine", 0.03); // a fifth glint
  } else {
    // level-clear: a brief upward cadence resolving onto the tonic (an octave up)
    [f(1), f(2), f(0) * 2].forEach((freq, i) => {
      tone(ctx, out, freq, t + i * 0.17, 1.0, "triangle", 0.05, -4, cut);
      tone(ctx, out, freq, t + i * 0.17, 1.0, "triangle", 0.05, +4, cut);
    });
  }
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
  motifI = -1;
  exposure = targetExposure = 1; // start open; the store feeds real values next tick
  warmth = targetWarmth = 0;
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
