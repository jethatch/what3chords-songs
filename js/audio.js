// Playback: a scheduler that drives a Band bar by bar, plus two ways to get
// a song out as a file (render it offline, or record it as it plays).
//
// Everything runs off one repeating sixteenth-note tick on a Tone.js
// transport. At the top of each bar the player latches the current time
// signature, strum pattern and band line-up, so changing any of them
// mid-song takes effect on the next bar line; tempo changes apply at once.

import { Band, findGuitar, loadSamples } from "./band.js";
import {
  PATTERNS, slotsPerBar, drumGroove, guitarSlots, drumSlots, bassSlots,
} from "./patterns.js";

const ENDING_SECONDS = 2.6;
const LOWEST_BASS_NOTE = 28; // E1, the open low string of a bass
const DRUM_LEVELS = { X: 1, x: 0.75, ".": 0.3 };
export const MAX_RENDER_SECONDS = 600;
const RENDER_RATE = 44100;
const CHUNK_SECONDS = 16;
const CHUNK_TAIL_SECONDS = 3;

export function songSeconds(bars, signature, bpm) {
  return (bars * slotsPerBar(signature) * 15) / bpm + ENDING_SECONDS;
}

// The bass plays the chord's bass note in its lowest octave; "5" is the
// chord's fifth above that (or its root, for a chord already standing on
// its fifth).
function bassPitch(chord, token) {
  const low = LOWEST_BASS_NOTE + ((chord.bass - LOWEST_BASS_NOTE) % 12 + 12) % 12;
  if (token === "8") return low + 12;
  if (token !== "5") return low;
  const fifth = (chord.root + chord.fifth) % 12;
  const other = fifth === chord.bass ? chord.root : fifth;
  return low + (((other - chord.bass) % 12 + 12) % 12 || 12);
}

export class Player {
  // `transport` defaults to the live one; an offline render passes its own.
  constructor(band, transport = Tone.getTransport(), offline = false) {
    this.band = band;
    this.transport = transport;
    this.offline = offline;
    this.state = "stopped"; // "stopped" | "playing" | "paused"
    this.signature = "4/4";
    this.pattern = PATTERNS["4/4"][0];
    this.bpm = 120;
    this.drums = false;
    this.drumStyle = "match";
    this.bass = false;
    this.song = null;
    this.untilBar = Infinity;
    this.marks = [];
    this.onEnd = () => {};
  }

  setTempo(bpm) {
    this.bpm = bpm;
    this.transport.bpm.value = bpm;
  }

  // song: { bars, barAt(i) -> { chord, ...anything the caller wants back from
  // position() }, ending: chord|null }. `bars` may be Infinity.
  async play(song, fromBar = 0) {
    // Ask for the audio context first, while the click that got us here
    // still counts as a user gesture, then wait for the samples.
    const unlocked = Tone.start();
    await this.band.ready();
    await unlocked;
    this.begin(song, fromBar);
    this.transport.start("+0.06");
    this.state = "playing";
  }

  begin(song, fromBar = 0) {
    this.stop();
    this.song = song;
    this.bar = fromBar;
    this.slot = 0;
    this.endingSlots = 0;
    this.slotTicks = this.transport.PPQ / 4;
    this.transport.bpm.value = this.bpm;
    this.transport.scheduleRepeat((time) => this.tick(time), "16n", 0);
  }

  pause() {
    if (this.state !== "playing") return;
    this.transport.pause();
    this.band.silence();
    this.state = "paused";
  }

  async resume() {
    if (this.state !== "paused") return;
    await Tone.start();
    this.transport.start();
    this.state = "playing";
  }

  stop() {
    this.transport.stop();
    this.transport.cancel(0);
    this.band.silence();
    clearTimeout(this.endTimer);
    this.marks = [];
    this.pendingSeek = null;
    this.atBarLine = null;
    this.state = "stopped";
  }

  // Jump to the top of a bar on the next tick.
  seek(bar) {
    this.pendingSeek = bar;
  }

  // Run `remap(nextBar) -> bar` once, at the next bar line, so the caller
  // can change how bars are counted without cutting a bar short.
  onNextBarLine(remap) {
    this.atBarLine = remap;
  }

