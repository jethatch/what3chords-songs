import { loadChords, chordsFor } from "./chords.js";
import { chordDiagram } from "./diagram.js";
import { geocode, formatLatLng } from "./geocode.js";
import {
  buildHexRoute, buildRoadRoute, RoutingError, hexSpacingKm, pointAt, trackUpTo,
  stopsToGeoJSON, wrapLng,
} from "./routing.js";
import {
  Player, PATTERNS, SIGNATURES, findPattern, patternTokens, gridLabels, slotsPerBar, songSeconds,
} from "./audio.js";

const BASEMAPS = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};
// Route colours live here rather than in CSS because the map is drawn on a canvas.
const MAP_COLOURS = {
  dark: { hex: "#ffe14d", played: "#ff4d8d", current: "#ffe14d", track: "rgba(255,255,255,0.55)", casing: "#0d0d0f" },
  light: { hex: "#17160f", played: "#d6004f", current: "#ffd60a", track: "rgba(23,22,15,0.5)", casing: "#fffdf8" },
};
const LENGTHS = {
  short: { stops: 10, explain: "About 10 stops at most. Big hexagons, a quick sketch of the trip." },
  medium: { stops: 28, explain: "About 28 stops at most. A proper song." },
  long: { stops: 75, explain: "About 75 stops at most. Small hexagons, the album version." },
};
const MODE_EXPLAIN = {
  hex: "Greedy local routing: from each hexagon, step to whichever neighbour is nearest the destination. Worked out in your browser, and it ignores roads, rivers and oceans.",
  road: "Asks the public OSRM server for a driving route and plays the hexagons it passes through. If no road connects the two places, or either pin is far from any road, you get the hex walk instead.",
};
const PER_STOP_EXPLAIN = {
  3: "Every stop plays all three of its chords, one bar each: the full what3chords address of each place you pass. Three bars per stop.",
  1: "Every stop plays one bar. Stops take turns: one plays its 1st chord, the next its 2nd, the next its 3rd, then round again, so the trip moves three times as fast.",
};
const GLYPHS = { D: "↓", d: "↓", U: "↑", u: "↑", c: "⇣", x: "×", B: "●", "-": "·" };
const TOKEN_WORDS = {
  D: "down", d: "soft down", U: "up", u: "soft up", c: "chop", x: "mute", B: "bass", "-": "rest",
  1: "string 1", 2: "string 2", 3: "string 3", 4: "string 4",
};

// What each glyph in the strum display means, in the order they're listed.
const LEGEND = [
  ["↓", /[Dd]/, "down"],
  ["↑", /[Uu]/, "up"],
  ["faint", /[du]/, "softer"],
  ["⇣", /c/, "short chop"],
  ["×", /x/, "muted"],
  ["●", /B/, "bass string"],
  ["1–4", /[1-4]/, "single string, counted from the highest"],
  ["·", /-/, "let it ring"],
];
const EXAMPLE = {
  start: { lat: 42.35883, lng: -71.05783, label: "Boston, Massachusetts" },
  end: { lat: 40.71273, lng: -74.00602, label: "New York, New York" },
};

const $ = (id) => document.getElementById(id);
const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const state = {
  start: null, // { lat, lng, label }
  end: null,
  mode: "hex",
  length: "medium",
  signature: "4/4",
  patternId: "ramones",
  bpm: 120,
  perStop: 3,
  volume: 0.8,
  route: null,
  routePending: false, // a road route has been asked for and isn't back yet
  cueStop: 0,
  playing: null, // null | "route" | "spot"
  finished: false,
};

