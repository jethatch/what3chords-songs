import { loadChords, chordsFor } from "./chords.js";
import { chordDiagram } from "./diagram.js";
import { geocode, formatLatLng } from "./geocode.js";
import {
  buildHexRoute, buildRoadRoute, buildPathRoute, RoutingError, hexSpacingKm, pointAt, trackUpTo,
  stopsToGeoJSON, wrapLng,
} from "./routing.js";
import {
  PATTERNS, SIGNATURES, DRUM_STYLES, STYLES, findPattern, patternTokens, gridLabels, slotsPerBar,
} from "./patterns.js";
import { Band, GUITARS, findGuitar } from "./band.js";
import { Player, LiveRecorder, renderSong, songSeconds } from "./audio.js";
import { LiveSession, liveSupport, paceName } from "./live.js";
import { encodeState, decodeHash } from "./link.js";

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
  short: { name: "Short", stops: 10, explain: "About 10 stops at most. Big hexagons, a quick sketch of the trip." },
  medium: { name: "Medium", stops: 28, explain: "About 28 stops at most. A proper song." },
  long: { name: "Long", stops: 75, explain: "About 75 stops at most. Small hexagons, the album version." },
};
const MODES = {
  hex: { name: "Hex walk", explain: "Greedy local routing: from each hexagon, step to whichever neighbour is nearest the destination. Worked out in your browser, and it ignores roads, rivers and oceans." },
  road: { name: "Follow roads", explain: "Asks the public OSRM server for a driving route and plays the hexagons it passes through. If no road connects the two places, or either pin is far from any road, you get the hex walk instead." },
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
const SECTIONS = ["more-route", "more-rhythm", "more-band"];

const $ = (id) => document.getElementById(id);
const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const state = {
  start: null, // { lat, lng, label }
  end: null,
  mode: "hex",
  length: "medium",
  // A recorded route (from a live session or a shared link) that stands in
  // for start and end: [{ point: [lat, lng], res, chords }].
  path: null,
  pathShared: false, // whether the path may be written into the address bar
  pathTitle: "Recorded trip",
  signature: "4/4",
  patternId: "ramones",
  bpm: 120,
  perStop: 3,
  guitar: "electric",
  drums: false,
  drumStyle: "match",
  bass: false,
  levels: { guitar: 0.8, bass: 0.8, drums: 0.8 },
  route: null,
  routePending: false, // a road route has been asked for and isn't back yet
  cueStop: 0,
  playing: null, // null | "route" | "spot" | "live"
  finished: false,
};

const band = new Band();
const player = new Player(band);
let map;
let theme = document.documentElement.dataset.theme;
let routeRequest = 0;
let routeAbort = null;
let song = null;
let spot = null; // { popup, chords } for the last clicked point
let live = null; // { session, recorder, started, fix } while a live session runs
let recordingUrl = null;
const markers = { start: null, end: null, playhead: null };
const places = {
  start: { input: $("start-input"), status: $("start-status"), candidates: $("start-candidates"), form: $("start-form"), lastQuery: "", searching: null, abort: null },
  end: { input: $("end-input"), status: $("end-status"), candidates: $("end-candidates"), form: $("end-form"), lastQuery: "", searching: null, abort: null },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatKm(km) {
  if (km >= 100) return `${Math.round(km).toLocaleString()} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  if (km >= 0.001 || km === 0) return `${Math.round(km * 1000)} m`;
  return `${Math.round(km * 100000)} cm`;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatSize(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

function remember(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* private mode */ }
}

function recall(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (error) { return null; }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function songTitle() {
  if (state.path) return state.pathTitle;
  return `${state.start.label} → ${state.end.label}`;
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
  clearTimeout(hashTimer);
  // A travelled route only goes into the address once its owner has chosen
  // to share it (or it arrived in a link in the first place).
  const hash = encodeState(state, state.pathShared);
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`);
  } catch (error) {
    // The link just goes a little stale; nothing else depends on it.
  }
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
  locate.on("geolocate", (fix) => {
    if (!live) openSpot(fix.coords.latitude, fix.coords.longitude, false);
  });
  map.addControl(locate, "top-right");
  map.touchZoomRotate.disableRotation();
  map.dragRotate.disable();
  map.keyboard.disableRotation();

  map.on("style.load", addRouteLayers);
  map.on("click", (event) => {
    hideArrival();
    // A live session owns the sound and the route; nothing to pin.
    if (!live) openSpot(event.lngLat.lat, wrapLng(event.lngLat.lng), true);
  });
  map.on("dragstart", (event) => {
    if (event.originalEvent && $("follow").checked) $("follow").checked = false;
  });
  map.on("error", (event) => console.warn("Map error:", event.error && event.error.message));
}

