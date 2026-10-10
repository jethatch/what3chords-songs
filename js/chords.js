// The what3chords code book: every ~1 m² H3 cell on Earth maps to three
// guitar chord voicings. This is a port of the original scheme from
// https://github.com/DOSull/what3chords so that a place gets the same three
// chords here as it does there.

const H3_RES = 15;
// Permutation of the 15 base-7 H3 digits, so that neighbouring cells don't
// share most of their chords (SEVENS_FWD in the original).
const DIGIT_SCRAMBLE = [0, 5, 10, 1, 6, 11, 2, 7, 12, 3, 8, 13, 4, 9, 14];
// Standard tuning, low E to high E.
const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
const FRET_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

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
  return { index, name: names[nameOfVoicing[index]], frets: positions, midi };
}

// The H3 cell as one number: base cell, then its 15 (scrambled) base-7 digits.
function cellToNumber(cell) {
  const bits = BigInt("0x" + cell);
  const baseCell = Number((bits >> 45n) & 0x7fn);
  const digits = new Array(H3_RES);
  for (let res = 0; res < H3_RES; res++) {
    const digit = Number((bits >> BigInt(3 * (H3_RES - 1 - res))) & 7n);
    digits[DIGIT_SCRAMBLE[res]] = digit;
  }
  let n = baseCell;
  for (const digit of digits) n = n * 7 + digit;
  return n;
}

// Three code book indices for a point: the cell number written in base
// `voicingCount`. (122 x 7^15 cells fit comfortably inside 167,011^3.)
export function codeFor(lat, lng) {
  const n = cellToNumber(h3.latLngToCell(lat, lng, H3_RES));
  const N = voicingCount;
  return [Math.floor(n / (N * N)), Math.floor(n / N) % N, n % N];
}

export function chordsFor(lat, lng) {
  return codeFor(lat, lng).map(chordAt);
}