const player = new Player();
let map;
let theme = document.documentElement.dataset.theme;
let routeRequest = 0;
let routeAbort = null;
let song = null;
let spot = null; // { popup, chords } for the last clicked point
const markers = { start: null, end: null, playhead: null };
const places = {
  start: { input: $("start-input"), status: $("start-status"), candidates: $("start-candidates"), form: $("start-form"), lastQuery: "", searching: null, abort: null },
  end: { input: $("end-input"), status: $("end-status"), candidates: $("end-candidates"), form: $("end-form"), lastQuery: "", searching: null, abort: null },
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatKm(km) {
  if (km >= 100) return `${Math.round(km).toLocaleString()} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  if (km >= 0.001) return `${Math.round(km * 1000)} m`;
  return `${Math.round(km * 100000)} cm`;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

// ---------------------------------------------------------------------------
// Shareable state in the URL hash
// ---------------------------------------------------------------------------

// Safari refuses more than ~100 history updates in 30 seconds, and a tempo
// slider can fire that many in one drag, so writes are collected.
let hashTimer;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(flushHash, 300);
}

function flushHash() {
  const params = new URLSearchParams();
  for (const [key, place] of [["a", state.start], ["b", state.end]]) {
    if (!place) continue;
    params.set(key, `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`);
    params.set(`${key}n`, place.label);
  }
  // Settings only appear once they differ from the defaults.
  if (state.mode !== "hex") params.set("m", state.mode);
  if (state.length !== "medium") params.set("l", state.length);
  if (state.signature !== "4/4") params.set("ts", state.signature.replace("/", "-"));
  if (state.patternId !== PATTERNS[state.signature][0].id) params.set("p", state.patternId);
  if (state.bpm !== 120) params.set("bpm", state.bpm);
  if (state.perStop !== 3) params.set("c", state.perStop);
  const hash = params.toString();
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`);
  } catch (error) {
    // The link just goes a little stale; nothing else depends on it.
  }
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [key, which] of [["a", "start"], ["b", "end"]]) {
    const match = (params.get(key) || "").match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (!match) continue;
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    state[which] = { lat, lng, label: (params.get(`${key}n`) || formatLatLng(lat, lng)).slice(0, 120) };
  }
  if (Object.hasOwn(MODE_EXPLAIN, params.get("m") || "")) state.mode = params.get("m");
  if (Object.hasOwn(LENGTHS, params.get("l") || "")) state.length = params.get("l");
  const signature = (params.get("ts") || "").replace("-", "/");
  if (SIGNATURES.includes(signature)) state.signature = signature;
  state.patternId = findPattern(state.signature, params.get("p")).id;
  const bpm = parseInt(params.get("bpm"), 10);
  if (bpm >= 50 && bpm <= 220) state.bpm = bpm;
  if (params.get("c") === "1") state.perStop = 1;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function pinElement(letter, which) {
  const el = document.createElement("div");
  el.className = `marker-pin ${letter.toLowerCase()}`;
  el.title = `${which === "start" ? "Start" : "End"} (drag to move)`;
  el.setAttribute("aria-label", `${which === "start" ? "Start" : "End"} pin. Drag to move, or edit the ${which} field.`);
  el.innerHTML = `<svg viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C8 27 2 21 2 14a13 13 0 0 1 26 0c0 7-6 13-13 23z" stroke="#0d0d0f" stroke-width="1.5"/><text x="15" y="19" text-anchor="middle">${letter}</text></svg>`;
  return el;
}

function playheadElement() {
  const el = document.createElement("div");
  el.className = "playhead";
  el.innerHTML = `<svg class="pick" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 24C7 18.5 2.5 13 2.5 8.5a10.5 6.5 0 0 1 21 0C23.5 13 19 18.5 13 24z"/></svg>`;
  return el;
}

// Web Mercator stops short of the poles; pins beyond that sit on the edge.
function clampToMap(lat) {
  return Math.max(-85, Math.min(85, lat));
}

function initMap() {
  const only = state.start && state.end ? null : state.start || state.end;
  const view = only
    ? { center: [only.lng, clampToMap(only.lat)], zoom: 10 }
    : { center: [-40, 30], zoom: 1.6 };
  map = new maplibregl.Map({
    container: "map",
    style: BASEMAPS[theme],
    ...view,
    maxZoom: 22,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  const locate = new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 14 } });
  locate.on("geolocate", (fix) => openSpot(fix.coords.latitude, fix.coords.longitude, false));
  map.addControl(locate, "top-right");
  map.touchZoomRotate.disableRotation();
  map.dragRotate.disable();
  map.keyboard.disableRotation();

  map.on("style.load", addRouteLayers);
  map.on("click", (event) => openSpot(event.lngLat.lat, wrapLng(event.lngLat.lng), true));
  map.on("dragstart", (event) => {
    if (event.originalEvent && $("follow").checked) $("follow").checked = false;
  });
  map.on("error", (event) => console.warn("Map error:", event.error && event.error.message));
}

// (Re)creates the route layers; a theme switch replaces the whole style.
function addRouteLayers() {
  if (map.getSource("stops")) return;
  const colours = MAP_COLOURS[theme];
  const labels = map.getStyle().layers.find((layer) => layer.type === "symbol");
  const before = labels ? labels.id : undefined;
  const empty = { type: "FeatureCollection", features: [] };

  map.addSource("stops", { type: "geojson", data: empty });
  map.addSource("track", { type: "geojson", data: empty });
  map.addSource("travelled", { type: "geojson", data: empty });
  map.addLayer({
    id: "stops-fill", type: "fill", source: "stops",
    paint: { "fill-color": colours.hex, "fill-opacity": theme === "dark" ? 0.1 : 0.07 },
  }, before);
  map.addLayer({
    id: "stops-played", type: "fill", source: "stops", filter: ["<", ["get", "i"], 0],
    paint: { "fill-color": colours.played, "fill-opacity": 0.34 },
  }, before);
  map.addLayer({
    id: "stops-current", type: "fill", source: "stops", filter: ["==", ["get", "i"], -1],
    paint: { "fill-color": colours.current, "fill-opacity": 0.7 },
  }, before);
  map.addLayer({
    id: "stops-outline", type: "line", source: "stops",
    paint: { "line-color": colours.hex, "line-width": 1.2, "line-opacity": 0.75 },
  }, before);
  map.addLayer({
    id: "stops-current-outline", type: "line", source: "stops", filter: ["==", ["get", "i"], -1],
    paint: { "line-color": colours.hex, "line-width": 2.5 },
  }, before);
  map.addLayer({
    id: "track-casing", type: "line", source: "track",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colours.casing, "line-width": 6, "line-opacity": 0.6 },
  }, before);
  map.addLayer({
    id: "track-line", type: "line", source: "track",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colours.track, "line-width": 3 },
  }, before);
  map.addLayer({
    id: "travelled-line", type: "line", source: "travelled",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colours.played, "line-width": 3.5 },
  }, before);
  drawRoute();
}

