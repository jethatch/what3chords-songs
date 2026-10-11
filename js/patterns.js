// What the band plays: strum patterns for the guitar, and for each one a
// drum groove and a bass line that fit it. Everything is written on a grid
// of eighth notes (grid 8) or sixteenths (grid 16), one bar long.
//
// Guitar tokens, space separated:
//   D / d  down strum, accented / soft      U / u  up strum, accented / soft
//   c      short choppy down strum          x      muted scratch
//   B      bass string alone                1-4    one string, counted from the highest
//   -      nothing (let it ring)
//
// Drum grooves are one string per voice, one character per grid step:
//   k kick   s snare   h closed hi-hat   o open hi-hat   r rim click
//   X accented hit   x hit   . ghost note   - nothing
//
// Bass lines, one character per grid step:
//   R the chord's bass note   r the same, softer   5 its fifth   8 an octave up
//   - nothing (hold)

const rock44 = { grid: 8, k: "x--xx---", s: "--x---x-", h: "xxxxxxxx" };
const punk44 = { grid: 8, k: "x---x-x-", s: "--X---X-", h: "XxXxXxXx" };
const soft44 = { grid: 8, k: "x---x---", r: "--x---x-", h: "x.x.x.x." };

export const PATTERNS = {
  "4/4": [
    { id: "ramones", name: "Ramones (the original)", grid: 8, steps: "D U D U D - D -", drums: punk44, bass: "RrRrRrRr" },
    { id: "downstrokes", name: "Punk downstrokes", grid: 8, steps: "D d D d D d D d", drums: { grid: 8, k: "x-x-x-x-", s: "--X---X-", h: "xxxxxxxx" }, bass: "RRRRRRRR" },
    { id: "campfire", name: "Campfire", grid: 8, steps: "D - D U - U D U", drums: rock44, bass: "R--r5--5" },
    { id: "doubletime", name: "Double-time", grid: 16, steps: "D - D U - U D U D - D U - U D U", drums: { grid: 8, k: "x-x-x-x-", s: "-x-x-x-x", h: "xxxxxxxx" }, bass: "R5R5R5R5" },
    { id: "reggae", name: "Reggae chop", grid: 8, steps: "- - c - - - c -", drums: { grid: 8, k: "----x---", r: "----x---", h: "x.x.x.x." }, bass: "R--R-5--" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 3 1 3 2 3", drums: soft44, bass: "R---5---" },
    { id: "ring", name: "Let it ring", grid: 8, steps: "D - - - - - - -", drums: { grid: 8, k: "x-------", s: "----x---", h: "x-x-x-x-" }, bass: "R-------" },
  ],
  "3/4": [
    { id: "waltz", name: "Waltz (oom-pah-pah)", grid: 8, steps: "B - d - d -", drums: { grid: 8, k: "x-----", r: "--x-x-" }, bass: "R-----" },
    { id: "folk", name: "Folk strum", grid: 8, steps: "D - D U D U", drums: { grid: 8, k: "x-----", r: "--x-x-", h: "xxxxxx" }, bass: "R---5-" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 1 2 3", drums: { grid: 8, k: "x-----", h: "--x-x-" }, bass: "R-----" },
    { id: "ring", name: "Let it ring", grid: 8, steps: "D - - - - -", drums: { grid: 8, k: "x-----", h: "x-x-x-" }, bass: "R-----" },
  ],
  "6/8": [
    { id: "rolling", name: "Rolling", grid: 8, steps: "D d u D d u", drums: { grid: 8, k: "x----x", s: "---x--", h: "xxxxxx" }, bass: "R--5--" },
    { id: "sway", name: "Slow sway", grid: 8, steps: "D - u D - u", drums: { grid: 8, k: "x-----", s: "---x--", h: "x-xx-x" }, bass: "R--5--" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 1 2 3", drums: { grid: 8, k: "x-----", r: "---x--" }, bass: "R-----" },
    { id: "ring", name: "Let it ring", grid: 8, steps: "D - - d - -", drums: { grid: 8, k: "x-----", s: "---x--", h: "x--x--" }, bass: "R--r--" },
  ],
  "2/4": [
    { id: "boomchick", name: "Boom-chick", grid: 8, steps: "B - c -", drums: { grid: 8, k: "x---", r: "--x-" }, bass: "R-5-" },
    { id: "gallop", name: "Gallop", grid: 16, steps: "D - d u D - d u", drums: { grid: 16, k: "x---x---", s: "--x---x-", h: "x-xxx-xx" }, bass: "R-rrR-rr" },
    { id: "downstrokes", name: "Punk downstrokes", grid: 8, steps: "D d D d", drums: { grid: 8, k: "x-x-", s: "-x-x", h: "xxxx" }, bass: "RRRR" },
  ],
  "5/4": [
    { id: "takefive", name: "Take five", grid: 8, steps: "D - - U - - D - D -", drums: { grid: 8, k: "x-----x---", r: "----x---x-", h: "x-xxx-x-x-" }, bass: "R--R--5-5-" },
    { id: "downstrokes", name: "Downstrokes (3+2)", grid: 8, steps: "D d d d d d D d d d", drums: { grid: 8, k: "x-x---x---", s: "----X---X-", h: "xxxxxxxxxx" }, bass: "RrrrrrRrrr" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 3 2 1 2 3 B 2 1 2", drums: { grid: 8, k: "x-----x---", r: "----x---x-" }, bass: "R-----5---" },
  ],
  "7/8": [
    { id: "twotwothree", name: "2 + 2 + 3", grid: 8, steps: "D u D u D d u", drums: { grid: 8, k: "x---x--", s: "--x---x", h: "xxxxxxx" }, bass: "R-5-R--" },
    { id: "downstrokes", name: "Downstrokes", grid: 8, steps: "D d D d D d d", drums: { grid: 8, k: "x--xx--", s: "--X---X", h: "XxXxXxx" }, bass: "RrRrRrr" },
    { id: "arpeggio", name: "Fingerpicked", grid: 8, steps: "B 2 B 2 B 2 1", drums: { grid: 8, k: "x---x--", r: "--x---x" }, bass: "R---5--" },
  ],
};
export const SIGNATURES = Object.keys(PATTERNS);

// Drum styles that replace the groove a strum pattern comes with.
export const DRUM_STYLES = [
  { id: "match", name: "Match the strum" },
  { id: "rock", name: "Rock" },
  { id: "punk", name: "Punk" },
  { id: "half", name: "Half-time" },
  { id: "soft", name: "Soft (rim and hats)" },
];

const STYLE_GROOVES = {
  "4/4": {
    rock: rock44,
    punk: punk44,
    half: { grid: 8, k: "x-----x-", s: "----X---", h: "x-x-x-x-" },
    soft: soft44,
  },
  "3/4": {
    rock: { grid: 8, k: "x-----", s: "--x-x-", h: "xxxxxx" },
    punk: { grid: 8, k: "x--x--", s: "--X-X-", h: "XxXxXx" },
    half: { grid: 8, k: "x-----", s: "----X-", h: "x-x-x-" },
    soft: { grid: 8, k: "x-----", r: "--x-x-", h: "x.x.x." },
  },
  "6/8": {
    rock: { grid: 8, k: "x----x", s: "---x--", h: "xxxxxx" },
    punk: { grid: 8, k: "x-x---", s: "---X--", h: "XxxXxx" },
    half: { grid: 8, k: "x-----", s: "---X--", h: "x--x--" },
    soft: { grid: 8, k: "x-----", r: "---x--", h: "x..x.." },
  },
  "2/4": {
    rock: { grid: 8, k: "x---", s: "--x-", h: "xxxx" },
    punk: { grid: 8, k: "x-x-", s: "-X-X", h: "xxxx" },
    half: { grid: 8, k: "x---", r: "--x-", h: "x-x-" },
    soft: { grid: 8, k: "x---", r: "--x-", h: "x.x." },
  },
  "5/4": {
    rock: { grid: 8, k: "x-----x---", s: "----x---x-", h: "xxxxxxxxxx" },
    punk: { grid: 8, k: "x-x---x---", s: "----X---X-", h: "XxXxXxXxXx" },
    half: { grid: 8, k: "x---------", s: "------X---", h: "x-x-x-x-x-" },
    soft: { grid: 8, k: "x-----x---", r: "----x---x-", h: "x.x.x.x.x." },
  },
  "7/8": {
    rock: { grid: 8, k: "x---x--", s: "--x---x", h: "xxxxxxx" },
    punk: { grid: 8, k: "x--xx--", s: "--X---X", h: "XxXxXxx" },
    half: { grid: 8, k: "x------", s: "----X--", h: "x-x-x-x" },
    soft: { grid: 8, k: "x---x--", r: "--x---x", h: "x.x.x.." },
  },
};

// One-click combinations of everything in the sound section. Picking one
// sets all of these; changing any of them by hand makes the style "Custom".
export const STYLES = [
  { id: "original", name: "Solo electric (the original)", signature: "4/4", pattern: "ramones", guitar: "electric", drums: false, drumStyle: "match", bass: false, bpm: 120 },
  { id: "punk", name: "Punk trio", signature: "4/4", pattern: "downstrokes", guitar: "crunch", drums: true, drumStyle: "match", bass: true, bpm: 176 },
  { id: "campfire", name: "Campfire acoustic", signature: "4/4", pattern: "campfire", guitar: "acoustic", drums: false, drumStyle: "match", bass: false, bpm: 104 },
  { id: "folkrock", name: "Folk-rock band", signature: "4/4", pattern: "campfire", guitar: "acoustic12", drums: true, drumStyle: "match", bass: true, bpm: 112 },
  { id: "reggae", name: "Reggae", signature: "4/4", pattern: "reggae", guitar: "electric", drums: true, drumStyle: "match", bass: true, bpm: 84 },
  { id: "waltz", name: "Waltz", signature: "3/4", pattern: "waltz", guitar: "nylon", drums: true, drumStyle: "match", bass: true, bpm: 132 },
  { id: "slowsix", name: "Slow 6/8", signature: "6/8", pattern: "sway", guitar: "chorus", drums: true, drumStyle: "match", bass: true, bpm: 150 },
  { id: "fingerpicked", name: "Solo fingerpicked", signature: "4/4", pattern: "arpeggio", guitar: "nylon", drums: false, drumStyle: "match", bass: false, bpm: 92 },
];

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

export function drumGroove(signature, pattern, style) {
  return (style !== "match" && STYLE_GROOVES[signature][style]) || pattern.drums;
}

// Spread grid steps over sixteenth slots: a value where something is
// played, null in between.
function toSlots(steps, grid, rest) {
  const stride = 16 / grid;
  const slots = [];
  for (const step of steps) {
    slots.push(step === rest ? null : step);
    for (let i = 1; i < stride; i++) slots.push(null);
  }
  return slots;
}

export function guitarSlots(pattern) {
  return toSlots(patternTokens(pattern), pattern.grid, "-");
}

// { k: [...], s: [...], ... } with one entry per sixteenth slot.
export function drumSlots(groove) {
  const voices = {};
  for (const voice of ["k", "s", "h", "o", "r"]) {
    if (groove[voice]) voices[voice] = toSlots([...groove[voice]], groove.grid, "-");
  }
  return voices;
}

// Bass lines are written on the same grid as their strum pattern, except
// that sixteenth-grid strums keep an eighth-note bass.
export function bassSlots(pattern) {
  const steps = [...pattern.bass];
  return toSlots(steps, steps.length === patternTokens(pattern).length ? pattern.grid : 8, "-");
}
