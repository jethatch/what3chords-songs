# what3chords songs

Every square metre of Earth is three guitar chords. Pick two places and play the trip between them.

> **This is a recreation based on the original [what3chords](https://github.com/DOSull/what3chords)** by David O'Sullivan, Luke Bergmann, Jim Thatcher and Nick Lally. The idea, the place-to-chords scheme, the chord table and the guitar samples come from that project. Licensing for this repository and the material it takes from the original is under discussion with the original authors; until that is settled, no licence is granted for reuse.

"This is a chord. This is another. This is a third. Now form a band." The original lets you click the map and hear that spot's three chords. This version keeps that, and adds journeys:

- **Start and end by name.** Type "Boston, MA" and a pin drops there. Place search uses [Nominatim](https://nominatim.org/) with [Photon](https://photon.komoot.io/) as a fallback; neither needs a key. You can also type `lat, lng`, click the map, or drag the pins.
- **A route made of hexagons.** *Hex walk* is greedy local routing over the [H3](https://h3geo.org/) grid, computed in the browser: from each hexagon, step to the neighbour nearest the destination. *Follow roads* asks the public [OSRM](https://project-osrm.org/) demo server for a driving route and collects the hexagons along it, falling back to the hex walk when there is no road or no server. The hexagon size is chosen so the trip has a sensible number of stops (short, medium or long).
- **A song.** Press play and a marker travels the route while a strummed guitar plays each stop's chords. Choose the time signature (4/4, 3/4, 6/8, 2/4, 5/4, 7/8), tempo, strum pattern, and whether each stop plays all three of its chords or just one. Rhythm changes take effect at the next bar line.

The page address updates as you go, so a trip and its settings can be shared as a link.

## Run it

It is a static site with no build step.

```bash
python3 -m http.server 8766
```

Then open <http://localhost:8766>. (Opening `index.html` straight from disk won't work; browsers block module scripts and `fetch` on `file://`.)

## Put it on GitHub Pages

Push this folder to a repository, then in **Settings → Pages** choose **Deploy from a branch**, the `main` branch and the `/ (root)` folder. All paths are relative, so it works at `https://<user>.github.io/<repo>/`.

## How a place becomes three chords

Unchanged from the original, so a spot has the same chords here as there:

1. Find the resolution-15 H3 cell (about 0.9 m²) containing the point.
2. Take its base cell and 15 base-7 digits, shuffle the digits with a fixed permutation, and read the result as one number.
3. Write that number in base 167,011, the number of voicings in the chord code book. The three digits index three chords.

For a route stop, the point used is the pin itself (first and last stop), the hexagon's centre (hex walk) or the middle of the road's passage through the hexagon (roads).

## Differences from the original

- MapLibre GL replaces Mapbox GL and deck.gl; jQuery and svguitar are gone. No API keys anywhere.
- The chord table is repacked from 5.4 MB to 1.2 MB (`tools/build_chords.py`), keeping the order, which is the code book.
- Chords now sound as drawn. The original reversed each voicing's strings before adding the open-string pitches, and mapped the samples two octaves away from their names, so what you heard was a mirror image of the diagram.
- The handful of cells whose number has fewer than three base-167,011 digits no longer crash; they get leading zeros.

## Layout

```
index.html
css/style.css
js/app.js        UI, map, playhead
js/chords.js     place -> three chords
js/routing.js    hex walk, road route, track geometry
js/geocode.js    place search
js/audio.js      strum patterns and the player
js/diagram.js    chord box SVGs
data/chords.json packed chord code book
audio/           guitar samples
tools/           data packing script
```

Libraries (MapLibre GL JS, h3-js, Tone.js) load from jsDelivr at pinned versions.

## Licence

Under discussion with the authors of the original what3chords. Neither that repository nor this one carries a licence yet, so please ask before reusing the code, the chord table (`data/chords.json`) or the guitar samples (`audio/`). The libraries this page loads keep their own licences: MapLibre GL JS (BSD-3-Clause), h3-js (Apache-2.0) and Tone.js (MIT).

## Services and credits

- Concept, place-to-chords scheme, chord code book and guitar samples: the original [what3chords](https://github.com/DOSull/what3chords) by David O'Sullivan, Luke Bergmann, Jim Thatcher and Nick Lally.
- Place search: Nominatim (OpenStreetMap Foundation) and Photon (Komoot). Both are free shared services with usage policies; this page only searches when you press Find or leave the field.
- Road routes: the OSRM demo server, which is offered without uptime guarantees and is not meant for heavy use.
- Basemap: © CARTO, map data © OpenStreetMap contributors.