function lineFeature(coordinates) {
  return coordinates.length > 1
    ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }
    : { type: "FeatureCollection", features: [] };
}

function drawRoute() {
  if (!map.getSource("stops")) return;
  const route = state.route;
  map.getSource("stops").setData(route ? stopsToGeoJSON(route) : { type: "FeatureCollection", features: [] });
  map.getSource("track").setData(lineFeature(route ? route.track : []));
  shownStop = null;
  shownKm = null;
  renderPlayhead();
}

function setMarker(which) {
  const place = state[which];
  if (!place) {
    if (markers[which]) markers[which].remove();
    markers[which] = null;
    return;
  }
  if (!markers[which]) {
    const marker = new maplibregl.Marker({
      element: pinElement(which === "start" ? "A" : "B", which),
      anchor: "bottom",
      draggable: true,
    });
    marker.on("dragend", () => {
      const at = marker.getLngLat();
      const lat = Math.max(-90, Math.min(90, at.lat));
      setPlace(which, { lat, lng: wrapLng(at.lng), label: formatLatLng(lat, wrapLng(at.lng)) }, { move: false });
    });
    // A click on a pin shouldn't also open the spot popup underneath it.
    marker.getElement().addEventListener("click", (event) => event.stopPropagation());
    markers[which] = marker;
  }
  markers[which].setLngLat([place.lng, clampToMap(place.lat)]).addTo(map);
}

function fitRoute(animate = true) {
  const route = state.route;
  if (!route) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const point of route.track) bounds.extend(point);
  for (const hexagon of stopsToGeoJSON(route).features) {
    for (const vertex of hexagon.geometry.coordinates[0]) bounds.extend(vertex);
  }
  const stage = $("stage").getBoundingClientRect();
  const deck = $("deck").getBoundingClientRect();
  // On wide screens the deck floats over the bottom of the map.
  const overlap = Math.max(0, stage.bottom - deck.top);
  const side = Math.min(70, stage.width * 0.12);
  map.fitBounds(bounds, {
    padding: { top: 60, left: side, right: side, bottom: Math.min(stage.height * 0.5, overlap + 40) },
    maxZoom: 21,
    duration: animate ? 900 : 0,
  });
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

