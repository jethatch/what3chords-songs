// Chord box diagrams as inline SVG. Colours come from CSS (currentColor and
// the .cd-* classes) so the diagrams follow the page theme.

const STRING_GAP = 12;
const FRET_GAP = 15;
const LEFT = 18;
const TOP = 16;

// The first fret shown, and how many frets the box needs.
function layout(frets) {
  const stopped = frets.filter((f) => f > 0);
  if (!stopped.length) return { base: 1, rows: 4 };
  const lo = Math.min(...stopped);
  const hi = Math.max(...stopped);
  const base = hi <= 4 ? 1 : lo;
  return { base, rows: Math.max(4, hi - base + 1) };
}

// A barre is drawn when the lowest stopped fret is held on three or more
// strings with nothing open or muted between them.
function findBarre(frets) {
  const stopped = frets.filter((f) => f > 0);
  if (stopped.length < 3) return null;
  const lo = Math.min(...stopped);
  const first = frets.indexOf(lo);
  const last = frets.lastIndexOf(lo);
  if (frets.filter((f) => f === lo).length < 3) return null;
  for (let s = first; s <= last; s++) if (frets[s] < lo) return null;
  return { fret: lo, first, last };
}

export function chordDiagram(chord) {
  const { base, rows } = layout(chord.frets);
  const width = LEFT + STRING_GAP * 5 + 12;
  const height = TOP + FRET_GAP * rows + 6;
  const x = (s) => LEFT + s * STRING_GAP;
  const y = (row) => TOP + row * FRET_GAP;
  const parts = [];

  for (let row = 0; row <= rows; row++) {
    parts.push(`<line class="cd-fret" x1="${x(0)}" y1="${y(row)}" x2="${x(5)}" y2="${y(row)}"/>`);
  }
  for (let s = 0; s < 6; s++) {
    parts.push(`<line class="cd-string" x1="${x(s)}" y1="${y(0)}" x2="${x(s)}" y2="${y(rows)}"/>`);
  }
  if (base === 1) {
    parts.push(`<rect class="cd-nut" x="${x(0) - 0.75}" y="${y(0) - 3}" width="${STRING_GAP * 5 + 1.5}" height="3.5"/>`);
  } else {
    parts.push(`<text class="cd-base" x="${x(0) - 6}" y="${y(0) + FRET_GAP / 2 + 3}" text-anchor="end">${base}</text>`);
  }

  const barre = findBarre(chord.frets);
  if (barre) {
    const cy = y(barre.fret - base) + FRET_GAP / 2;
    parts.push(`<rect class="cd-dot" x="${x(barre.first) - 4.5}" y="${cy - 4.5}" width="${(barre.last - barre.first) * STRING_GAP + 9}" height="9" rx="4.5"/>`);
  }
  chord.frets.forEach((fret, s) => {
    if (fret < 0) {
      parts.push(`<text class="cd-mark" x="${x(s)}" y="${y(0) - 6}" text-anchor="middle">×</text>`);
    } else if (fret === 0) {
      parts.push(`<circle class="cd-open" cx="${x(s)}" cy="${y(0) - 9}" r="3"/>`);
    } else if (!(barre && fret === barre.fret)) {
      parts.push(`<circle class="cd-dot" cx="${x(s)}" cy="${y(fret - base) + FRET_GAP / 2}" r="4.5"/>`);
    }
  });

  const shape = chord.frets.map((f) => (f < 0 ? "x" : f)).join(" ");
  return `<svg class="chord-diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="${chord.name}, strings low to high: ${shape}">${parts.join("")}</svg>`;
}