// (Re)creates the route layers; a theme switch replaces the whole style.
function addRouteLayers() {
  if (map.getSource("stops")) return;
  const colours = MAP_COLOURS[theme];
  // Above every road, building and border the basemap draws, below its
  // labels. (The two basemaps put their first label layer in different
  // places, so look for the last thing that isn't a label.)
  const layers = map.getStyle().layers;
  let top = layers.length - 1;
  while (top >= 0 && layers[top].type === "symbol") top--;
  const before = layers[top + 1] ? layers[top + 1].id : undefined;
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
    paint: { "line-color": colours.hex, "line-width": 1.4, "line-opacity": 0.9 },
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
  // Choosing a place starts a planned trip; a recorded one makes way.
  if (state.path) setLiveStatus("");
  state.path = null;
  state.pathShared = false;
  state[which] = place;
  ui.input.value = place ? place.label : "";
  ui.lastQuery = ui.input.value.trim();
  ui.candidates.replaceChildren();
  setStatus(which, "");
  setMarker(which);
  hideArrival();
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

function pathRoute() {
  const route = buildPathRoute(state.path);
  route.stops.forEach((stop, i) => {
    const entry = state.path[i];
    // A recorded stop plays its hexagon's chords, taken at the centre, so
    // they don't depend on the exact point stored or shared.
    if (!entry.chords) {
      const centre = h3.cellToLatLng(stop.cell);
      entry.chords = chordsFor(centre[0], centre[1]);
    }
    stop.chords = entry.chords;
  });
  return route;
}

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

  if (state.path) {
    state.route = pathRoute();
  } else if (state.start && state.end) {
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
  }
  drawRoute();
  renderRoute();
  if (fit) fitRoute();
}