function setStatus(which, text, isError = false) {
  const el = places[which].status;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function setPlace(which, place, { move = true } = {}) {
  const ui = places[which];
  if (ui.abort) ui.abort.abort();
  state[which] = place;
  ui.input.value = place ? place.label : "";
  ui.lastQuery = ui.input.value.trim();
  ui.candidates.replaceChildren();
  setStatus(which, "");
  setMarker(which);
  if (spot) spot.popup.remove();
  if (place && move && !(state.start && state.end)) {
    map.flyTo({ center: [place.lng, clampToMap(place.lat)], zoom: Math.max(map.getZoom(), 10), duration: 900 });
  }
  writeHash();
  rebuildRoute({ fit: move });
}

async function findPlace(which, force = false) {
  const ui = places[which];
  const text = ui.input.value.trim();
  // Enter fires both "change" and "submit"; one lookup is enough.
  if (text === ui.searching || (!force && text === ui.lastQuery)) return;
  ui.lastQuery = text;
  if (ui.abort) ui.abort.abort();
  ui.candidates.replaceChildren();
  if (!text) {
    if (state[which]) setPlace(which, null);
    setStatus(which, "");
    return;
  }
  const abort = new AbortController();
  ui.abort = abort;
  ui.searching = text;
  const button = ui.form.querySelector("button");
  button.disabled = true;
  setStatus(which, "Searching…");
  let results;
  try {
    results = await geocode(text, abort.signal);
  } catch (error) {
    if (abort.signal.aborted) return;
    ui.lastQuery = "";
    setStatus(which, error.message, true);
    return;
  } finally {
    if (ui.abort === abort) {
      button.disabled = false;
      ui.searching = null;
    }
  }
  if (abort.signal.aborted) return;
  if (!results.length) {
    setStatus(which, `No match for “${text}”. Try adding a city or country, or click the map.`, true);
    return;
  }
  setPlace(which, results[0]);
  showCandidates(which, results, results[0]);
}

// The other matches for a search, tucked away until asked for. Picking one
// keeps the list, so the first answer can be picked again.
function showCandidates(which, results, chosen, open = false) {
  const box = places[which].candidates;
  box.replaceChildren();
  const others = results.filter((result) => result !== chosen);
  if (!others.length) return;
  const details = document.createElement("details");
  details.open = open;
  const summary = document.createElement("summary");
  summary.textContent = `Not the right one? ${others.length} other ${others.length === 1 ? "match" : "matches"}`;
  details.append(summary);
  for (const other of others) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate";
    button.textContent = other.detail;
    button.title = other.detail;
    button.addEventListener("click", () => {
      setPlace(which, other);
      showCandidates(which, results, other, true);
    });
    details.append(button);
  }
  box.append(details);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

async function rebuildRoute({ fit = true } = {}) {
  const request = ++routeRequest;
  if (routeAbort) routeAbort.abort();
  stopPlayback();
  state.cueStop = 0;
  state.finished = false;
  // Nothing is playable until the new route exists; an old route left in
  // place could be played and then swapped out from under the song.
  state.route = null;
  state.routePending = false;

  if (!state.start || !state.end) {
    drawRoute();
    renderRoute();
    return;
  }
  const a = [state.start.lat, state.start.lng];
  const b = [state.end.lat, state.end.lng];
  const maxStops = LENGTHS[state.length].stops;
  let route;
  let note = "";
  if (state.mode === "road") {
    routeAbort = new AbortController();
    state.routePending = true;
    drawRoute();
    renderRoute();
    try {
      route = await buildRoadRoute(a, b, maxStops, routeAbort.signal);
    } catch (error) {
      if (request !== routeRequest) return;
      if (!(error instanceof RoutingError)) console.warn(error);
      const why = error instanceof RoutingError ? error.message : "road routing failed";
      note = `Couldn’t follow roads: ${why}. Walked the hexagons instead.`;
    }
    if (request !== routeRequest) return;
    state.routePending = false;
  }
  if (!route) route = buildHexRoute(a, b, maxStops);
  for (const stop of route.stops) stop.chords = chordsFor(stop.point[0], stop.point[1]);
  route.note = note;
  state.route = route;
  drawRoute();
  renderRoute();
  if (fit) fitRoute();
}

function routeTitle() {
  return `${state.start.label} → ${state.end.label}`;
}

function renderRoute() {
  const route = state.route;
  const summary = $("route-summary");
  $("play").disabled = !route;
  $("stop").disabled = !route;
  summary.classList.toggle("busy", state.routePending);
  if (!route) {
    summary.textContent = state.routePending ? "Finding a road route…" : "";
    $("deck-title").textContent = state.routePending
      ? "Finding a road route…"
      : state.start || state.end
        ? `Now add ${state.start ? "an end" : "a start"} to write a song.`
        : "Pick a start and an end to write a song.";
    $("deck-sub").textContent = "";
    $("chart").replaceChildren();
    $("now").replaceChildren();
    $("progress-bar").style.width = "0";
    return;
  }
  const across = formatKm(hexSpacingKm(route.res));
  const count = `${route.stops.length} ${route.stops.length === 1 ? "stop" : "stops"}`;
  const distance = route.straightKm === 0
    ? "no distance at all"
    : route.mode === "road"
      ? `${formatKm(route.distanceKm)} by road`
      : `${formatKm(route.straightKm)} as the crow flies`;
  const notes = [];
  if (route.note) notes.push(route.note);
  if (route.mode === "road" && route.snapKm) {
    const far = Math.max(...route.snapKm);
    if (far > Math.max(1, route.distanceKm * 0.02)) {
      notes.push(`The nearest road is ${formatKm(far)} from ${route.snapKm[0] >= route.snapKm[1] ? "the start" : "the end"}; the line jumps straight to it.`);
    }
  }
  if (route.straightKm === 0) notes.push("Start and end are the same spot, so this is a very short song.");
  summary.innerHTML =
    `<strong>${count}</strong> · ${escapeHTML(distance)} · hexagons about ${escapeHTML(across)} across` +
    notes.map((text) => `<span class="note">${escapeHTML(text)}</span>`).join("");
  $("deck-title").textContent = routeTitle();
  renderChart();
  renderSongInfo();
  renderPlayhead();
}

function renderChart() {
  const route = state.route;
  const items = route.stops.map((stop, i) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const shown = state.perStop === 3 ? [0, 1, 2] : [i % 3];
    button.innerHTML = `<span class="n">${i + 1}</span>` +
      shown.map((which) => `<span class="c" data-which="${which}">${escapeHTML(stop.chords[which].name)}</span>`).join("");
    button.setAttribute("aria-label", `Stop ${i + 1}: ${shown.map((which) => stop.chords[which].name).join(", ")}`);
    button.tabIndex = i === 0 ? 0 : -1;
    button.addEventListener("click", () => jumpToStop(i));
    li.append(button);
    return li;
  });
  $("chart").replaceChildren(...items);
  shownStop = null;
}

