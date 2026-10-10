#!/usr/bin/env python3
"""Pack the original what3chords chord table into a compact file.

The upstream app (https://github.com/DOSull/what3chords) ships
`data/chords-compressed.json`: {chord name: [{"positions": [6 frets]}, ...]}.
That is 5.4 MB for 167,011 voicings. The order of the voicings *is* the
what3chords code book, so it must be preserved exactly.

Output (`data/chords.json`, ~1.2 MB before gzip):
  names  - chord names in upstream order
  counts - number of voicings for each name
  frets  - one character per string, six per voicing, low E -> high E,
           base-36 of (fret + 1); so "0" is a muted string and "1" is open.

Usage: python3 tools/build_chords.py path/to/chords-compressed.json data/chords.json
"""
import json
import sys

DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def main(src, dst):
    with open(src) as f:
        chords = json.load(f)
    names, counts, frets = [], [], []
    for name, variants in chords.items():
        names.append(name)
        counts.append(len(variants))
        for variant in variants:
            positions = variant["positions"]
            assert len(positions) == 6 and all(-1 <= p < 35 for p in positions)
            frets.append("".join(DIGITS[p + 1] for p in positions))
    with open(dst, "w") as f:
        json.dump({"names": names, "counts": counts, "frets": "".join(frets)},
                  f, separators=(",", ":"))
    print(f"{len(names)} names, {sum(counts)} voicings -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
