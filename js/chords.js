// The what3chords code book: every place on Earth maps to three guitar
// chord voicings. A grid (see grid.js) turns the place into a number; this
// turns the number into chords. With the H3 grid it is a port of the scheme
// from https://github.com/DOSull/what3chords, so a place gets the same three
// chords here as it does there.

import { GRIDS } from "./grid.js";

// Standard tuning, low E to high E.
const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
const FRET_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

let names = [];
let nameOfVoicing = new Uint16Array(0);
let frets = "";
let voicingCount = 0;

export async function loadChords(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Chord data failed to load (${response.status})`);
  const data = await response.json();
  names = data.names;
  frets = data.frets;
  voicingCount = frets.length / 6;
  nameOfVoicing = new Uint16Array(voicingCount);
  let v = 0;
  data.counts.forEach((count, nameIndex) => {
    for (let i = 0; i < count; i++) nameOfVoicing[v++] = nameIndex;
  });
  return voicingCount;
}

export function chordCount() {
  return voicingCount;
}

// A voicing by its position in the code book.
export function chordAt(index) {
  const positions = [];
  for (let s = 0; s < 6; s++) {
    positions.push(FRET_DIGITS.indexOf(frets[index * 6 + s]) - 1);
  }
  const midi = [];
  positions.forEach((fret, s) => {
    if (fret >= 0) midi.push(OPEN_STRINGS[s] + fret);
  });
  const name = names[nameOfVoicing[index]];
  return { index, name, frets: positions, midi, ...harmony(name) };
}

function pitchClass(note) {
  return (PITCH_CLASS[note[0]] + (note[1] === "#" ? 1 : note[1] === "b" ? -1 : 0) + 12) % 12;
}

// What a bass player needs from a chord name such as "C#m7b5/G": the root,
// the note in the bass (the one after the slash, else the root), and how
// far above the root the chord's fifth sits. All as pitch classes, C = 0.
function harmony(name) {
  const [, root, quality, slash] = name.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  const fifth = /bb5/.test(quality) ? 5 : /dim|b5/.test(quality) ? 6 : /aug|#5/.test(quality) ? 8 : 7;
  return { root: pitchClass(root), bass: pitchClass(slash || root), fifth };
}

// Three code book indices for a point: its address number on the chosen
// grid, written in base `voicingCount`. (Both grids' numbers fit inside
// 167,011^3.)
export function codeFor(lat, lng, grid = "h3") {
  const n = GRIDS[grid].number(lat, lng);
  const N = voicingCount;
  return [Math.floor(n / (N * N)), Math.floor(n / N) % N, n % N];
}

export function chordsFor(lat, lng, grid = "h3") {
  return codeFor(lat, lng, grid).map(chordAt);
}
