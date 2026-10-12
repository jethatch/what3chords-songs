// The grids a place can be addressed on. Each divides the globe into cells
// at a range of sizes, and each turns its finest cell into one number, which
// the chord code book then reads as three chords.
//
//   h3 - Uber's hexagons. This is the original what3chords address: a place
//        has the same chords here as on the original site.
//   a5 - Felix Palmer's equal-area pentagons. A second address system made
//        for this page; the same place gets three different chords.
//
// Points are [lat, lng]; cell outlines are GeoJSON-style [lng, lat] rings.

// The original's permutation of the 15 base-7 H3 digits (SEVENS_FWD), which
// deals the digits out coarse, middling, fine, coarse, middling, fine... so
// that neighbouring cells don't share most of their chords.
const H3_SCRAMBLE = [0, 5, 10, 1, 6, 11, 2, 7, 12, 3, 8, 13, 4, 9, 14];
const H3_ADDRESS_RES = 15;

// A5 gets the same deal for its 22 base-4 digits: every third digit first.
const A5_ADDRESS_RES = 23;
const A5_DIGITS = A5_ADDRESS_RES - 1;
const A5_SCRAMBLE = new Array(A5_DIGITS);
let position = 0;
for (let third = 0; third < 3; third++) {
  for (let i = third; i < A5_DIGITS; i += 3) A5_SCRAMBLE[i] = position++;
}
// 60 x 4^22 pentagons reach only the first quarter of the 167,011^3 chord
// triples, which would leave every first chord in the C family. Multiplying
// by four spreads the addresses over nearly the whole code book.
const A5_SPREAD = 4;

const h3Grid = {
  id: "h3",
  name: "Hexagons (H3)",
  cell: "hexagon",
  cells: "hexagons",
  walk: "Hex walk",
  maxRes: H3_ADDRESS_RES,
  // Cell sizes for a live session: on foot, on a bike, driving in town, driving.
  liveRes: [11, 10, 9, 8],
  explain: "The original what3chords addresses, on Uber’s H3 hexagons (about 0.9 m² each at the finest level). A place has the same three chords here as on the original site.",

  cellAt: (lat, lng, res) => h3.latLngToCell(lat, lng, res),
  centre: (cell) => h3.cellToLatLng(cell),
  boundary: (cell) => h3.cellToBoundary(cell, true),
  neighbours: (cell) => h3.gridDisk(cell, 1).filter((other) => other !== cell),
  // Centre-to-centre distance between neighbouring cells.
  spacingKm: (res) => Math.sqrt(3) * h3.getHexagonEdgeLengthAvg(res, "km"),
  // Used only if a greedy walk gets stuck, which can happen where the grid
  // is distorted around one of its twelve pentagons.
  lineTo(from, to) {
    try {
      return h3.gridPathCells(from, to).slice(1);
    } catch (error) {
      return [to];
    }
  },

  // Base cell, then its 15 shuffled base-7 digits, as one number
  // (h3ToDecimal in the original).
  number(lat, lng) {
    const bits = BigInt("0x" + h3.latLngToCell(lat, lng, H3_ADDRESS_RES));
    const baseCell = Number((bits >> 45n) & 0x7fn);
    const digits = new Array(H3_ADDRESS_RES);
    for (let res = 0; res < H3_ADDRESS_RES; res++) {
      const digit = Number((bits >> BigInt(3 * (H3_ADDRESS_RES - 1 - res))) & 7n);
      digits[H3_SCRAMBLE[res]] = digit;
    }
    let n = baseCell;
    for (const digit of digits) n = n * 7 + digit;
    return n;
  },
};

const a5Grid = {
  id: "a5",
  name: "Pentagons (A5)",
  cell: "pentagon",
  cells: "pentagons",
  walk: "Pentagon walk",
  // A5 itself goes finer, but cells smaller than the ones that carry the
  // chords would all sound the same.
  maxRes: A5_ADDRESS_RES,
  liveRes: [17, 15, 14, 13],
  explain: "A second address system, made for this page, on the A5 grid of equal-area pentagons (about 0.5 m² each at the level used). The same place gets three different chords, and neither set is the right one.",

  cellAt: (lat, lng, res) => A5.lonLatToCell([lng, lat], res),
  centre(cell) {
    const [lng, lat] = A5.cellToLonLat(cell);
    return [lat, lng];
  },
  boundary: (cell) => A5.cellToBoundary(cell, { closedRing: true }),
  neighbours: (cell) => [...A5.uncompact(A5.gridDisk(cell, 1), A5.getResolution(cell))].filter((other) => other !== cell),
  spacingKm: (res) => Math.sqrt(A5.cellArea(res)) / 1000,
  lineTo: (from, to) => [to],

  // An A5 cell ID is: which of 60 fifths-of-a-face the cell is in, then two
  // bits per level for its place along a space-filling curve, then a single
  // 1 bit marking where the ID ends. Strip the marker, shuffle the curve
  // digits, and read the result as one number.
  number(lat, lng) {
    const id = A5.lonLatToCell([lng, lat], A5_ADDRESS_RES);
    const marker = id & -id;
    const payload = id / (marker << 1n);
    const fifth = Number(payload >> BigInt(2 * A5_DIGITS));
    const digits = new Array(A5_DIGITS);
    for (let i = 0; i < A5_DIGITS; i++) {
      const digit = Number((payload >> BigInt(2 * (A5_DIGITS - 1 - i))) & 3n);
      digits[A5_SCRAMBLE[i]] = digit;
    }
    let n = fifth;
    for (const digit of digits) n = n * 4 + digit;
    return n * A5_SPREAD;
  },
};

export const GRIDS = { h3: h3Grid, a5: a5Grid };
