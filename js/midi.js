// A song as a Standard MIDI File: the notes the band is asked to play,
// written down rather than sounded, for opening in a music program.
//
// A MidiScribe stands where a Band would (see audio.js): the player calls
// strum(), bassNote() and drum() on it with the same arguments. It keeps
// the notes in musical time (ticks), so bar lines land where they should
// even when the tempo or the time signature changed along the way.
//
// What a MIDI file can't hold is left out: the guitar tones, the reverb and
// the mix. So is the small random looseness the band plays with, so that
// the same song always gives the same file.

import { findGuitar } from "./band.js";

const PPQ = 480; // ticks to a quarter note
const GUITAR = 0;
const BASS = 1;
const DRUMS = 2;
const PARTS = [
  { name: "Guitar", channel: 0 },
  { name: "Bass", channel: 1, program: 33 }, // electric bass, fingered
  { name: "Drums", channel: 9 }, // the General MIDI drum channel
];
// General MIDI programs, counted from 0.
const GUITAR_PROGRAMS = {
  electric: 27, chorus: 27, electric12: 27, // electric guitar, clean
  crunch: 29, // overdriven guitar
  fuzz: 30, // distortion guitar
  acoustic: 25, acoustic12: 25, // steel-string acoustic
  nylon: 24,
};
// General MIDI drum notes for the band's kick, snare, closed and open
// hi-hat, and rim click.
const DRUM_NOTES = { k: 36, s: 38, h: 42, o: 46, r: 37 };
const DRUM_TICKS = PPQ / 8;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class MidiScribe {
  // transport: the clock the player runs on. guitar: () => the id of the
  // guitar being played, asked at every strum since it can change mid-song.
  constructor({ transport, guitar, title = "what3chords song", about = "" }) {
    this.transport = transport;
    this.guitar = guitar;
    this.title = title;
    this.about = about;
    this.notes = [[], [], []]; // per part: { at, until, pitch, velocity }
    this.sounding = [new Map(), new Map(), new Map()]; // pitch -> its latest note
    this.conductor = []; // { at, bytes }: tempo, time signature, markers
    this.programs = []; // { at, program }: the guitar, each time it changes
    this.base = 0; // where the transport's zero falls in the file
    this.end = 0;
    this.bpm = null;
    this.signature = null;
    this.program = null;
  }

  get empty() {
    return this.notes.every((part) => !part.length);
  }

  // ---- time ---------------------------------------------------------------

  tick(time) {
    return this.base + Math.round((this.transport.getTicksAtTime(time) * PPQ) / this.transport.PPQ);
  }

  // A length in seconds, in ticks at the tempo of the moment.
  span(seconds) {
    return Math.round((seconds * this.transport.bpm.value * PPQ) / 60);
  }

  // The player is starting over from the transport's zero; carry on from
  // the next beat after whatever has been written.
  restart() {
    this.base = Math.ceil(this.end / PPQ) * PPQ;
    this.signature = null;
  }

  tempoAt(at) {
    const bpm = Math.round(this.transport.bpm.value * 1000) / 1000;
    if (bpm === this.bpm || !(bpm > 0)) return;
    this.bpm = bpm;
    const micros = clamp(Math.round(60e6 / bpm), 1, 0xffffff);
    this.conductor.push({ at, bytes: [0xff, 0x51, 3, micros >> 16, (micros >> 8) & 0xff, micros & 0xff] });
  }

  // Called at the top of every bar.
  bar(time, signature, info) {
    const at = this.tick(time);
    this.tempoAt(at);
    if (signature !== this.signature) {
      this.signature = signature;
      const [beats, unit] = signature.split("/").map(Number);
      // Metronome click: a dotted quarter in 6/8, otherwise the beat.
      const click = beats === 6 && unit === 8 ? 36 : 96 / unit;
      this.conductor.push({ at, bytes: [0xff, 0x58, 4, beats, Math.log2(unit), click, 8] });
    }
    if (info && info.chord) this.conductor.push({ at, bytes: meta(0x06, info.chord.name) });
  }

  // ---- notes --------------------------------------------------------------

  // A `yielding` note gives way to one of the same pitch already ringing.
  add(part, pitch, at, until, velocity, yielding = false) {
    if (!(pitch >= 0 && pitch <= 127)) return;
    const sounding = this.sounding[part];
    const earlier = sounding.get(pitch);
    if (earlier && earlier.until > at) {
      if (yielding) return;
      // The same note twice at once reads as one note; keep the first.
      if (earlier.at >= at) return;
      earlier.until = at;
    }
    const note = { at, until: Math.max(at + 1, until), pitch, velocity: clamp(Math.round(velocity * 127), 1, 127) };
    this.notes[part].push(note);
    sounding.set(pitch, note);
    this.end = Math.max(this.end, note.until);
  }

  // Stops whatever a part has ringing at `at`.
  cut(part, at) {
    for (const note of this.sounding[part].values()) {
      if (note.at < at && note.until > at) note.until = at;
    }
  }

  // `notes` are MIDI numbers in the order they should sound.
  strum(notes, time, gap, duration, velocity) {
    const at = this.tick(time);
    this.tempoAt(at);
    const guitar = findGuitar(this.guitar());
    const program = GUITAR_PROGRAMS[guitar.id] ?? GUITAR_PROGRAMS.electric;
    if (program !== this.program) {
      this.program = program;
      this.programs.push({ at, program });
    }
    const length = this.span(duration);
    notes.forEach((midi, i) => {
      const start = at + this.span(gap * i);
      const level = clamp(velocity * (1 - 0.05 * i), 0.05, 1);
      this.add(GUITAR, midi, start, start + length, level);
      // A 12-string pairs its four lower courses with a string an octave up.
      if (guitar.twelve && midi < 59) this.add(GUITAR, midi + 12, start + this.span(0.007), start + length, level * 0.55, true);
    });
  }

  pluck(midi, time, duration, velocity) {
    this.strum([midi], time, 0, duration, velocity);
  }

  bassNote(midi, time, duration, velocity) {
    const at = this.tick(time);
    this.tempoAt(at);
    this.cut(BASS, at);
    this.add(BASS, midi, at, at + this.span(duration), velocity);
  }

  drum(voice, time, velocity) {
    if (!DRUM_NOTES[voice]) return;
    const at = this.tick(time);
    this.tempoAt(at);
    this.add(DRUMS, DRUM_NOTES[voice], at, at + DRUM_TICKS, velocity);
  }

  releaseGuitar(time) {
    this.cut(GUITAR, this.tick(time));
  }

  // The band was hushed (a pause): nothing rings on past this moment.
  silence() {
    const at = this.tick(this.transport.immediate());
    this.cut(GUITAR, at);
    this.cut(BASS, at);
  }

  // ---- the file -----------------------------------------------------------

  // The whole thing as a Blob.
  file() {
    const tracks = [];
    const conductor = [
      { at: 0, rank: 0, bytes: meta(0x03, this.title) },
      ...(this.about ? [{ at: 0, rank: 0, bytes: meta(0x01, this.about) }] : []),
      ...this.conductor.map((event) => ({ ...event, rank: 1 })),
    ];
    tracks.push(track(conductor));
    PARTS.forEach((part, index) => {
      const notes = this.notes[index];
      if (!notes.length) return;
      const events = [{ at: 0, rank: 0, bytes: meta(0x03, part.name) }];
      if (part.program != null) events.push({ at: 0, rank: 1, bytes: [0xc0 | part.channel, part.program] });
      if (index === GUITAR) {
        // The first choice of guitar applies from the top.
        this.programs.forEach((change, i) => {
          events.push({ at: i ? change.at : 0, rank: 1, bytes: [0xc0 | part.channel, change.program] });
        });
      }
      for (const note of notes) {
        events.push({ at: note.at, rank: 2, bytes: [0x90 | part.channel, note.pitch, note.velocity] });
        events.push({ at: note.until, rank: 0, bytes: [0x80 | part.channel, note.pitch, 0] });
      }
      tracks.push(track(events));
    });
    const header = [...ascii("MThd"), 0, 0, 0, 6, 0, 1, 0, tracks.length, PPQ >> 8, PPQ & 0xff];
    return new Blob([new Uint8Array(header), ...tracks], { type: "audio/midi" });
  }
}

const ascii = (text) => [...text].map((ch) => ch.charCodeAt(0));

// A number in MIDI's variable-length form: seven bits to a byte, the top
// bit set on every byte but the last.
function variable(value) {
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

// A text event: a track's name (3), a marker (6), plain text (1).
function meta(type, text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  return [0xff, type, ...variable(bytes.length), ...bytes];
}

// One track chunk from events of { at, rank, bytes }. At the same instant,
// notes end (rank 0) before anything else, and begin (rank 2) last.
function track(events) {
  const ordered = events
    .map((event, index) => ({ ...event, index }))
    .sort((a, b) => a.at - b.at || a.rank - b.rank || a.index - b.index);
  const bytes = [];
  let last = 0;
  for (const event of ordered) {
    bytes.push(...variable(event.at - last), ...event.bytes);
    last = event.at;
  }
  bytes.push(0, 0xff, 0x2f, 0); // end of track
  const length = bytes.length;
  return new Uint8Array([...ascii("MTrk"), (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...bytes]);
}
