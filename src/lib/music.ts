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
import { isSoundOn, musicOutput } from "./sound";

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
}

const MINOR_PENT = [0, 3, 5, 7, 10];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR_PENT = [0, 2, 4, 7, 9];

// One mood per biome — mostly the same shape, retuned for feel.
const LEVEL_MOODS: Record<Biome, Track> = {
  dungeon: { root: 110.0, scale: MINOR_PENT, stepMs: 520, density: 0.46, wave: "triangle", peak: 0.07, droneEvery: 8, droneWave: "sine", sparkle: 0.08 },
  forest: { root: 146.83, scale: DORIAN, stepMs: 480, density: 0.46, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.1 },
  marsh: { root: 98.0, scale: MINOR_PENT, stepMs: 600, density: 0.38, wave: "sine", peak: 0.07, droneEvery: 6, droneWave: "sine", sparkle: 0.12 },
  mountain: { root: 164.81, scale: NAT_MINOR, stepMs: 500, density: 0.42, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.14 },
  castle: { root: 130.81, scale: NAT_MINOR, stepMs: 500, density: 0.46, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.07 },
  crypt: { root: 110.0, scale: MINOR_PENT, stepMs: 640, density: 0.32, wave: "sine", peak: 0.06, droneEvery: 6, droneWave: "sine", sparkle: 0.16 },
  throne: { root: 130.81, scale: NAT_MINOR, stepMs: 440, density: 0.52, wave: "sawtooth", peak: 0.05, droneEvery: 8, droneWave: "sine", sparkle: 0.06 },
};

// A warmer, cozier major theme for the shop.
const SHOP_TRACK: Track = { root: 196.0, scale: MAJOR_PENT, stepMs: 420, density: 0.58, wave: "triangle", peak: 0.06, droneEvery: 8, droneWave: "sine", sparkle: 0.12 };

const LOOKAHEAD_S = 0.3; // schedule this far ahead of the clock
const TICK_MS = 100; // how often the scheduler runs

let timer: ReturnType<typeof setInterval> | null = null;
let current: string | null = null; // id of the playing track (keeps continuity)
let track: Track | null = null;
let step = 0;
let nextTime = 0;
let deg = 2; // current scale degree, for a gentle melodic random walk

function clampDeg(d: number, len: number): number {
  return Math.max(0, Math.min(len * 2 - 1, d)); // roam ~2 octaves
}

function tone(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  at: number,
  dur: number,
  wave: OscillatorType,
  peak: number,
  detune = 0
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
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.06);
}

function scheduleStep(ctx: AudioContext, out: GainNode, tr: Track, at: number, s: number) {
  // a low sustained drone anchors each phrase — two detuned voices beat into a
  // slow breathing shimmer
  if (s % tr.droneEvery === 0) {
    const dur = ((tr.stepMs * tr.droneEvery) / 1000) * 0.95;
    tone(ctx, out, tr.root / 2, at, dur, tr.droneWave, tr.peak * 0.32, -8);
    tone(ctx, out, tr.root / 2, at, dur, tr.droneWave, tr.peak * 0.32, +8);
  }
  // sparse melody: a wandering step within the scale (with rests), chorused
  if (Math.random() < tr.density) {
    deg = clampDeg(deg + (Math.floor(Math.random() * 3) - 1), tr.scale.length);
    const semi = tr.scale[deg % tr.scale.length] + 12 * Math.floor(deg / tr.scale.length);
    const freq = tr.root * Math.pow(2, semi / 12);
    const dur = (tr.stepMs / 1000) * 1.6;
    tone(ctx, out, freq, at, dur, tr.wave, tr.peak * 0.55, -6);
    tone(ctx, out, freq, at, dur, tr.wave, tr.peak * 0.55, +6);
  }
  // a rare high bell twinkle (2 octaves up) — magic shimmer, long echoing tail
  if (Math.random() < tr.sparkle) {
    const semi = tr.scale[Math.floor(Math.random() * tr.scale.length)] + 24;
    tone(ctx, out, tr.root * Math.pow(2, semi / 12), at, 1.4, "sine", tr.peak * 0.5);
  }
}

function scheduler() {
  const bus = musicOutput();
  if (!bus || !isSoundOn() || !track) {
    stopMusic();
    return;
  }
  const { ctx, out } = bus;
  while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
    scheduleStep(ctx, out, track, nextTime, step);
    nextTime += track.stepMs / 1000;
    step++;
  }
}

/** Start (or keep) a track. `id` keeps continuity — calling with the id that's
 * already playing is a no-op, so music flows unbroken across mode changes
 * (intro → gameplay, pause, inventory, …). */
export function playMusic(id: string, biome?: Biome): void {
  if (!isSoundOn()) return;
  if (id === current) return;
  const bus = musicOutput();
  if (!bus) return;
  current = id;
  track = id === "shop" ? SHOP_TRACK : LEVEL_MOODS[biome ?? "dungeon"];
  step = 0;
  deg = 2;
  nextTime = bus.ctx.currentTime + 0.1;
  if (timer == null) timer = setInterval(scheduler, TICK_MS);
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