// The chart is one tab stop; arrow keys walk along it.
function onChartKey(event) {
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
  if (!step) return;
  const buttons = [...$("chart").querySelectorAll("button")];
  const from = buttons.indexOf(document.activeElement);
  if (from < 0) return;
  event.preventDefault();
  const to = Math.max(0, Math.min(buttons.length - 1, from + step));
  buttons.forEach((button, i) => { button.tabIndex = i === to ? 0 : -1; });
  buttons[to].focus();
}

function totalBars() {
  return state.route.stops.length * state.perStop;
}

function renderSongInfo(position) {
  if (!state.route) return;
  const total = songSeconds(totalBars(), state.signature, state.bpm);
  const stops = state.route.stops.length;
  if (position && state.playing === "route") {
    const barSeconds = (slotsPerBar(state.signature) * 15) / state.bpm;
    const elapsed = position.ending ? total : (position.bar + position.fraction) * barSeconds;
    const stop = position.ending ? stops : position.info.stop + 1;
    $("deck-sub").textContent = `Stop ${stop}/${stops} · ${formatClock(elapsed)} / ${formatClock(total)}`;
  } else {
    const from = state.cueStop > 0 ? ` · starts at stop ${state.cueStop + 1}` : "";
    $("deck-sub").textContent = `${stops} ${stops === 1 ? "stop" : "stops"} · ${totalBars()} bars · about ${formatClock(total)}${from}`;
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function makeSong() {
  const stops = state.route.stops;
  return {
    per: state.perStop,
    get bars() { return stops.length * this.per; },
    barAt(bar) {
      const stop = Math.floor(bar / this.per);
      const which = this.per === 3 ? bar % 3 : stop % 3;
      return { chord: stops[stop].chords[which], stop, which };
    },
    ending: stops[stops.length - 1].chords[0],
  };
}

function setPlayButton() {
  const playing = state.playing === "route" && player.state === "playing";
  $("play").classList.toggle("playing", playing);
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
}

async function startAudio(run) {
  const button = $("play");
  button.classList.add("busy");
  try {
    await run();
  } catch (error) {
    console.warn(error);
    toast(error.message || "Audio couldn’t start in this browser.");
    stopPlayback();
  } finally {
    button.classList.remove("busy");
  }
}

async function togglePlay() {
  if (!state.route) return;
  if (state.playing === "route" && player.state === "playing") {
    player.pause();
  } else if (state.playing === "route" && player.state === "paused") {
    await startAudio(() => player.resume());
  } else {
    if (state.finished) {
      state.finished = false;
      state.cueStop = 0;
    }
    song = makeSong();
    state.playing = "route";
    const request = routeRequest;
    await startAudio(() => player.play(song, state.cueStop * song.per));
    // The route changed while the samples were still loading.
    if (request !== routeRequest) stopPlayback();
  }
  setPlayButton();
}

function stopPlayback() {
  player.stop();
  state.playing = null;
  setPlayButton();
  highlightSpot(-1);
  highlightPattern(null);
}

function stopAndRewind() {
  stopPlayback();
  state.cueStop = 0;
  state.finished = false;
  renderSongInfo();
  renderPlayhead();
}

function jumpToStop(index) {
  if (!state.route) return;
  state.finished = false;
  if (state.playing === "route" && player.state === "playing") {
    player.seek(index * song.per);
    return;
  }
  stopPlayback();
  state.cueStop = index;
  renderSongInfo();
  renderPlayhead();
}

player.onEnd = () => {
  const wasRoute = state.playing === "route";
  stopPlayback();
  if (wasRoute) {
    state.finished = true;
    state.cueStop = 0;
    renderSongInfo();
    renderPlayhead();
  }
};

// ---------------------------------------------------------------------------
// Playhead rendering
// ---------------------------------------------------------------------------

let shownStop = null; // "stop:which" currently painted in the chart and cards
let shownKm = null; // how far the travelled line has been drawn
let shownSlot = null;

// Paints everything that depends on where the song is: marker, hexagons,
// progress line, chord cards and chart. With no position, shows the cue.
function renderPlayhead(position) {
  const route = state.route;
  if (!route) {
    if (markers.playhead) markers.playhead.remove();
    return;
  }
  const stops = route.stops;
  const last = stops.length - 1;
  let stop;
  let which;
  let km;
  let played; // stops fully behind us
  if (position && !position.ending) {
    stop = position.info.stop;
    which = position.info.which;
    if (!stops[stop]) return;
    const per = song.per;
    const into = per === 3 ? ((position.bar % 3) + position.fraction) / 3 : position.fraction;
    const next = stops[Math.min(last, stop + 1)].trackKm;
    km = stops[stop].trackKm + (next - stops[stop].trackKm) * into;
    played = stop;
  } else if (position || state.finished) {
    stop = last;
    which = 0;
    km = route.distanceKm;
    played = stops.length;
  } else {
    stop = Math.min(last, state.cueStop);
    which = state.perStop === 3 ? 0 : stop % 3;
    km = stops[stop].trackKm;
    played = stop;
  }

  const at = pointAt(route, km);
  if (!markers.playhead) markers.playhead = new maplibregl.Marker({ element: playheadElement(), anchor: "center" });
  markers.playhead.setLngLat([at[1], clampToMap(at[0])]).addTo(map);
  // Parked on the start or end it would only hide the pin.
  markers.playhead.getElement().style.visibility = position || (km > 0 && km < route.distanceKm) ? "" : "hidden";
  if (position && $("follow").checked) map.jumpTo({ center: [at[1], at[0]] });

  // Redrawing the travelled line is the one costly step, so only do it
  // once the playhead has visibly moved on.
  const moved = shownKm === null || Math.abs(km - shownKm) >= route.distanceKm / 1500;
  if ((moved || km === 0 || km === route.distanceKm) && km !== shownKm && map.getSource("travelled")) {
    map.getSource("travelled").setData(lineFeature(trackUpTo(route, km)));
    shownKm = km;
  }
  const total = position && !position.ending ? (position.bar + position.fraction) / song.bars : played / stops.length;
  $("progress-bar").style.width = `${Math.min(100, total * 100).toFixed(2)}%`;

  const key = `${stop}:${which}:${played}`;
  if (key === shownStop) return;
  shownStop = key;
  const current = played > last ? -1 : stop;
  if (map.getLayer("stops-played")) {
    map.setFilter("stops-played", ["<", ["get", "i"], played]);
    map.setFilter("stops-current", ["==", ["get", "i"], current]);
    map.setFilter("stops-current-outline", ["==", ["get", "i"], current]);
  }
  renderNow(stops[stop], which, Boolean(position));
  const items = $("chart").children;
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle("played", i < played);
    items[i].classList.toggle("current", i === current);
    for (const span of items[i].querySelectorAll(".c")) {
      span.classList.toggle("on", i === current && Boolean(position) && Number(span.dataset.which) === which);
    }
  }
  const item = items[stop];
  if (item && position) {
    const chart = $("chart");
    const target = item.offsetLeft - chart.offsetLeft - chart.clientWidth / 2 + item.offsetWidth / 2;
    chart.scrollTo({ left: target, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

function chordCard(chord, className = "") {
  // The code book runs to names like "A#maj7sus4#5/F#"; shrink those to fit.
  const size = chord.name.length > 13 ? "longest" : chord.name.length > 10 ? "long" : "";
  return `<div class="chord-card ${className}"><span class="name ${size}">${escapeHTML(chord.name)}</span>${chordDiagram(chord)}</div>`;
}

// The three chords of the stop under the playhead.
function renderNow(stop, which, sounding) {
  $("now").innerHTML = stop.chords.map((chord, i) => {
    const idle = state.perStop === 1 && i !== which;
    return chordCard(chord, i === which && sounding ? "on" : idle ? "idle" : "");
  }).join("");
}

function renderPattern() {
  const pattern = findPattern(state.signature, state.patternId);
  const tokens = patternTokens(pattern);
  const labels = gridLabels(state.signature, pattern);
  const viz = $("pattern-viz");
  viz.innerHTML = tokens.map((token, i) => {
    const glyph = GLYPHS[token] || token;
    const style = token === "-" ? "rest" : /[du]/.test(token) ? "soft" : "";
    const beat = /^\d+$/.test(labels[i]) ? "beat" : "";
    return `<div class="cell ${beat}"><span class="glyph ${style}">${glyph}</span><span class="count">${labels[i]}</span></div>`;
  }).join("");
  viz.setAttribute("aria-label", `${pattern.name}: ${tokens.map((token) => TOKEN_WORDS[token]).join(", ")}`);
  $("pattern-legend").textContent = LEGEND
    .filter(([, used]) => tokens.some((token) => used.test(token)))
    .map(([glyph, , meaning]) => `${glyph} ${meaning}`)
    .join(" · ");
  shownSlot = null;
}

function highlightPattern(position) {
  const cells = $("pattern-viz").children;
  const pattern = findPattern(state.signature, state.patternId);
  let index = -1;
  // Only when the bar being heard uses the pattern on screen.
  if (position && !position.ending && position.pattern === pattern) {
    index = Math.floor(position.slot / (16 / pattern.grid));
  }
  if (index === shownSlot) return false;
  shownSlot = index;
  for (let i = 0; i < cells.length; i++) cells[i].classList.toggle("on", i === index);
  return index >= 0 && patternTokens(pattern)[index] !== "-";
}

function frame() {
  requestAnimationFrame(frame);
  if (!state.playing) return;
  const position = player.position();
  if (!position) return;
  const struck = highlightPattern(position);
  if (state.playing === "route") {
    renderPlayhead(position);
    renderSongInfo(position);
    if (struck && markers.playhead) {
      const el = markers.playhead.getElement();
      el.classList.remove("hit");
      void el.offsetWidth;
      el.classList.add("hit");
    }
  } else {
    highlightSpot(position.ending ? 0 : position.info.which);
  }
}

// ---------------------------------------------------------------------------
// Clicking the map: hear one spot
// ---------------------------------------------------------------------------

function highlightSpot(which) {
  if (!spot) return;
  const cards = spot.popup.getElement() ? spot.popup.getElement().querySelectorAll(".chord-card") : [];
  cards.forEach((card, i) => card.classList.toggle("on", i === which));
}

async function playSpot() {
  if (!spot) return;
  // Hearing a spot interrupts the song; remember the stop so Play picks
  // it up again from there.
  const position = state.playing === "route" ? player.position() : null;
  stopPlayback();
  if (position && !position.ending) state.cueStop = position.info.stop;
  renderSongInfo();
  renderPlayhead();
  const chords = spot.chords;
  state.playing = "spot";
  await startAudio(() => player.play({
    bars: 3,
    barAt: (bar) => ({ chord: chords[bar], which: bar }),
    ending: chords[0],
  }));
}

function openSpot(lat, lng, autoplay) {
  if (spot) spot.popup.remove();
  const chords = chordsFor(lat, lng);
  const content = document.createElement("div");
  content.className = "spot";
  content.innerHTML = `
    <p class="spot-title">${formatLatLng(lat, lng)}</p>
    <div class="spot-chords">${chords.map((chord) => chordCard(chord)).join("")}</div>
    <div class="spot-actions">
      <button type="button" class="button" data-action="hear">▶ Hear it</button>
      <button type="button" class="button quiet" data-action="start">Start here</button>
      <button type="button" class="button quiet" data-action="end">End here</button>
    </div>`;
  content.addEventListener("click", (event) => {
    const action = event.target.closest("button") && event.target.closest("button").dataset.action;
    if (action === "hear") playSpot();
    else if (action) setPlace(action, { lat, lng, label: formatLatLng(lat, lng) }, { move: false });
  });
  const popup = new maplibregl.Popup({ offset: 10, focusAfterOpen: false })
    .setLngLat([lng, lat])
    .setDOMContent(content)
    .addTo(map);
  const opened = { popup, chords };
  spot = opened;
  popup.on("close", () => {
    if (spot !== opened) return;
    if (state.playing === "spot") stopPlayback();
    spot = null;
  });
  // Don't talk over a song that's already going.
  if (autoplay && !state.playing) playSpot();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function fillPatternSelect() {
  $("pattern").replaceChildren(...PATTERNS[state.signature].map((pattern) => {
    const option = document.createElement("option");
    option.value = pattern.id;
    option.textContent = pattern.name;
    return option;
  }));
  $("pattern").value = state.patternId;
}

function applyRhythm() {
  const pattern = findPattern(state.signature, state.patternId);
  state.patternId = pattern.id;
  player.signature = state.signature;
  player.pattern = pattern;
  player.setTempo(state.bpm);
  renderPattern();
  if (state.playing !== "route") renderSongInfo();
  writeHash();
}

function setTempo(value) {
  const bpm = Math.max(50, Math.min(220, Math.round(Number(value)) || state.bpm));
  state.bpm = bpm;
  $("tempo").value = bpm;
  $("tempo-number").value = bpm;
  applyRhythm();
}

function setPerStop(per) {
  const old = state.perStop;
  if (per === old) return;
  state.perStop = per;
  $("perstop-explain").textContent = PER_STOP_EXPLAIN[per];
  writeHash();
  if (!state.route) return;
  if (state.playing === "route") {
    // Finish the bar in progress, then carry on from the next stop boundary
    // counted the new way.
    const playing = song;
    player.onNextBarLine((bar) => {
      const stop = Math.ceil(bar / playing.per);
      playing.per = per;
      return stop * per;
    });
  }
  renderChart();
  if (state.playing !== "route") {
    renderSongInfo();
    renderPlayhead();
  }
}

function setTheme(next) {
  theme = next;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("w3c-theme", next); } catch (error) { /* private mode */ }
  document.querySelector('meta[name="theme-color"]').content = next === "dark" ? "#0d0d0f" : "#f3efe5";
  map.setStyle(BASEMAPS[next]);
}

function bindControls() {
  for (const which of ["start", "end"]) {
    const ui = places[which];
    ui.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const place = state[which];
      if (place && ui.input.value.trim() === place.label) {
        // Already found: "Find" just shows where it is.
        map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 10) });
      } else {
        findPlace(which, true);
      }
    });
    // Tabbing on to the next field without pressing Enter still counts.
    ui.input.addEventListener("change", () => findPlace(which));
  }
  $("swap").addEventListener("click", () => {
    if (!state.start && !state.end) return;
    const { start, end } = state;
    state.start = end;
    state.end = start;
    for (const which of ["start", "end"]) {
      const ui = places[which];
      // A lookup still in flight would land in the wrong field.
      if (ui.abort) ui.abort.abort();
      ui.input.value = state[which] ? state[which].label : "";
      ui.lastQuery = ui.input.value;
      ui.candidates.replaceChildren();
      setStatus(which, "");
      setMarker(which);
    }
    writeHash();
    rebuildRoute();
  });

  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener("change", () => {
      state.mode = radioValue("mode");
      $("mode-explain").textContent = MODE_EXPLAIN[state.mode];
      writeHash();
      rebuildRoute();
    });
  }
  for (const input of document.querySelectorAll('input[name="length"]')) {
    input.addEventListener("change", () => {
      state.length = radioValue("length");
      $("length-explain").textContent = LENGTHS[state.length].explain;
      writeHash();
      rebuildRoute();
    });
  }
  for (const input of document.querySelectorAll('input[name="perstop"]')) {
    input.addEventListener("change", () => setPerStop(Number(radioValue("perstop"))));
  }

  $("signature").addEventListener("change", () => {
    state.signature = $("signature").value;
    state.patternId = PATTERNS[state.signature][0].id;
    fillPatternSelect();
    applyRhythm();
  });
  $("pattern").addEventListener("change", () => {
    state.patternId = $("pattern").value;
    applyRhythm();
  });
  $("tempo").addEventListener("input", () => setTempo($("tempo").value));
  $("tempo-number").addEventListener("change", () => setTempo($("tempo-number").value));
  $("volume").addEventListener("input", () => {
    state.volume = Number($("volume").value);
    player.setVolume(state.volume);
  });

  $("example").addEventListener("click", () => {
    setPlace("start", { ...EXAMPLE.start });
    setPlace("end", { ...EXAMPLE.end });
  });
  $("chart").addEventListener("keydown", onChartKey);
  // Our own updates use replaceState, which doesn't fire this; a hash that
  // changes any other way is a different link being opened.
  window.addEventListener("hashchange", () => location.reload());

  $("play").addEventListener("click", togglePlay);
  $("stop").addEventListener("click", stopAndRewind);
  $("follow").addEventListener("change", () => {
    if (!$("follow").checked || !state.route) return;
    // Close enough that neighbouring stops are about 110 px apart.
    const at = markers.playhead ? markers.playhead.getLngLat() : map.getCenter();
    const metresPerPixel = (hexSpacingKm(state.route.res) * 1000) / 110;
    const zoom = Math.log2((78271.5 * Math.cos((at.lat * Math.PI) / 180)) / metresPerPixel);
    map.easeTo({ center: at, zoom: Math.max(1.5, Math.min(21, zoom)), duration: 600 });
  });
  $("theme-toggle").addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));
  $("about-open").addEventListener("click", () => $("about").showModal());
  $("about").addEventListener("click", (event) => {
    if (event.target === $("about")) $("about").close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest("input, select, textarea, button, summary, a, dialog, [contenteditable]")) return;
    event.preventDefault();
    togglePlay();
  });
}

