// Guitar playback: a sampled electric guitar strummed bar by bar.
//
// Everything runs off one repeating sixteenth-note tick on the Tone.js
// transport. At the top of each bar the player latches the current time
// signature and strum pattern, so changing either mid-song takes effect on
// the next bar line; tempo changes apply immediately.

const SAMPLE_BASE = "./audio/guitar-electric/";
// The upstream sample files are named an octave below what they sound.
const SAMPLE_URLS = {
  E2: "E1.mp3", G2: "G1.mp3", A2: "A1.mp3", C3: "C2.mp3", D3: "D2.mp3", F3: "F2.mp3",
  G3: "G2.mp3", "A#3": "As2.mp3", B3: "B2.mp3", D4: "D3.mp3", E4: "E3.mp3", G4: "G3.mp3",
};
const ENDING_SECONDS = 2.6;

// Strum patterns, one token per eighth note (grid 8) or sixteenth (grid 16):
//   D / d  down strum, accented / soft      U / u  up strum, accented / soft
//   c      short choppy down strum          x      muted scratch
//   B      bass string alone                1-4    one string, counted from the highest
//   -      nothing (let it ring)
export const PATTERNS = {
  "4/4": [
    { id: "ramones", name: "Ramones (the original)", grid: 8, steps: "D U D U D - D -" },
    { id: "downstrokes", name: "Punk downstrokes", grid: 8, steps: "D d D d D d D d" },
    { id: "campfire", name: "Campfire", grid: 8, steps: "D - D U - U D U" },
    { id: "doubletime", name: "Double-time", grid: 16, steps: "D - D U - U D U D - D U - U D U" },
    { id: "reggae", name: "Reggae chop", grid: 8, steps: "- - c - - - c -" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 3 1 3 2 3" },
    { id: "ring", name: "Let it ring", grid: 8, steps: "D - - - - - - -" },
  ],
  "3/4": [
    { id: "waltz", name: "Waltz (oom-pah-pah)", grid: 8, steps: "B - d - d -" },
    { id: "folk", name: "Folk strum", grid: 8, steps: "D - D U D U" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 1 2 3" },
    { id: "ring", name: "Let it ring", grid: 8, steps: "D - - - - -" },
  ],
  "6/8": [
    { id: "rolling", name: "Rolling", grid: 8, steps: "D d u D d u" },
    { id: "sway", name: "Slow sway", grid: 8, steps: "D - u D - u" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 1 2 3" },
    { id: "ring", name: "Let it ring", grid: 8, steps: "D - - d - -" },
  ],
  "2/4": [
    { id: "boomchick", name: "Boom-chick", grid: 8, steps: "B - c -" },
    { id: "gallop", name: "Gallop", grid: 16, steps: "D - d u D - d u" },
    { id: "downstrokes", name: "Punk downstrokes", grid: 8, steps: "D d D d" },
  ],
  "5/4": [
    { id: "takefive", name: "Take five", grid: 8, steps: "D - - U - - D - D -" },
    { id: "downstrokes", name: "Downstrokes (3+2)", grid: 8, steps: "D d d d d d D d d d" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 1 2 3 B 2 1 2" },
  ],
  "7/8": [
    { id: "twotwothree", name: "2 + 2 + 3", grid: 8, steps: "D u D u D d u" },
    { id: "downstrokes", name: "Downstrokes", grid: 8, steps: "D d D d D d d" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 2 B 2 B 2 1" },
  ],
};
export const SIGNATURES = Object.keys(PATTERNS);

// Sixteenth-note slots in one bar.
export function slotsPerBar(signature) {
  const [beats, unit] = signature.split("/").map(Number);
  return (beats * 16) / unit;
}

export function findPattern(signature, id) {
  const list = PATTERNS[signature];
  return list.find((pattern) => pattern.id === id) || list[0];
}

export function patternTokens(pattern) {
  return pattern.steps.split(" ");
}

// Counting labels for a pattern's grid: "1 & 2 &", "1 e & a", or "1 2 3" in x/8.
export function gridLabels(signature, pattern) {
  const unit = Number(signature.split("/")[1]);
  const perBeat = pattern.grid / unit;
  const within = { 1: [""], 2: ["", "&"], 4: ["", "e", "&", "a"] }[perBeat];
  return patternTokens(pattern).map((_, i) => within[i % perBeat] || String(Math.floor(i / perBeat) + 1));
}

// One entry per sixteenth slot: a token, or null where nothing is played.
function expand(pattern) {
  const stride = 16 / pattern.grid;
  const slots = [];
  for (const token of patternTokens(pattern)) {
    slots.push(token === "-" ? null : token);
    for (let i = 1; i < stride; i++) slots.push(null);
  }
  return slots;
}

export function songSeconds(bars, signature, bpm) {
  return (bars * slotsPerBar(signature) * 15) / bpm + ENDING_SECONDS;
}

const jitter = (amount) => (Math.random() * 2 - 1) * amount;

export class Player {
  constructor() {
    this.state = "stopped"; // "stopped" | "playing" | "paused"
    this.signature = "4/4";
    this.pattern = PATTERNS["4/4"][0];
    this.bpm = 120;
    this.song = null;
    this.marks = [];
    this.onEnd = () => {};
    this.loaded = null;
  }

  // Builds the instrument and starts fetching samples. Safe to call before
  // any user gesture; the audio context stays suspended until play().
  load() {
    if (this.loaded) return this.loaded;
    this.loaded = new Promise((resolve, reject) => {
      this.limiter = new Tone.Limiter(-2).toDestination();
      this.reverb = new Tone.Reverb({ decay: 1.8, wet: 0.14 }).connect(this.limiter);
      this.sampler = new Tone.Sampler({
        urls: SAMPLE_URLS,
        baseUrl: SAMPLE_BASE,
        release: 0.35,
        volume: -9,
        onload: () => resolve(),
        onerror: () => reject(new Error("The guitar samples failed to load.")),
      }).connect(this.reverb);
    });
    return this.loaded;
  }

  setTempo(bpm) {
    this.bpm = bpm;
    Tone.getTransport().bpm.value = bpm;
  }

  setVolume(level) {
    Tone.getDestination().volume.value = level <= 0 ? -Infinity : Tone.gainToDb(level);
  }

  // song: { bars, barAt(i) -> { chord, ...anything the caller wants back from
  // position() }, ending: chord|null }
  async play(song, fromBar = 0) {
    // Ask for the audio context first, while the click that got us here
    // still counts as a user gesture, then wait for the samples.
    const unlocked = Tone.start();
    await this.load();
    await unlocked;
    this.stop();
    const transport = Tone.getTransport();
    this.song = song;
    this.bar = fromBar;
    this.slot = 0;
    this.endingSlots = 0;
    this.slotTicks = transport.PPQ / 4;
    transport.bpm.value = this.bpm;
    transport.scheduleRepeat((time) => this.tick(time), "16n", 0);
    transport.start("+0.06");
    this.state = "playing";
  }

  pause() {
    if (this.state !== "playing") return;
    Tone.getTransport().pause();
    this.sampler.releaseAll();
    this.state = "paused";
  }

  async resume() {
    if (this.state !== "paused") return;
    await Tone.start();
    Tone.getTransport().start();
    this.state = "playing";
  }

  stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    if (this.sampler) this.sampler.releaseAll();
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
    const transport = Tone.getTransport();
    const now = Math.round(transport.getTicksAtTime(time) / this.slotTicks);
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
      this.sampler.releaseAll(time);
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
        steps: expand(this.pattern),
        pattern: this.pattern,
      };
      this.pushMark(this.mark);
    }
    const token = this.mark.steps[this.slot];
    if (token) this.playToken(token, time);
    if (++this.slot >= this.mark.slots) {
      this.slot = 0;
      this.bar++;
    }
  }

  pushMark(mark) {
    this.marks.push(mark);
    if (this.marks.length > 8) this.marks.shift();
  }

  playToken(token, time) {
    const { steps, slots, info } = this.mark;
    const notes = info.chord.midi;
    const slotSeconds = 15 / this.bpm;
    let ring = 1;
    while (this.slot + ring < slots && !steps[this.slot + ring]) ring++;
    const sustain = ring * slotSeconds;
    const gap = Math.min(0.024, slotSeconds * 0.16);

    if (token === "B") {
      this.pluck(notes[0], sustain + 0.4, time, 0.95);
    } else if (/[1-4]/.test(token)) {
      this.pluck(notes[Math.max(0, notes.length - Number(token))], sustain + 0.4, time, 0.7);
    } else if (token === "x") {
      this.strum(notes, time, 0.004, 0.035, 0.4);
    } else if (token === "c") {
      this.strum(notes, time, gap * 0.5, 0.11, 0.95);
    } else {
      const accent = token === "D" || token === "U";
      if (token === "D" || token === "d") {
        this.strum(notes, time, gap, sustain + 0.12, accent ? 0.95 : 0.6);
      } else {
        // An up strum mostly catches the treble strings.
        const treble = notes.slice(-4).reverse();
        this.strum(treble, time, gap * 0.8, sustain + 0.12, accent ? 0.8 : 0.5);
      }
    }
  }

  pluck(midi, duration, time, velocity) {
    this.sampler.triggerAttackRelease(
      Tone.Frequency(midi, "midi").toNote(), duration, time + Math.abs(jitter(0.004)), velocity,
    );
  }

  strum(notes, time, gap, duration, velocity) {
    let at = time + Math.abs(jitter(0.004));
    notes.forEach((midi, i) => {
      const level = Math.max(0.05, Math.min(1, velocity * (1 - 0.05 * i) + jitter(0.05)));
      this.sampler.triggerAttackRelease(Tone.Frequency(midi, "midi").toNote(), duration, at, level);
      at += gap * (1 + jitter(0.15));
    });
  }

  // One slow strum of the closing chord, left to ring, then stop.
  playEnding(time, now) {
    const slotSeconds = 15 / this.bpm;
    this.endingSlots = Math.max(1, Math.ceil(ENDING_SECONDS / slotSeconds));
    if (this.song.ending) this.strum(this.song.ending.midi, time, 0.035, ENDING_SECONDS, 0.95);
    this.pushMark({
      bar: this.song.bars, start: now, slots: this.endingSlots,
      info: { chord: this.song.ending }, steps: [], pattern: null, ending: true,
    });
  }

  finish(time) {
    Tone.getTransport().stop(time);
    const delay = Math.max(0, time - Tone.immediate()) * 1000;
    this.endTimer = setTimeout(() => {
      this.stop();
      this.onEnd();
    }, delay);
  }

  // Where the audible playhead is right now, or null before the first bar.
  position() {
    if (!this.marks.length) return null;
    const transport = Tone.getTransport();
    const slotNow = transport.getTicksAtTime(Tone.immediate()) / this.slotTicks;
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