  tick(time) {
    const now = Math.round(this.transport.getTicksAtTime(time) / this.slotTicks);
    if (this.pendingSeek != null) {
      this.bar = this.pendingSeek;
      this.slot = 0;
      this.endingSlots = 0;
      this.pendingSeek = null;
    }
    if (this.endingSlots > 0) {
      if (--this.endingSlots === 0) this.finish(time);
      return;
    }
    if (this.slot === 0) {
      // A chunk of an offline render plays up to its last bar and no further.
      if (this.bar >= this.untilBar) return;
      this.band.releaseGuitar(time);
      if (this.atBarLine) {
        this.bar = this.atBarLine(this.bar);
        this.atBarLine = null;
      }
      const info = this.bar < this.song.bars ? this.song.barAt(this.bar) : null;
      if (!info) {
        this.playEnding(time, now);
        return;
      }
      this.mark = {
        bar: this.bar, start: now, info,
        slots: slotsPerBar(this.signature),
        steps: guitarSlots(this.pattern),
        drums: this.drums ? drumSlots(drumGroove(this.signature, this.pattern, this.drumStyle)) : null,
        bass: this.bass ? bassSlots(this.pattern) : null,
        pattern: this.pattern,
      };
      this.pushMark(this.mark);
    }
    const { steps, drums, bass, info } = this.mark;
    if (steps[this.slot]) this.playGuitar(steps[this.slot], time);
    if (drums) {
      for (const voice in drums) {
        const hit = drums[voice][this.slot];
        if (hit) this.band.drum(voice, time, DRUM_LEVELS[hit] || 0.75);
      }
    }
    if (bass && bass[this.slot]) {
      const token = bass[this.slot];
      this.band.bassNote(bassPitch(info.chord, token), time, this.ringSeconds(bass) + 0.05, token === "r" ? 0.6 : 0.9);
    }
    if (++this.slot >= this.mark.slots) {
      this.slot = 0;
      this.bar++;
    }
  }

  pushMark(mark) {
    this.marks.push(mark);
    if (this.marks.length > 8) this.marks.shift();
  }

  // How long until this line plays something else, or the bar ends.
  ringSeconds(line) {
    let ring = 1;
    while (this.slot + ring < this.mark.slots && !line[this.slot + ring]) ring++;
    return (ring * 15) / this.bpm;
  }

  playGuitar(token, time) {
    const notes = this.mark.info.chord.midi;
    const slotSeconds = 15 / this.bpm;
    const sustain = this.ringSeconds(this.mark.steps);
    const gap = Math.min(0.024, slotSeconds * 0.16);
    const band = this.band;

    if (token === "B") {
      band.pluck(notes[0], time, sustain + 0.4, 0.95);
    } else if (/[1-4]/.test(token)) {
      band.pluck(notes[Math.max(0, notes.length - Number(token))], time, sustain + 0.4, 0.7);
    } else if (token === "x") {
      band.strum(notes, time, 0.004, 0.035, 0.4);
    } else if (token === "c") {
      band.strum(notes, time, gap * 0.5, 0.11, 0.95);
    } else {
      const accent = token === "D" || token === "U";
      if (token === "D" || token === "d") {
        band.strum(notes, time, gap, sustain + 0.12, accent ? 0.95 : 0.6);
      } else {
        // An up strum mostly catches the treble strings.
        const treble = notes.slice(-4).reverse();
        band.strum(treble, time, gap * 0.8, sustain + 0.12, accent ? 0.8 : 0.5);
      }
    }
  }

  // One slow strum of the closing chord, left to ring, then stop.
  playEnding(time, now) {
    const slotSeconds = 15 / this.bpm;
    const chord = this.song.ending;
    this.endingSlots = Math.max(1, Math.ceil(ENDING_SECONDS / slotSeconds));
    if (chord) {
      this.band.strum(chord.midi, time, 0.035, ENDING_SECONDS, 0.95);
      if (this.bass) this.band.bassNote(bassPitch(chord, "R"), time, ENDING_SECONDS, 0.9);
    }
    if (this.drums) {
      this.band.drum("k", time, 1);
      this.band.drum("o", time, 0.9);
    }
    this.pushMark({
      bar: this.song.bars, start: now, slots: this.endingSlots,
      info: { chord }, steps: [], pattern: null, ending: true,
    });
  }

  finish(time) {
    this.transport.stop(time);
    // An offline render just runs out; nothing is listening for the end.
    if (this.offline) return;
    const delay = Math.max(0, time - this.transport.immediate()) * 1000;
    this.endTimer = setTimeout(() => {
      this.stop();
      this.onEnd();
    }, delay);
  }

  // Where the audible playhead is right now, or null before the first bar.
  position() {
    if (!this.marks.length) return null;
    const slotNow = this.transport.getTicksAtTime(this.transport.immediate()) / this.slotTicks;
    let mark = this.marks[0];
    for (const candidate of this.marks) if (candidate.start <= slotNow) mark = candidate;
    const into = Math.max(0, slotNow - mark.start);
    return {
      bar: mark.bar,
      info: mark.info,
      pattern: mark.pattern,
      slot: Math.min(mark.slots - 1, Math.floor(into)),
      slots: mark.slots,
      fraction: Math.min(1, into / mark.slots),
      ending: Boolean(mark.ending),
    };
  }
}