function syncControls() {
  $("signature").replaceChildren(...SIGNATURES.map((signature) => {
    const option = document.createElement("option");
    option.value = signature;
    option.textContent = signature;
    return option;
  }));
  $("signature").value = state.signature;
  fillPatternSelect();
  $("tempo").value = state.bpm;
  $("tempo-number").value = state.bpm;
  $("volume").value = state.volume;
  document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
  document.querySelector(`input[name="length"][value="${state.length}"]`).checked = true;
  document.querySelector(`input[name="perstop"][value="${state.perStop}"]`).checked = true;
  $("mode-explain").textContent = MODE_EXPLAIN[state.mode];
  $("length-explain").textContent = LENGTHS[state.length].explain;
  $("perstop-explain").textContent = PER_STOP_EXPLAIN[state.perStop];
  for (const which of ["start", "end"]) {
    places[which].input.value = state[which] ? state[which].label : "";
    places[which].lastQuery = places[which].input.value;
  }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function main() {
  const missing = ["maplibregl", "h3", "Tone"].filter((name) => !(name in window));
  if (missing.length) throw new Error("Some of the page’s libraries didn’t load. Check your connection and reload.");
  readHash();
  syncControls();
  bindControls();
  await loadChords("./data/chords.json");
  initMap();
  applyRhythm();
  player.setVolume(state.volume);
  setMarker("start");
  setMarker("end");
  renderRoute();
  rebuildRoute({ fit: false }).then(() => fitRoute(false));
  // Fetch the guitar in the background so the first play is instant.
  player.load().catch(() => toast("The guitar samples didn’t load, so there’s no sound yet. Reload to try again."));
  requestAnimationFrame(frame);
  $("loading").classList.add("done");
}

main().catch((error) => {
  console.error(error);
  $("loading").classList.add("failed");
  $("loading-text").textContent = error.message || "Something went wrong while loading.";
  const retry = document.createElement("button");
  retry.className = "button";
  retry.textContent = "Reload";
  retry.addEventListener("click", () => {
    // Drop the link's settings too, in case they are what broke.
    history.replaceState(null, "", location.pathname);
    location.reload();
  });
  $("loading-text").after(retry);
});
