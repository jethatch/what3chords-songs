// A live session: follow the device's position and turn it into stops, one
// per hexagon entered. The hexagons are far bigger than the ~1 m cells the
// chords come from, because a phone's idea of where it is wanders by many
// metres; the size also grows with speed so a drive isn't a blur of chords.

import { haversineKm, hexSpacingKm } from "./routing.js";

const MAX_USABLE_ACCURACY_M = 150;
const RES_SETTLE_MS = 8000;
const DWELL_MS = 3000;

// H3 resolution for a speed in metres per second: about 50 m hexagons on
// foot, 130 m on a bike, 350 m in town traffic, 900 m on the open road.
export function resolutionForSpeed(mps) {
  if (mps < 2.5) return 11;
  if (mps < 7) return 10;
  if (mps < 14) return 9;
  return 8;
}

export function paceName(res) {
  return { 11: "walking pace", 10: "cycling pace", 9: "driving in town", 8: "driving" }[res] || "moving";
}

export function liveSupport() {
  if (!("geolocation" in navigator)) return "This browser can’t share its location.";
  if (!window.isSecureContext) return "Location only works on a secure (https) page.";
  return "";
}

export class LiveSession {
  // onStop(stop) for each new hexagon, onFix(fix) for every usable position,
  // onError(message, fatal) when the browser can't give one.
  constructor({ onStop, onFix, onError }) {
    this.onStop = onStop;
    this.onFix = onFix;
    this.onError = onError;
    this.stops = []; // { point: [lat, lng], res, time }
    this.res = resolutionForSpeed(0);
    this.speed = 0;
    this.last = null;
    this.pendingRes = null;
    this.candidate = null;
    this.watch = null;
    this.wakeLock = null;
    this.onVisible = () => {
      if (document.visibilityState === "visible") this.keepAwake();
    };
  }

  start() {
    this.watch = navigator.geolocation.watchPosition(
      (position) => this.handle(position),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          this.onError("Location permission was refused, so there’s nothing to play. Allow location for this page and try again.", true);
        } else if (!this.stops.length) {
          this.onError("Still waiting for a location fix. It can take a moment, and works best outdoors.", false);
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    this.keepAwake();
    document.addEventListener("visibilitychange", this.onVisible);
  }

  stop() {
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.wakeLock) this.wakeLock.release().catch(() => {});
    this.wakeLock = null;
  }

  // Phones stop running the page when the screen locks, so hold it on.
  // The lock is dropped whenever the page is hidden and has to be re-taken.
  async keepAwake() {
    if (!("wakeLock" in navigator) || this.watch === null) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
    } catch (error) {
      // Refused (low battery, say): the session still works with the screen on.
    }
  }

  handle(position) {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    const time = position.timestamp || Date.now();
    const fix = { point: [lat, lng], accuracy, time };
    // A wild guess is worse than no update, except to get started.
    if (accuracy > MAX_USABLE_ACCURACY_M && this.stops.length) return;

    if (this.last) {
      const seconds = (time - this.last.time) / 1000;
      let speed = position.coords.speed;
      if (!(speed >= 0) && seconds > 0.5) speed = (haversineKm(this.last.point, fix.point) * 1000) / seconds;
      if (speed >= 0) this.speed = this.speed * 0.7 + speed * 0.3;
    }
    this.last = fix;
    this.settleResolution(time);
    fix.speed = this.speed;
    fix.res = this.res;

    const current = this.stops[this.stops.length - 1];
    if (!current) {
      this.addStop(fix);
    } else {
      const here = h3.latLngToCell(lat, lng, this.res);
      const there = h3.latLngToCell(current.point[0], current.point[1], this.res);
      if (here === there) {
        this.candidate = null;
      } else {
        if (!this.candidate || this.candidate.cell !== here) this.candidate = { cell: here, since: time, fixes: 0 };
        this.candidate.fixes++;
        // Standing near an edge, the position flickers across it. Count it
        // as a move only once it has stuck and is a real distance away.
        const settled = this.candidate.fixes >= 2 || time - this.candidate.since >= DWELL_MS;
        const movedKm = haversineKm(current.point, fix.point);
        if (settled && movedKm > 0.6 * hexSpacingKm(this.res)) this.addStop(fix);
      }
    }
    this.onFix(fix);
  }

  // Change hexagon size only once the new pace has lasted a while, so a
  // red light or a sprint for the bus doesn't.
  settleResolution(time) {
    const wanted = resolutionForSpeed(this.speed);
    if (wanted === this.res) {
      this.pendingRes = null;
    } else if (!this.pendingRes || this.pendingRes.res !== wanted) {
      this.pendingRes = { res: wanted, since: time };
    } else if (time - this.pendingRes.since >= RES_SETTLE_MS) {
      this.res = wanted;
      this.pendingRes = null;
      this.candidate = null;
    }
  }

  addStop(fix) {
    const stop = { point: fix.point, res: this.res, time: fix.time };
    this.stops.push(stop);
    this.candidate = null;
    this.onStop(stop);
  }
}