function renderRoute() {
  const route = state.route;
  const summary = $("route-summary");
  // During a live session there is nothing to play until a position arrives.
  $("play").disabled = live ? !live.started : !route;
  $("play").title = live && !live.started ? "Waiting for your location" : "";
  $("stop").disabled = !route && !live;
  for (const id of ["share", "download"]) {
    $(id).disabled = !route || Boolean(live);
    $(id).title = live ? "Available when the live session ends" : $(id).getAttribute("aria-label");
  }
  // A recorded route keeps the stops it was travelled with.
  $("route-choices").disabled = Boolean(state.path);
  $("route-note").hidden = !state.path;
  summary.classList.toggle("busy", state.routePending);
  renderSummaries();
  if (!route) {
    summary.textContent = state.routePending ? "Finding a road route…" : "";
    $("deck-title").textContent = live
      ? "Finding you…"
      : state.routePending
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
  const count = `${route.stops.length} ${route.stops.length === 1 ? "stop" : "stops"}`;
  const notes = [];
  let facts;
  if (route.mode === "path") {
    facts = `${formatKm(route.distanceKm)} travelled`;
  } else {
    const distance = route.straightKm === 0
      ? "no distance at all"
      : route.mode === "road"
        ? `${formatKm(route.distanceKm)} by road`
        : `${formatKm(route.straightKm)} as the crow flies`;
    facts = `${distance} · hexagons about ${formatKm(hexSpacingKm(route.res))} across`;
    if (route.note) notes.push(route.note);
    if (route.mode === "road" && route.snapKm) {
      const far = Math.max(...route.snapKm);
      if (far > Math.max(1, route.distanceKm * 0.02)) {
        notes.push(`The nearest road is ${formatKm(far)} from ${route.snapKm[0] >= route.snapKm[1] ? "the start" : "the end"}; the line jumps straight to it.`);
      }
    }
    if (route.straightKm === 0) notes.push("Start and end are the same spot, so this is a very short song.");
  }
  summary.innerHTML = `<strong>${count}</strong> · ${escapeHTML(facts)}` +
    notes.map((text) => `<span class="note">${escapeHTML(text)}</span>`).join("");
  $("deck-title").textContent = live && !live.started ? "Finding you…" : songTitle();
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
    const shown = state.perStop === 3 || live ? [0, 1, 2] : [i % 3];
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
  const stops = state.route.stops.length;
  const count = `${stops} ${stops === 1 ? "stop" : "stops"}`;
  if (live) {
    const fix = live.fix;
    const gps = fix ? ` · ${paceName(fix.res)} · GPS ±${Math.round(fix.accuracy)} m` : "";
    $("deck-sub").textContent = live.started
      ? `Live · ${count} · ${formatKm(state.route.distanceKm)}${gps}`
      : "Waiting for a location fix…";
    return;
  }
  const total = songSeconds(totalBars(), state.signature, state.bpm);
  if (position && state.playing === "route") {
    const barSeconds = (slotsPerBar(state.signature) * 15) / state.bpm;
    const elapsed = position.ending ? total : (position.bar + position.fraction) * barSeconds;
    const stop = position.ending ? stops : position.info.stop + 1;
    $("deck-sub").textContent = `Stop ${stop}/${stops} · ${formatClock(elapsed)} / ${formatClock(total)}`;
  } else {
    const from = state.cueStop > 0 ? ` · starts at stop ${state.cueStop + 1}` : "";
    $("deck-sub").textContent = `${count} · ${totalBars()} bars · about ${formatClock(total)}${from}`;
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
  const playing = (state.playing === "route" || state.playing === "live") && player.state === "playing";
  $("play").classList.toggle("playing", playing);
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("stop").setAttribute("aria-label", live ? "End the live session" : "Stop and go back to the start");
}

async function startAudio(run) {
  const button = $("play");
  button.classList.add("busy");
  // A guitar that failed to download gets another go each time play is pressed.
  if (!band.guitar && band.wanted !== state.guitar) {
    asked.guitar = state.guitar;
    band.setGuitar(state.guitar).catch(() => { asked.guitar = null; });
  }
  try {
    await run();
    return true;
  } catch (error) {
    console.warn(error);
    toast(error.message || "Audio couldn’t start in this browser.");
    stopPlayback();
    return false;
  } finally {
    button.classList.remove("busy");
  }
}

async function togglePlay() {
  hideArrival();
  if (live) {
    // During a live session the button only mutes and unmutes the band.
    if (state.playing !== "live") return;
    if (player.state === "playing") player.pause();
    else await startAudio(() => player.resume());
    setPlayButton();
    return;
  }
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
  if (live) {
    endLive();
    return;
  }
  stopPlayback();
  state.cueStop = 0;
  state.finished = false;
  renderSongInfo();
  renderPlayhead();
}

function jumpToStop(index) {
  if (!state.route || live) return;
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

function placePlayhead(lat, lng, visible) {
  if (!markers.playhead) markers.playhead = new maplibregl.Marker({ element: playheadElement(), anchor: "center" });
  markers.playhead.setLngLat([lng, clampToMap(lat)]).addTo(map);
  const el = markers.playhead.getElement();
  el.style.visibility = visible ? "" : "hidden";
  el.classList.toggle("live", Boolean(live));
}

function drawTravelled(route, km) {
  // Redrawing the travelled line is the one costly step, so only do it
  // once the playhead has visibly moved on.
  const moved = shownKm === null || Math.abs(km - shownKm) >= route.distanceKm / 1500;
  if ((moved || km === 0 || km === route.distanceKm) && km !== shownKm && map.getSource("travelled")) {
    map.getSource("travelled").setData(lineFeature(trackUpTo(route, km)));
    shownKm = km;
  }
}

// Marks which stop and chord are up: hexagons on the map, the chord cards
// and the chart.
function showStop(route, stop, which, played, sounding) {
  const key = `${stop}:${which}:${played}:${sounding}:${route.stops.length}`;
  if (key === shownStop) return;
  shownStop = key;
  const stops = route.stops;
  const current = played > stops.length - 1 ? -1 : stop;
  if (map.getLayer("stops-played")) {
    map.setFilter("stops-played", ["<", ["get", "i"], played]);
    map.setFilter("stops-current", ["==", ["get", "i"], current]);
    map.setFilter("stops-current-outline", ["==", ["get", "i"], current]);
  }
  renderNow(stops[stop], which, sounding);
  const items = $("chart").children;
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle("played", i < played);
    items[i].classList.toggle("current", i === current);
    for (const span of items[i].querySelectorAll(".c")) {
      span.classList.toggle("on", i === current && sounding && Number(span.dataset.which) === which);
    }
  }
  const item = items[stop];
  if (item && sounding) {
    const chart = $("chart");
    const target = item.offsetLeft - chart.offsetLeft - chart.clientWidth / 2 + item.offsetWidth / 2;
    chart.scrollTo({ left: target, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

// Paints everything that depends on where the song is: marker, hexagons,
// progress line, chord cards and chart. With no position, shows the cue.
function renderPlayhead(position) {
  const route = state.route;
  if (!route) {
    if (markers.playhead) markers.playhead.remove();
    return;
  }
  if (live) {
    // Until the first fix, the old trip is still on screen; leave it be.
    if (live.started) renderLive(position);
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
  // Parked on the start or end it would only hide the pin.
  placePlayhead(at[0], at[1], Boolean(position) || (km > 0 && km < route.distanceKm));
  if (position && $("follow").checked) map.jumpTo({ center: [at[1], at[0]] });
  drawTravelled(route, km);
  const total = position && !position.ending ? (position.bar + position.fraction) / song.bars : played / stops.length;
  $("progress-bar").style.width = `${Math.min(100, total * 100).toFixed(2)}%`;
  showStop(route, stop, which, played, Boolean(position));
}

// A live session has no end to move towards: the marker is wherever the
// device is, and the newest stop is the one being played.
function renderLive(position) {
  const route = state.route;
  const stop = route.stops.length - 1;
  const fix = live.fix;
  if (fix) placePlayhead(fix.point[0], fix.point[1], true);
  drawTravelled(route, route.distanceKm);
  $("progress-bar").style.width = "0";
  const sounding = Boolean(position) && player.state === "playing";
  showStop(route, stop, position ? position.info.which : 0, stop, sounding);
}

function chordCard(chord, className = "") {
  // The code book runs to names like "A#maj7sus4#5/F#"; shrink those to fit.
  const size = chord.name.length > 13 ? "longest" : chord.name.length > 10 ? "long" : "";
  return `<div class="chord-card ${className}"><span class="name ${size}">${escapeHTML(chord.name)}</span>${chordDiagram(chord)}</div>`;
}

// The three chords of the stop under the playhead.
function renderNow(stop, which, sounding) {
  $("now").innerHTML = stop.chords.map((chord, i) => {
    const idle = state.perStop === 1 && !live && i !== which;
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
  if (state.playing === "spot") {
    highlightSpot(position.ending ? 0 : position.info.which);
    return;
  }
  renderPlayhead(position);
  if (state.playing === "route") renderSongInfo(position);
  if (struck && markers.playhead) {
    const el = markers.playhead.getElement();
    el.classList.remove("hit");
    void el.offsetWidth;
    el.classList.add("hit");
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
  if (!spot || live) return;
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
// Live session: the song follows the device
// ---------------------------------------------------------------------------

function setLiveStatus(text, isError = false) {
  $("live-status").textContent = text;
  $("live-status").classList.toggle("error", isError);
}

function renderLiveControls() {
  const on = Boolean(live);
  $("live-label").textContent = on ? "End session" : "Go live";
  $("live-toggle").classList.toggle("on", on);
  $("live-pitch").hidden = on;
  $("live-note").hidden = !on;
  $("trip-fields").disabled = on;
  $("trip").classList.toggle("is-live", on);
  setPlayButton();
}

function startLive() {
  const problem = liveSupport();
  if (problem) {
    setLiveStatus(problem, true);
    return;
  }
  stopPlayback();
  hideArrival();
  if (spot) spot.popup.remove();
  // Unlock audio while this click still counts; the first note has to wait
  // for a position.
  Tone.start();
  live = {
    session: new LiveSession({ onStop: onLiveStop, onFix: onLiveFix, onError: onLiveError }),
    recorder: null,
    started: false,
    fix: null,
  };
  setLiveStatus("Finding you…");
  $("live-download").hidden = true;
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = null;
  renderLiveControls();
  renderRoute();
  live.session.start();
}

function onLiveError(message, fatal) {
  if (!live) return;
  if (fatal) {
    endLive();
    setLiveStatus(message, true);
  } else {
    setLiveStatus(message);
  }
}

function onLiveFix(fix) {
  if (!live) return;
  const first = !live.fix;
  live.fix = fix;
  if (first || $("follow").checked) {
    // Close enough to see a few hexagons around you.
    const metresPerPixel = (hexSpacingKm(fix.res) * 1000) / 110;
    const zoom = Math.log2((78271.5 * Math.cos((fix.point[0] * Math.PI) / 180)) / metresPerPixel);
    map.easeTo({ center: [fix.point[1], fix.point[0]], zoom: first ? Math.min(19, zoom) : map.getZoom(), duration: 600 });
  }
  if (first) $("follow").checked = true;
  renderSongInfo();
  if (player.state !== "playing") renderPlayhead();
}

function onLiveStop(stop) {
  if (!live) return;
  const entry = { point: stop.point, res: stop.res };
  if (live.started) {
    state.path.push(entry);
  } else {
    // The trip that was on screen gives way to the one being travelled.
    live.started = true;
    routeRequest++;
    if (routeAbort) routeAbort.abort();
    for (const which of ["start", "end"]) {
      state[which] = null;
      places[which].input.value = "";
      places[which].lastQuery = "";
      places[which].candidates.replaceChildren();
      setStatus(which, "");
      setMarker(which);
    }
    state.path = [entry];
    state.pathShared = false;
    state.pathTitle = "Live session";
    state.routePending = false;
    state.cueStop = 0;
    state.finished = false;
    setLiveStatus("");
    writeHash();
    beginLiveSound();
  }
  state.route = pathRoute();
  drawRoute();
  renderRoute();
}

async function beginLiveSound() {
  const session = live;
  state.playing = "live";
  const started = await startAudio(() => player.play({
    bars: Infinity,
    // Always the newest stop; its three chords go round until there's a newer one.
    barAt: (bar) => {
      const stops = state.route.stops;
      const which = bar % 3;
      return { chord: stops[stops.length - 1].chords[which], stop: stops.length - 1, which };
    },
    ending: null,
  }));
  if (live !== session) {
    // Ended while the samples were loading.
    if (started && !live) stopPlayback();
    return;
  }
  if (!started) {
    state.playing = "live";
    setLiveStatus("The sound didn’t start. Tap play to try again.", true);
  } else if (LiveRecorder.supported) {
    try {
      session.recorder = new LiveRecorder(band);
      session.recorder.start();
    } catch (error) {
      session.recorder = null;
    }
  }
  setPlayButton();
}

async function endLive() {
  const session = live;
  if (!session) return;
  live = null;
  session.session.stop();
  stopPlayback();
  renderLiveControls();
  $("follow").checked = false;
  if (!session.started) {
    setLiveStatus("");
    renderRoute();
    return;
  }
  const stops = state.path.length;
  setLiveStatus(`Recorded ${stops} ${stops === 1 ? "stop" : "stops"}. Replay it, change the band, or share it. It isn’t kept if you close this page.`);
  renderRoute();
  fitRoute();
  if (session.recorder) {
    try {
      const blob = await session.recorder.stop();
      if (blob.size > 0) offerRecording(blob);
    } catch (error) {
      console.warn(error);
    }
  }
}

function offerRecording(blob) {
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(blob);
  const extension = /mp4/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
  const link = $("live-download");
  link.href = recordingUrl;
  link.download = `what3chords-live.${extension}`;
  link.textContent = `Download the live recording (${formatSize(blob.size)})`;
  link.hidden = false;
}

// ---------------------------------------------------------------------------
// Sharing and downloading
// ---------------------------------------------------------------------------

async function share() {
  if (!state.route || live) return;
  if (state.path && !state.pathShared) {
    // A travelled route says where someone has been; ask first.
    $("share-title").textContent = "Share this route?";
    $("share-text").textContent = "The link will draw the route you travelled, hexagon by hexagon, including where you started and stopped. Anyone who has the link can see it.";
    $("share-link").hidden = true;
    $("share-confirm").hidden = false;
    $("share-cancel").textContent = "Cancel";
    $("share-dialog").showModal();
    return;
  }
  flushHash();
  const url = location.href;
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: "what3chords songs", text: songTitle(), url });
    } catch (error) {
      // Dismissing the share sheet isn't a failure.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. It opens this trip with this sound.");
  } catch (error) {
    // No clipboard access (an insecure page, or permission refused): show
    // the link to copy by hand.
    $("share-title").textContent = "Copy this link";
    $("share-text").textContent = "It opens this trip with this sound.";
    $("share-link").value = url;
    $("share-link").hidden = false;
    $("share-confirm").hidden = true;
    $("share-cancel").textContent = "Done";
    $("share-dialog").showModal();
    $("share-link").select();
  }
}

async function downloadSong() {
  if (!state.route || live) return;
  const button = $("download");
  if (button.classList.contains("busy")) return;
  button.classList.add("busy");
  const title = songTitle();
  const progress = (fraction) => toast(`Rendering the song… ${Math.round(fraction * 100)}%`);
  progress(0);
  try {
    const blob = await renderSong(makeSong(), {
      signature: state.signature,
      pattern: findPattern(state.signature, state.patternId),
      bpm: state.bpm,
      drums: state.drums,
      drumStyle: state.drumStyle,
      bass: state.bass,
      guitar: state.guitar,
      levels: state.levels,
    }, progress);
    const name = `${title.toLowerCase().replace(/→/g, "to").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "song"}.wav`;
    saveBlob(blob, name);
    toast(`Saved ${name} (${formatSize(blob.size)}).`);
  } catch (error) {
    console.warn(error);
    toast(error.message || "The song couldn’t be rendered in this browser.");
  } finally {
    button.classList.remove("busy");
  }
}

// The prompt shown when the page was opened from a link to a song: browsers
// won't start sound without a click, so make the click obvious.
function showArrival() {
  if (!state.route) return;
  const style = currentStyle();
  $("arrival-what").textContent = `${songTitle()} · ${style ? style.name : "custom sound"} · ${state.bpm} BPM`;
  $("arrival").hidden = false;
}

function hideArrival() {
  $("arrival").hidden = true;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function radioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function fillSelect(select, options, value) {
  select.replaceChildren(...options.map(([id, name]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    return option;
  }));
  select.value = value;
}

function fillPatternSelect() {
  fillSelect($("pattern"), PATTERNS[state.signature].map((pattern) => [pattern.id, pattern.name]), state.patternId);
}

// The style whose settings match what is selected now, if any. Tempo is
// left out: nudging the speed doesn't make a waltz something else.
function currentStyle() {
  return STYLES.find((style) =>
    style.signature === state.signature && style.pattern === state.patternId &&
    style.guitar === state.guitar && style.drums === state.drums && style.bass === state.bass &&
    (!style.drums || style.drumStyle === state.drumStyle));
}

function renderStyle() {
  const style = currentStyle();
  const options = STYLES.map((s) => [s.id, s.name]);
  if (!style) options.push(["custom", "Custom"]);
  fillSelect($("style"), options, style ? style.id : "custom");
}

// The one-line "what's selected" text on each collapsed section.
function renderSummaries() {
  $("route-now").textContent = state.path ? "Recorded route" : `${MODES[state.mode].name} · ${LENGTHS[state.length].name}`;
  const pattern = findPattern(state.signature, state.patternId);
  $("rhythm-now").textContent = `${pattern.name} · ${state.perStop === 3 ? "3 chords" : "1 chord"} a stop`;
  const drumStyle = DRUM_STYLES.find((style) => style.id === state.drumStyle);
  const drums = !state.drums ? "no drums" : state.drumStyle === "match" ? "drums" : `${drumStyle.name.toLowerCase()} drums`;
  $("band-now").textContent = `${findGuitar(state.guitar).name} · ${drums} · ${state.bass ? "bass" : "no bass"}`;
}

// Pushes every sound setting to the player and repaints what depends on it.
function applySound() {
  const pattern = findPattern(state.signature, state.patternId);
  state.patternId = pattern.id;
  player.signature = state.signature;
  player.pattern = pattern;
  player.drums = state.drums;
  player.drumStyle = state.drumStyle;
  player.bass = state.bass;
  player.setTempo(state.bpm);
  // Ask for instruments only when the choice changes: this runs on every
  // nudge of the tempo slider, and a failed download shouldn't be hammered.
  if (asked.guitar !== state.guitar) {
    const id = state.guitar;
    asked.guitar = id;
    band.setGuitar(id).catch(() => guitarFailed(id));
  }
  if (asked.bass !== state.bass) {
    asked.bass = state.bass;
    if (state.bass) band.loadBass().catch(bassFailed);
  }
  $("drum-style").disabled = !state.drums;
  renderPattern();
  renderStyle();
  renderSummaries();
  if (state.playing !== "route") renderSongInfo();
  writeHash();
}

// What the band was last asked to load.
const asked = { guitar: null, bass: false };

// A guitar that won't download leaves the previous one in place; say so,
// and put the menu back so it shows what is actually playing.
function guitarFailed(id) {
  // Another guitar has been picked since; its own result is what matters.
  if (state.guitar !== id) return;
  const wanted = findGuitar(id).name;
  asked.guitar = null;
  if (band.guitar && band.guitar.def.id !== state.guitar) {
    state.guitar = band.guitar.def.id;
    asked.guitar = state.guitar;
    band.wanted = state.guitar;
    syncSoundControls();
    applySound();
    toast(`${wanted} didn’t load, so it’s still ${band.guitar.def.name}. Check your connection and pick it again.`);
  } else {
    toast("The guitar didn’t load. Check your connection and press play to try again.");
  }
}

function bassFailed() {
  asked.bass = false;
  if (!state.bass) return;
  state.bass = false;
  syncSoundControls();
  applySound();
  toast("The bass didn’t load, so it’s switched off. Check your connection and switch it on again.");
}

function syncSoundControls() {
  $("signature").value = state.signature;
  fillPatternSelect();
  $("tempo").value = state.bpm;
  $("tempo-number").value = state.bpm;
  $("guitar").value = state.guitar;
  $("drums").checked = state.drums;
  $("drum-style").value = state.drumStyle;
  $("bass").checked = state.bass;
}

function applyStyle(id) {
  const style = STYLES.find((s) => s.id === id);
  if (!style) return;
  state.signature = style.signature;
  state.patternId = style.pattern;
  state.guitar = style.guitar;
  state.drums = style.drums;
  state.drumStyle = style.drumStyle;
  state.bass = style.bass;
  state.bpm = style.bpm;
  syncSoundControls();
  applySound();
}

function setTempo(value) {
  const bpm = Math.max(50, Math.min(220, Math.round(Number(value)) || state.bpm));
  state.bpm = bpm;
  $("tempo").value = bpm;
  $("tempo-number").value = bpm;
  applySound();
}

function setPerStop(per) {
  const old = state.perStop;
  if (per === old) return;
  state.perStop = per;
  $("perstop-explain").textContent = PER_STOP_EXPLAIN[per];
  renderSummaries();
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

function setLevels() {
  state.levels = {
    guitar: Number($("level-guitar").value),
    bass: Number($("level-bass").value),
    drums: Number($("level-drums").value),
  };
  band.setLevels(state.levels);
  remember("w3c-levels", state.levels);
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
      $("mode-explain").textContent = MODES[state.mode].explain;
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

  $("style").addEventListener("change", () => applyStyle($("style").value));
  $("signature").addEventListener("change", () => {
    state.signature = $("signature").value;
    state.patternId = PATTERNS[state.signature][0].id;
    fillPatternSelect();
    applySound();
  });
  $("pattern").addEventListener("change", () => {
    state.patternId = $("pattern").value;
    applySound();
  });
  $("tempo").addEventListener("input", () => setTempo($("tempo").value));
  $("tempo-number").addEventListener("change", () => setTempo($("tempo-number").value));
  $("guitar").addEventListener("change", () => {
    state.guitar = $("guitar").value;
    applySound();
  });
  $("drums").addEventListener("change", () => {
    state.drums = $("drums").checked;
    applySound();
  });
  $("drum-style").addEventListener("change", () => {
    state.drumStyle = $("drum-style").value;
    applySound();
  });
  $("bass").addEventListener("change", () => {
    state.bass = $("bass").checked;
    applySound();
  });
  for (const id of ["level-guitar", "level-bass", "level-drums"]) $(id).addEventListener("input", setLevels);

  for (const id of SECTIONS) {
    $(id).addEventListener("toggle", () => remember("w3c-open", SECTIONS.filter((section) => $(section).open)));
  }

  $("example").addEventListener("click", () => {
    setPlace("start", { ...EXAMPLE.start });
    setPlace("end", { ...EXAMPLE.end });
  });
  $("live-toggle").addEventListener("click", () => (live ? endLive() : startLive()));
  $("chart").addEventListener("keydown", onChartKey);
  // Our own updates use replaceState, which doesn't fire this; a hash that
  // changes any other way is a different link being opened.
  window.addEventListener("hashchange", () => location.reload());

  $("play").addEventListener("click", togglePlay);
  $("arrival-play").addEventListener("click", togglePlay);
  $("arrival-close").addEventListener("click", hideArrival);
  $("stop").addEventListener("click", stopAndRewind);
  $("share").addEventListener("click", share);
  $("download").addEventListener("click", downloadSong);
  $("share-cancel").addEventListener("click", () => $("share-dialog").close());
  $("share-confirm").addEventListener("click", () => {
    $("share-dialog").close();
    state.pathShared = true;
    share();
  });
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
  $("what-open").addEventListener("click", () => $("what").showModal());
  for (const id of ["about", "what", "share-dialog"]) {
    $(id).addEventListener("click", (event) => {
      if (event.target === $(id)) $(id).close();
    });
  }

  // Phones suspend audio when the screen locks or a call comes in. Try to
  // pick it up again on return; if the browser wants a tap first, say so.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || player.state !== "playing") return;
    if (Tone.getContext().state === "running") return;
    try {
      await Tone.start();
    } catch (error) {
      // Falls through to the check below.
    }
    if (Tone.getContext().state !== "running") {
      player.pause();
      setPlayButton();
      toast("The sound was paused while you were away. Press play to carry on.");
    }
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
  fillSelect($("signature"), SIGNATURES.map((signature) => [signature, signature]), state.signature);
  fillSelect($("drum-style"), DRUM_STYLES.map((style) => [style.id, style.name]), state.drumStyle);
  fillSelect($("guitar"), GUITARS.map((guitar) => [guitar.id, guitar.name]), state.guitar);
  syncSoundControls();
  for (const [name, level] of Object.entries(state.levels)) $(`level-${name}`).value = level;
  document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
  document.querySelector(`input[name="length"][value="${state.length}"]`).checked = true;
  document.querySelector(`input[name="perstop"][value="${state.perStop}"]`).checked = true;
  $("mode-explain").textContent = MODES[state.mode].explain;
  $("length-explain").textContent = LENGTHS[state.length].explain;
  $("perstop-explain").textContent = PER_STOP_EXPLAIN[state.perStop];
  for (const which of ["start", "end"]) {
    places[which].input.value = state[which] ? state[which].label : "";
    places[which].lastQuery = places[which].input.value;
  }
  for (const id of recall("w3c-open") || []) {
    if (SECTIONS.includes(id)) $(id).open = true;
  }
  const support = liveSupport();
  if (support) {
    $("live-toggle").disabled = true;
    $("live-pitch").textContent = support;
  }
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function main() {
  const missing = ["maplibregl", "h3", "Tone"].filter((name) => !(name in window));
  if (missing.length) throw new Error("Some of the page’s libraries didn’t load. Check your connection and reload.");
  const fromLink = decodeHash(location.hash);
  Object.assign(state, fromLink);
  // A route that arrived in a link is already out there.
  state.pathShared = Boolean(fromLink.path);
  const levels = recall("w3c-levels");
  if (levels && ["guitar", "bass", "drums"].every((name) => levels[name] >= 0 && levels[name] <= 1)) state.levels = levels;
  syncControls();
  bindControls();
  await loadChords("./data/chords.json");
  initMap();
  band.setLevels(state.levels);
  applySound();
  setMarker("start");
  setMarker("end");
  renderRoute();
  rebuildRoute({ fit: false }).then(() => {
    fitRoute(false);
    if (fromLink.path || (fromLink.start && fromLink.end)) showArrival();
  });
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
