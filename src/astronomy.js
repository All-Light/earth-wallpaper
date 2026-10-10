import * as Astronomy from 'astronomy-engine';

export const EARTH_RADIUS_KM = 6371.0;
export const AU_KM = 149597870.7;
export const MOON_RADIUS_KM = 1737.4;
export const SUN_RADIUS_KM = 695700;

function earthFixed(body, date) {
  const eqj = Astronomy.GeoVector(body, date, true);
  const eqd = Astronomy.RotateVector(Astronomy.Rotation_EQJ_EQD(date), eqj);
  const angle = Astronomy.SiderealTime(date) * Math.PI / 12;
  const equatorialY = -Math.sin(angle) * eqd.x + Math.cos(angle) * eqd.y;
  // The scene uses Y as geographic north and negative Z as east, matching
  // the longitude convention in the equirectangular texture shader.
  return {
    x: Math.cos(angle) * eqd.x + Math.sin(angle) * eqd.y,
    y: eqd.z,
    z: -equatorialY,
  };
}

export function ephemeris(date = new Date()) {
  const siderealAngle = Astronomy.SiderealTime(date) * Math.PI / 12;
  const sun = earthFixed(Astronomy.Body.Sun, date);
  const moon = earthFixed(Astronomy.Body.Moon, date);
  const length = v => Math.hypot(v.x, v.y, v.z);
  const normalized = v => { const d = length(v); return { x: v.x/d, y: v.y/d, z: v.z/d }; };
  const geo = v => ({ latitude: Math.atan2(v.y, Math.hypot(v.x, v.z))*180/Math.PI, longitude: Math.atan2(-v.z, v.x)*180/Math.PI });
  const sKm = length(sun) * AU_KM, mKm = length(moon) * AU_KM;
  const s = normalized(sun), m = normalized(moon);
  const illumination = (1 - (s.x*m.x + s.y*m.y + s.z*m.z)) / 2;
  return {
    sun: { ...s, distanceEarthRadii: sKm/EARTH_RADIUS_KM, angularRadius: Math.asin(SUN_RADIUS_KM/sKm), subpoint: geo(sun) },
    moon: { ...m, distanceEarthRadii: mKm/EARTH_RADIUS_KM, radiusEarthRadii: MOON_RADIUS_KM/EARTH_RADIUS_KM, angularRadius: Math.asin(MOON_RADIUS_KM/mKm), illumination, subpoint: geo(moon) },
    date: date.toISOString(), siderealAngle,
  };
}

export function cameraDirectionFromAngles(theta, phi) {
  const sinPhi = Math.sin(phi);
  return { x: Math.sin(theta)*sinPhi, y: Math.cos(phi), z: Math.cos(theta)*sinPhi };
}

export function slerpDirection(from, to, amount) {
  const normalized = v => {
    const length = Math.hypot(v.x, v.y, v.z);
    return length > 0 ? { x: v.x/length, y: v.y/length, z: v.z/length } : { ...to };
  };
  const a = normalized(from), b = normalized(to);
  const t = Math.max(0, Math.min(1, amount));
  const dot = Math.max(-1, Math.min(1, a.x*b.x + a.y*b.y + a.z*b.z));
  if (dot > 0.999999) return normalized({ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t });
  if (dot < -0.999999) {
    const basis = Math.abs(a.x) < Math.abs(a.y)
      ? (Math.abs(a.x) < Math.abs(a.z) ? {x:1,y:0,z:0} : {x:0,y:0,z:1})
      : (Math.abs(a.y) < Math.abs(a.z) ? {x:0,y:1,z:0} : {x:0,y:0,z:1});
    const orthogonal = normalized({ x:a.y*basis.z-a.z*basis.y, y:a.z*basis.x-a.x*basis.z, z:a.x*basis.y-a.y*basis.x });
    return normalized({ x:a.x*Math.cos(Math.PI*t)+orthogonal.x*Math.sin(Math.PI*t), y:a.y*Math.cos(Math.PI*t)+orthogonal.y*Math.sin(Math.PI*t), z:a.z*Math.cos(Math.PI*t)+orthogonal.z*Math.sin(Math.PI*t) });
  }
  const angle = Math.acos(dot), sinAngle = Math.sin(angle);
  const wa = Math.sin((1-t)*angle)/sinAngle, wb = Math.sin(t*angle)/sinAngle;
  return normalized({ x:wa*a.x+wb*b.x, y:wa*a.y+wb*b.y, z:wa*a.z+wb*b.z });
}

export function createCameraReturnState(delayMs = 20_000) {
  let delay = delayMs, active = false, requested = false, lastInput = 0;
  return {
    begin(now) { active = true; requested = false; lastInput = now; },
    end(now) { active = false; lastInput = now; },
    noteInput(now) { lastInput = now; requested = false; },
    request() { requested = true; },
    complete(now = lastInput) { requested = false; lastInput = now; },
    setDelay(ms) { delay = Math.max(0, Number(ms) || 0); },
    shouldReturn(now) { return !active && (requested || (delay > 0 && now-lastInput >= delay)); },
    get isActive() { return active; },
  };
}
