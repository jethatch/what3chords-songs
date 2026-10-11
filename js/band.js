// The instruments: sampled guitars, a sampled bass and a synthesised drum
// kit, wired to a small mixer. A Band builds its audio graph in whatever
// Tone.js context is current when it is constructed, so the same code plays
// live and renders a song to a file.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const jitter = (amount) => (Math.random() * 2 - 1) * amount;

// Sample sets. Keys are the pitch each file actually sounds at.
const SAMPLES = {
  electric: {
    base: "./audio/guitar-electric/",
    // The upstream files are named an octave below what they sound.
    urls: {
      E2: "E1.mp3", G2: "G1.mp3", A2: "A1.mp3", C3: "C2.mp3", D3: "D2.mp3", F3: "F2.mp3",
      G3: "G2.mp3", "A#3": "As2.mp3", B3: "B2.mp3", D4: "D3.mp3", E4: "E3.mp3", G4: "G3.mp3",
    },
  },
  acoustic: {
    base: "./audio/guitar-acoustic/",
    urls: {
      E2: "E2.mp3", G2: "G2.mp3", "A#2": "As2.mp3", "C#3": "Cs3.mp3", E3: "E3.mp3", G3: "G3.mp3",
      "A#3": "As3.mp3", "C#4": "Cs4.mp3", E4: "E4.mp3", G4: "G4.mp3", "A#4": "As4.mp3", "C#5": "Cs5.mp3", D5: "D5.mp3",
    },
  },
  nylon: {
    base: "./audio/guitar-nylon/",
    urls: {
      E2: "E2.mp3", "G#2": "Gs2.mp3", B2: "B2.mp3", D3: "D3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
      "C#4": "Cs4.mp3", E4: "E4.mp3", "G#4": "Gs4.mp3", B4: "B4.mp3",
      // This file is labelled D5 in its source library but sounds a semitone higher.
      "D#5": "D5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
    },
  },
  bass: {
    base: "./audio/bass-electric/",
    urls: {
      E1: "E1.mp3", G1: "G1.mp3", "A#1": "As1.mp3", "C#2": "Cs2.mp3",
      E2: "E2.mp3", G2: "G2.mp3", "A#2": "As2.mp3", "C#3": "Cs3.mp3",
    },
  },
};

// Guitars on offer. `tone` picks an effect chain; `twelve` doubles the lower
// strings an octave up, the way a 12-string is strung.
export const GUITARS = [
  { id: "electric", name: "Electric, clean", samples: "electric", tone: "clean", gain: -9 },
  { id: "crunch", name: "Electric, crunch", samples: "electric", tone: "crunch", gain: -13 },
  { id: "fuzz", name: "Electric, fuzz", samples: "electric", tone: "fuzz", gain: -18 },
  { id: "chorus", name: "Electric, chorus", samples: "electric", tone: "chorus", gain: -8 },
  { id: "electric12", name: "Electric 12-string", samples: "electric", tone: "chorus", twelve: true, gain: -9 },
  { id: "acoustic", name: "Steel-string acoustic", samples: "acoustic", tone: "clean", gain: -8 },
  { id: "acoustic12", name: "12-string acoustic", samples: "acoustic", tone: "clean", twelve: true, gain: -8 },
  { id: "nylon", name: "Nylon (classical)", samples: "nylon", tone: "clean", gain: -8 },
];

export function findGuitar(id) {
  return GUITARS.find((guitar) => guitar.id === id) || GUITARS[0];
}

// ---------------------------------------------------------------------------
// Sample loading (shared by every Band, live or offline)
// ---------------------------------------------------------------------------

// MP3 decoders disagree about how much silence to leave at the front of a
// file. Cutting it off keeps the guitars in time with the synthesised drums.
function trimStart(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  let first = 0;
  while (first < data.length && Math.abs(data[first]) < 0.004) first++;
  first = Math.max(0, first - 32);
  if (first < 64 || first >= data.length - 1) return audioBuffer;
  const context = Tone.getContext();
  const trimmed = context.createBuffer(audioBuffer.numberOfChannels, audioBuffer.length - first, audioBuffer.sampleRate);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    trimmed.copyToChannel(audioBuffer.getChannelData(channel).subarray(first), channel);
  }
  return trimmed;
}

