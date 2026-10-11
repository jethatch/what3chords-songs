# what3chords songs

Every square metre of Earth is three guitar chords. Pick two places and play the trip between them.

> **This is a recreation based on the original [what3chords](https://github.com/DOSull/what3chords)** by David O'Sullivan, Luke Bergmann, Jim Thatcher and Nick Lally. The idea, the place-to-chords scheme, the chord table and the guitar samples come from that project. Licensing for this repository and the material it takes from the original is under discussion with the original authors; until that is settled, no licence is granted for reuse.

"This is a chord. This is another. This is a third. Now form a band." The original lets you click the map and hear that spot's three chords. This version keeps that, and adds journeys:

- **Start and end by name.** Type "Boston, MA" and a pin drops there. Place search uses [Nominatim](https://nominatim.org/) with [Photon](https://photon.komoot.io/) as a fallback; neither needs a key. You can also type `lat, lng`, click the map, or drag the pins.
- **A route made of hexagons.** *Hex walk* is greedy local routing over the [H3](https://h3geo.org/) grid, computed in the browser: from each hexagon, step to the neighbour nearest the destination. *Follow roads* asks the public [OSRM](https://project-osrm.org/) demo server for a driving route and collects the hexagons along it, falling back to the hex walk when there is no road or no server. The hexagon size is chosen so the trip has a sensible number of stops (short, medium or long).
- **A song.** Press play and a marker travels the route while a strummed guitar plays each stop's chords. Choose the time signature (4/4, 3/4, 6/8, 2/4, 5/4, 7/8), tempo, strum pattern, and whether each stop plays all three of its chords or just one. Changes take effect at the next bar line.
- **A band.** A Style menu sets up a whole sound in one go (punk trio, campfire acoustic, reggae, waltz and so on). Underneath it you can pick the guitar (electric clean, crunch, fuzz, chorus or 12-string; steel-string, 12-string or nylon acoustic), switch on drums and bass that follow the strum pattern, choose a different drum style, and balance the three.
- **Sharing.** The page address carries the trip and every sound setting, and the share button copies it. Opening a shared link shows a "Play this song" prompt, because browsers won't start audio without a click. The download button renders the song to a WAV file.
- **Live sessions.** "Go live" follows the device's location: the hexagon you are in loops its three chords, and the chords change as you move into the next. Hexagons are about 50 m across on foot and grow with speed. Ending the session leaves the route as a trip you can replay or share, and offers what you heard as a download. The page keeps the screen awake while a session runs, because a web page cannot play from a locked phone. The route and recording last only until the page is closed. The page itself sends your location nowhere; the map does load tiles for wherever you are from CARTO, and a link to the route is made only if you choose to share it.

Most of the options are folded away. The page opens with start, end, style, time signature and tempo; route, rhythm and band details expand when wanted.

## Run it

It is a static site with no build step.

```bash
python3 -m http.server 8766
```

Then open <http://localhost:8766>. (Opening `index.html` straight from disk won't work; browsers block module scripts and `fetch` on `file://`.)

## Put it on GitHub Pages

Push this folder to a repository, then in **Settings → Pages** choose **Deploy from a branch**, the `main` branch and the `/ (root)` folder. All paths are relative, so it works at `https://<user>.github.io/<repo>/`.

One thing is tied to the address: the link-preview tags in `index.html` (`og:url`, `og:image`) must be absolute, so they name `https://jethatch.github.io/what3chords-songs/`. Change them if the site moves. Live sessions need https, which GitHub Pages provides.

## What a link contains

Everything is in the part after `#`, so nothing is sent to a server.

| Key | Meaning |
|---|---|
| `a`, `b`, `an`, `bn` | start and end as `lat,lng`, and their labels |
| `m`, `l` | route mode (`road`) and song length (`short`, `long`) |
| `lv`, `lr` | a recorded route instead of start and end: encoded points, and hexagon sizes |
| `ts`, `p`, `bpm`, `c` | time signature (`3-4`), strum pattern, tempo, chords per stop (`1`) |
| `g`, `d`, `bs` | guitar, drums (`1` or a drum style), bass (`1`) |

Defaults are left out. A road-mode link asks the routing server again when opened, so its song can change if the road data does; hex-walk and recorded-route links always rebuild exactly.

## How a place becomes three chords

Unchanged from the original, so a spot has the same chords here as there:

1. Find the resolution-15 H3 cell (about 0.9 m²) containing the point.
2. Take its base cell and 15 base-7 digits, shuffle the digits with a fixed permutation, and read the result as one number.
3. Write that number in base 167,011, the number of voicings in the chord code book. The three digits index three chords.

For a route stop, the point used is the pin itself (first and last stop of a planned trip), the hexagon's centre (hex walk, live sessions and recorded routes), or the middle of the road's passage through the hexagon (roads). Because live sessions use centres, a hexagon plays the same chords whoever enters it and from whichever side, and a shared live route reveals which hexagons were visited rather than exact positions.

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
js/routing.js    hex walk, road route, recorded paths, track geometry
js/geocode.js    place search
js/patterns.js   strum patterns, drum grooves, bass lines, styles
js/band.js       sampled guitars and bass, synthesised drums, mixer
js/audio.js      the player, offline rendering to WAV, live recording
js/live.js       live sessions: location -> stops
js/link.js       trip and settings <-> URL hash
js/diagram.js    chord box SVGs
data/chords.json packed chord code book
audio/           guitar and bass samples
img/preview.png  image for link previews
tools/           data packing script
```

Libraries (MapLibre GL JS, h3-js, Tone.js) load from jsDelivr at pinned versions.

## Licence

Under discussion with the authors of the original what3chords. Neither that repository nor this one carries a licence yet, so please ask before reusing the code, the chord table (`data/chords.json`) or the electric guitar samples (`audio/guitar-electric/`). The libraries this page loads keep their own licences: MapLibre GL JS (BSD-3-Clause), h3-js (Apache-2.0) and Tone.js (MIT).

The other samples have known terms and are not part of that discussion:

| Folder | Source | Terms |
|---|---|---|
| `audio/guitar-acoustic/` | [University of Iowa Electronic Music Studios](https://theremin.music.uiowa.edu/MIS.html) | free to use without restriction |
| `audio/guitar-nylon/` | [quartertone, "classicalguitar-multisampled"](https://freesound.org/people/quartertone/packs/11573/) on Freesound | CC BY 4.0 |
| `audio/bass-electric/` | [Karoryfer Samples](https://www.karoryfer.com/karoryfer-samples) | CC0 |

All three were taken from the [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) collection by Nicholaus Brosowsky, which offers its edited samples under CC BY 3.0. Here a subset of notes was trimmed to a few seconds, faded and re-encoded as mono MP3.

## Services and credits

- Concept, place-to-chords scheme, chord code book and electric guitar samples: the original [what3chords](https://github.com/DOSull/what3chords) by David O'Sullivan, Luke Bergmann, Jim Thatcher and Nick Lally.
- Place search: Nominatim (OpenStreetMap Foundation) and Photon (Komoot). Both are free shared services with usage policies; this page only searches when you press Find or leave the field.
- Road routes: the OSRM demo server, which is offered without uptime guarantees and is not meant for heavy use.
- Basemap: © CARTO, map data © OpenStreetMap contributors.