// ---------------------------------------------------------------------------
// Getting a song out as a file
// ---------------------------------------------------------------------------

// 16-bit mono WAV from samples in the range -1..1.
function encodeWav(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, string) => [...string].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  // The limiter lets the odd transient through; bring the whole file down
  // rather than clip it.
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const scale = peak > 0.97 ? 0.97 / peak : 1;
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i] * scale * 32767, true);
  return new Blob([view], { type: "audio/wav" });
}

// Hands control back to the page for a moment. A message channel rather
// than a timer, because browsers slow timers to one a second in a tab that
// isn't in front, and a render shouldn't crawl because of that.
function breathe() {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

// Renders bars [fromBar, untilBar) of a song, plus `tail` seconds for the
// last notes and the reverb to die away, in an offline context of its own.
async function renderChunk(song, settings, fromBar, untilBar, seconds) {
  const live = Tone.getContext();
  const context = new Tone.OfflineContext(2, seconds, RENDER_RATE);
  Tone.setContext(context);
  let rendering;
  try {
    const band = new Band();
    band.setLevels(settings.levels);
    await band.setGuitar(settings.guitar);
    if (settings.bass) await band.loadBass();
    const player = new Player(band, context.transport, true);
    player.signature = settings.signature;
    player.pattern = settings.pattern;
    player.bpm = settings.bpm;
    player.drums = settings.drums;
    player.drumStyle = settings.drumStyle;
    player.bass = settings.bass;
    player.begin(song, fromBar);
    player.untilBar = untilBar;
    context.transport.start(0);
    // Stepping the clock in one go, rather than with the library's pauses,
    // keeps this quick in a tab that isn't in front.
    rendering = context.render(false);
  } finally {
    Tone.setContext(live);
  }
  return (await rendering).get();
}

// Renders a whole song faster than real time and resolves to a WAV Blob.
// settings: { signature, pattern, bpm, drums, drumStyle, bass, guitar, levels }
// onProgress(fraction) is called as it goes.
//
// The song is rendered a few bars at a time and the pieces overlapped: one
// long offline context has to carry every note of the song at once, and
// slows down with the square of its length.
export async function renderSong(song, settings, onProgress = () => {}) {
  const barSeconds = (slotsPerBar(settings.signature) * 15) / settings.bpm;
  const seconds = songSeconds(song.bars, settings.signature, settings.bpm) + 0.3;
  if (!(seconds <= MAX_RENDER_SECONDS)) {
    throw new Error(`Songs over ${MAX_RENDER_SECONDS / 60} minutes are too long to download. Try a faster tempo, one chord per stop, or a shorter trip.`);
  }
  await loadSamples(findGuitar(settings.guitar).samples);
  if (settings.bass) await loadSamples("bass");

  const mix = new Float32Array(Math.ceil(seconds * RENDER_RATE));
  const chunkBars = Math.max(1, Math.floor(CHUNK_SECONDS / barSeconds));
  for (let fromBar = 0; fromBar < song.bars; fromBar += chunkBars) {
    const last = fromBar + chunkBars >= song.bars;
    const untilBar = last ? Infinity : fromBar + chunkBars;
    const bars = Math.min(chunkBars, song.bars - fromBar);
    const length = bars * barSeconds + (last ? ENDING_SECONDS + 0.3 : CHUNK_TAIL_SECONDS);
    const chunk = await renderChunk(song, settings, fromBar, untilBar, length);
    const offset = Math.round(fromBar * barSeconds * RENDER_RATE);
    const channels = [];
    for (let c = 0; c < chunk.numberOfChannels; c++) channels.push(chunk.getChannelData(c));
    const count = Math.min(chunk.length, mix.length - offset);
    for (let i = 0; i < count; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      mix[offset + i] += sample / channels.length;
    }
    onProgress(Math.min(1, (fromBar + bars) / song.bars));
    await breathe();
  }
  return encodeWav(mix, RENDER_RATE);
}

// Records what the band plays, as it plays. The browser picks the format
// (WebM or Ogg in Chrome and Firefox, MP4 in Safari).
export class LiveRecorder {
  static get supported() {
    return Boolean(Tone.Recorder && Tone.Recorder.supported);
  }

  constructor(band) {
    this.band = band;
    this.recorder = new Tone.Recorder();
    band.limiter.connect(this.recorder);
  }

  start() {
    return this.recorder.start();
  }

  // Resolves to a Blob.
  async stop() {
    const blob = await this.recorder.stop();
    this.band.limiter.disconnect(this.recorder);
    this.recorder.dispose();
    return blob;
  }
}