const sampleSets = new Map();

// Resolves to { note: AudioBuffer } for one sample set, fetched once.
export function loadSamples(key) {
  if (!sampleSets.has(key)) {
    const { base, urls } = SAMPLES[key];
    const loading = Promise.all(Object.entries(urls).map(async ([note, file]) => {
      const buffer = await Tone.ToneAudioBuffer.fromUrl(base + file);
      return [note, trimStart(buffer.get())];
    })).then(Object.fromEntries);
    // A failed download shouldn't be remembered as the answer.
    loading.catch(() => sampleSets.delete(key));
    sampleSets.set(key, loading);
  }
  return sampleSets.get(key);
}

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

function makeReverb(seconds) {
  const context = Tone.getContext();
  const length = Math.floor(seconds * context.sampleRate);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return new Tone.Convolver(impulse);
}

function toneChain(tone) {
  if (tone === "crunch") {
    return [new Tone.Distortion({ distortion: 0.28, oversample: "2x" }), new Tone.Filter(4200, "lowpass")];
  }
  if (tone === "fuzz") {
    return [new Tone.Distortion({ distortion: 0.85, oversample: "2x" }), new Tone.Filter(3000, "lowpass")];
  }
  if (tone === "chorus") {
    return [new Tone.Chorus({ frequency: 1.4, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start()];
  }
  return [];
}

export class Band {
  constructor() {
    this.limiter = new Tone.Limiter(-1.5).toDestination();
    this.output = new Tone.Gain(0.9).connect(this.limiter);
    this.reverb = makeReverb(1.8);
    this.reverbLevel = new Tone.Gain(0.16).connect(this.output);
    this.reverb.connect(this.reverbLevel);

    this.guitarBus = new Tone.Gain(0.8).connect(this.output);
    this.guitarBus.connect(this.reverb);
    this.bassBus = new Tone.Gain(0.8).connect(this.output);
    this.drumBus = new Tone.Gain(0.8).connect(this.output);
    this.drumRoom = new Tone.Gain(0.25).connect(this.reverb);
    this.drumBus.connect(this.drumRoom);

    this.guitar = null; // { def, sampler, chain }
    this.bass = null;
    this.buildDrums();
  }

  setLevels({ guitar, bass, drums }) {
    this.guitarBus.gain.value = guitar;
    this.bassBus.gain.value = bass;
    this.drumBus.gain.value = drums;
  }

  // ---- guitar -------------------------------------------------------------

  // Swaps in a guitar once its samples are ready; the old one keeps playing
  // until then.
  setGuitar(id) {
    this.guitarReady = this.swapGuitar(id).catch((error) => {
      // Forget the request so that asking again tries again (unless a
      // different guitar has been asked for since).
      if (this.wanted === id) this.wanted = null;
      throw error;
    });
    return this.guitarReady;
  }

  // Resolves once everything asked for has either loaded or failed. A band
  // missing its bass, or still on its previous guitar, can still play; one
  // with no guitar at all cannot.
  async ready() {
    await Promise.allSettled([this.guitarReady, this.bassLoading].filter(Boolean));
    if (!this.guitar) throw new Error("The guitar hasn’t loaded. Check your connection and press play again.");
  }

  async swapGuitar(id) {
    const def = findGuitar(id);
    this.wanted = def.id;
    const buffers = await loadSamples(def.samples);
    if (this.wanted !== def.id) return;
    const sampler = new Tone.Sampler({ urls: buffers, release: 0.35, volume: def.gain });
    const chain = toneChain(def.tone);
    sampler.chain(...chain, this.guitarBus);
    const old = this.guitar;
    this.guitar = { def, sampler, chain };
    if (old) {
      old.sampler.releaseAll();
      // Let the old notes die away before tearing the nodes down.
      setTimeout(() => [old.sampler, ...old.chain].forEach((node) => node.dispose()), 1500);
    }
  }

  // `notes` are MIDI numbers in the order they should sound.
  strum(notes, time, gap, duration, velocity) {
    if (!this.guitar) return;
    const { sampler, def } = this.guitar;
    let at = time + Math.abs(jitter(0.004));
    notes.forEach((midi, i) => {
      const level = Math.max(0.05, Math.min(1, velocity * (1 - 0.05 * i) + jitter(0.05)));
      sampler.triggerAttackRelease(noteName(midi), duration, at, level);
      // A 12-string pairs its four lower courses with a string an octave up.
      if (def.twelve && midi < 59) sampler.triggerAttackRelease(noteName(midi + 12), duration, at + 0.007, level * 0.55);
      at += gap * (1 + jitter(0.15));
    });
  }

  pluck(midi, time, duration, velocity) {
    this.strum([midi], time, 0, duration, velocity);
  }

  // ---- bass ---------------------------------------------------------------

  async loadBass() {
    if (this.bass || this.bassLoading) return this.bassLoading;
    this.bassLoading = loadSamples("bass").then((buffers) => {
      this.bass = new Tone.Sampler({ urls: buffers, release: 0.12, volume: -2 }).connect(this.bassBus);
    });
    this.bassLoading.catch(() => { this.bassLoading = null; });
    return this.bassLoading;
  }

  bassNote(midi, time, duration, velocity) {
    if (!this.bass) return;
    this.bass.releaseAll(time);
    this.bass.triggerAttackRelease(noteName(midi), duration, time, velocity);
  }

  // ---- drums --------------------------------------------------------------

  buildDrums() {
    const bus = this.drumBus;
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.035, octaves: 5.5, volume: -6,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.05 },
    }).connect(bus);
    // Snare: a burst of noise for the wires over a short tuned thump.
    const snareTone = new Tone.Filter(1800, "highpass").connect(bus);
    this.snareNoise = new Tone.NoiseSynth({
      noise: { type: "white" }, volume: -9,
      envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.03 },
    }).connect(snareTone);
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.02, octaves: 2, volume: -12,
      envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.03 },
    }).connect(bus);
    const hatTone = new Tone.Filter(7500, "highpass").connect(bus);
    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" }, volume: -17,
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
    }).connect(hatTone);
    this.openHat = new Tone.NoiseSynth({
      noise: { type: "white" }, volume: -19,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.05 },
    }).connect(hatTone);
    const rimTone = new Tone.Filter(1700, "bandpass").connect(bus);
    this.rim = new Tone.NoiseSynth({
      noise: { type: "pink" }, volume: -4,
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
    }).connect(rimTone);
    this.drumNodes = [this.kick, this.snareNoise, this.snareBody, this.hat, this.openHat, this.rim, snareTone, hatTone, rimTone];
  }

  // voice: k, s, h, o, r
  drum(voice, time, velocity) {
    const at = time + Math.abs(jitter(0.002));
    if (voice === "k") {
      this.kick.triggerAttackRelease(48, 0.3, at, velocity);
    } else if (voice === "s") {
      this.snareNoise.triggerAttackRelease(0.17, at, velocity);
      this.snareBody.triggerAttackRelease(185, 0.1, at, velocity);
    } else if (voice === "h") {
      this.hat.triggerAttackRelease(0.045, at, velocity);
    } else if (voice === "o") {
      this.openHat.triggerAttackRelease(0.3, at, velocity);
    } else if (voice === "r") {
      this.rim.triggerAttackRelease(0.03, at, velocity);
    }
  }

  // ---- everything ---------------------------------------------------------

  releaseGuitar(time) {
    if (this.guitar) this.guitar.sampler.releaseAll(time);
  }

  silence() {
    this.releaseGuitar();
    if (this.bass) this.bass.releaseAll();
  }
}
