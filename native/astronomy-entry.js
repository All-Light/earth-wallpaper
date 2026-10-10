import { ephemeris, slerpDirection } from '../src/astronomy.js';
import { directionFromLatLon, normalizeDirection } from '../src/home.js';

export function sample(date = new Date()) { return ephemeris(date); }
export function latLon(latitude, longitude) { return directionFromLatLon(latitude, longitude); }
export function unit(vector) { return normalizeDirection(vector); }

export { slerpDirection };
export { EARTH_HOME, migrateSavedView } from '../src/home.js';

// Keep an enabled home return ahead of the idle snapshot, even at a 90 s delay.
export function pendingHomeReturn(camera, home, delay) {
  if (!(delay > 0) || !camera || !home) return false;
  const a=normalizeDirection(camera), b=normalizeDirection(home);
  return 1-(a.x*b.x+a.y*b.y+a.z*b.z) >= 1e-7;
}
